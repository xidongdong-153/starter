'use client'

import type { ApiErrorCode, RunEvent } from '@starter/contracts'
import { ApiErrorCodes } from '@starter/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'

import { describeError } from '@web/lib/ai/chat-run-view'
import { startRunStream } from '@web/lib/ai/run-event-stream'
import {
  abortAgentRun,
  createAgentSession,
  getAgentLaneTranscript,
  getAgentRun,
  listRunStructuredOutputs,
} from '@web/lib/api/flow.api'
import type { FlowRunState } from '@web/lib/flow/flow-run'
import {
  abortStep,
  attachSession,
  attachStepRunId,
  beginStep,
  completeChain,
  completeStep,
  createFlowRunState,
  failStep,
  flowStepIdempotencyKey,
  flowStepLane,
  retryFrom as retryFromState,
} from '@web/lib/flow/flow-run'
import { renderTemplate } from '@web/lib/flow/flow-template'
import { isApiRequestError } from '@web/lib/http'

/** 断流后轮询 Run 状态的间隔，与 chat 保持一致。 */
const POLL_INTERVAL_MS = 1500
/** Session 标题与文档名的长度上限。 */
const TITLE_MAX_LENGTH = 120

export interface FlowChainStep {
  nodeId: string
  agentId: string
  promptTemplate: string
}

export interface FlowRunPlan {
  documentName: string
  input: string
  steps: FlowChainStep[]
}

export interface FlowNotice {
  kind: 'auth' | 'error' | 'info'
  message: string
}

interface ActivePlan {
  sessionId: string
  input: string
  steps: FlowChainStep[]
  flowRunId: string
  /** 每步的重试次数，用于幂等键换新。 */
  retries: number[]
}

type StepOutcome =
  | { kind: 'completed'; runId: string | null; output: string | null }
  | { kind: 'failed'; runId: string | null; errorCode: ApiErrorCode | null; errorMessage: string | null }
  | { kind: 'aborted'; runId: string | null }

/**
 * Flow 执行驱动器：建 Session 后逐节点渲染模板、startRunStream 到终态、提取产出、推进下一步。
 * fail fast：节点失败停止推进；重试复用上游产出、幂等键追加 -r 次数换新。
 * 运行态只存本 hook 的 state，刷新即弃；服务端 Session 与 Run 是持久事实，可在 chat 页查看。
 */
export function useFlowRun() {
  const [run, setRun] = useState<FlowRunState | null>(null)
  const [notice, setNotice] = useState<FlowNotice | null>(null)
  const [stopping, setStopping] = useState(false)

  const mountedRef = useRef(true)
  const planRef = useRef<ActivePlan | null>(null)
  const stateRef = useRef<FlowRunState | null>(null)
  const streamRef = useRef<AbortController | null>(null)
  const stopRequestedRef = useRef(false)
  const currentRunIdRef = useRef<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopRequestedRef.current = true
      streamRef.current?.abort()
    }
  }, [])

  /** 状态更新：ref 同步写（异步循环里读最新值），state 只是 UI 镜像。 */
  const commitState = useCallback((update: (state: FlowRunState) => FlowRunState) => {
    const current = stateRef.current
    if (current === null) return
    const next = update(current)
    stateRef.current = next
    setRun(next)
  }, [])

  const handleError = useCallback((error: unknown): FlowNotice => {
    if (isApiRequestError(error, 401)) {
      return { kind: 'auth', message: '登录状态已失效，请重新登录。' }
    }
    if (isApiRequestError(error, 409) && error.code === ApiErrorCodes.AI_SESSION_BUSY) {
      return { kind: 'error', message: '上一次运行还没结束，等它结束后再运行。' }
    }
    return { kind: 'error', message: describeError(error) }
  }, [])

  /** 产出提取：结构化输出优先，否则读该 lane transcript 最后一条 assistant 文本。 */
  const extractOutput = useCallback(
    async (sessionId: string, runId: string | null, lane: string): Promise<string | null> => {
      if (runId !== null) {
        try {
          const outputs = await listRunStructuredOutputs(sessionId, runId)
          const last = outputs.items.at(-1)
          if (last !== undefined && last.value !== null) return JSON.stringify(last.value, null, 2)
        } catch {
          // 结构化输出读失败回落 transcript，不打断链
        }
      }
      try {
        const transcript = await getAgentLaneTranscript(sessionId, lane)
        for (let index = transcript.items.length - 1; index >= 0; index -= 1) {
          const item = transcript.items[index]
          if (item !== undefined && item.type === 'assistant_message' && item.content.length > 0) {
            return item.content
          }
        }
      } catch {
        // transcript 读失败：产出保持 null，下游引用会在渲染模板时报错
      }
      return null
    },
    [],
  )

  /** 断流兜底：轮询 Run 状态直到终态（interrupted 归入 failed 处理）；产出由调用方提取。 */
  const pollTerminal = useCallback(
    async (sessionId: string, runId: string, signal: AbortSignal): Promise<StepOutcome> => {
      for (;;) {
        if (signal.aborted) return { kind: 'aborted', runId }
        const runSnapshot = await getAgentRun(sessionId, runId)
        if (runSnapshot.status === 'starting' || runSnapshot.status === 'running') {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
          continue
        }
        if (runSnapshot.status === 'completed') return { kind: 'completed', runId, output: null }
        if (runSnapshot.status === 'aborted') return { kind: 'aborted', runId }
        return { kind: 'failed', runId, errorCode: runSnapshot.errorCode, errorMessage: null }
      }
    },
    [],
  )

  const executeStep = useCallback(
    async (plan: ActivePlan, index: number, input: string): Promise<StepOutcome> => {
      const step = plan.steps[index]
      if (step === undefined) return { kind: 'failed', runId: null, errorCode: null, errorMessage: null }

      const controller = new AbortController()
      streamRef.current = controller
      currentRunIdRef.current = null
      let received = 0
      let terminal: RunEvent | null = null

      try {
        for await (const event of startRunStream({
          agentId: step.agentId,
          idempotencyKey: flowStepIdempotencyKey(plan.flowRunId, index, plan.retries[index] ?? 0),
          input,
          lane: flowStepLane(index),
          product: 'flow',
          sessionId: plan.sessionId,
          signal: controller.signal,
        })) {
          received += 1
          if (currentRunIdRef.current === null) {
            currentRunIdRef.current = event.runId
            // 补记 runId，停止按钮靠它拿到 abort 目标；运行已被替换时不再写入
            if (planRef.current === plan) {
              commitState((state) => attachStepRunId(state, index, event.runId))
            }
          }
          if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.aborted') {
            terminal = event
            break
          }
        }
      } catch (error) {
        if (stopRequestedRef.current) return { kind: 'aborted', runId: currentRunIdRef.current }
        return { kind: 'failed', runId: currentRunIdRef.current, errorCode: null, errorMessage: describeError(error) }
      }

      // 用户停止：本地 abort 中断读流，链状态由主循环统一置 aborted
      if (stopRequestedRef.current) return { kind: 'aborted', runId: currentRunIdRef.current }

      // 断流：收到过事件就轮询 Run 状态兜底；一个事件都没收到才算启动失败
      if (terminal === null) {
        const runId = currentRunIdRef.current
        if (runId !== null && received > 0) {
          const outcome = await pollTerminal(plan.sessionId, runId, controller.signal)
          if (outcome.kind === 'completed') {
            const output = await extractOutput(plan.sessionId, runId, flowStepLane(index))
            return { kind: 'completed', runId, output }
          }
          return outcome
        }
        return {
          kind: 'failed',
          runId,
          errorCode: null,
          errorMessage: 'Agent Run 没有产生任何事件，请稍后重试。',
        }
      }

      const runId = currentRunIdRef.current
      if (terminal.type === 'run.completed') {
        const output = await extractOutput(plan.sessionId, runId, flowStepLane(index))
        return { kind: 'completed', runId, output }
      }
      if (terminal.type === 'run.aborted') {
        return { kind: 'aborted', runId }
      }
      return { kind: 'failed', runId, errorCode: terminal.data.error.code, errorMessage: null }
    },
    [commitState, extractOutput, pollTerminal],
  )

  const runLoop = useCallback(
    async (plan: ActivePlan, startIndex: number) => {
      /** 运行被替换（reset 或新一轮 start）后不再写状态、不打扰新运行的提示。 */
      const isActive = () => planRef.current === plan
      const commit = (update: (state: FlowRunState) => FlowRunState) => {
        if (isActive()) commitState(update)
      }
      const notify = (next: FlowNotice) => {
        if (isActive()) setNotice(next)
      }
      // executeStep 理论上不抛（流错误、产出提取错误都在内部处理），
      // 但断流轮询等兑底路径的请求失败会抛出，在这里收口：fail fast 并给出可读提示。
      let activeIndex = startIndex
      try {
        for (let index = startIndex; index < plan.steps.length; index += 1) {
          activeIndex = index
          if (stopRequestedRef.current || !isActive()) {
            // 上一步刚完成但用户已停止（或运行已被替换）：不再推进，把链收敛到 aborted
            commit((state) => (state.status === 'running' ? { ...state, status: 'aborted' } : state))
            return
          }

          const step = plan.steps[index]
          if (step === undefined) continue

          // 渲染模板：上游产出从状态机的已完成步骤取
          const outputs = plan.steps.map((_, stepIndex) => stateRef.current?.steps[stepIndex]?.output ?? null)
          const rendered = renderTemplate(step.promptTemplate, { input: plan.input, outputs })
          if (!rendered.ok) {
            commit((state) => failStep(state, index, { runId: null, errorCode: null, errorMessage: rendered.error }))
            notify({ kind: 'error', message: rendered.error ?? '模板渲染失败。' })
            return
          }

          commit((state) => beginStep(state, index))
          const outcome = await executeStep(plan, index, rendered.text)

          if (stopRequestedRef.current && outcome.kind !== 'completed') {
            commit((state) => abortStep(state, index, outcome.runId))
            notify({ kind: 'info', message: '已停止流程运行。' })
            return
          }

          if (outcome.kind === 'completed') {
            commit((state) => completeStep(state, index, { runId: outcome.runId, output: outcome.output }))
            continue
          }

          if (outcome.kind === 'aborted') {
            commit((state) => abortStep(state, index, outcome.runId))
            notify({ kind: 'info', message: '已停止流程运行。' })
            return
          }

          // fail fast：停止推进，已跑节点的状态与产出保留
          commit((state) =>
            failStep(state, index, {
              runId: outcome.runId,
              errorCode: outcome.errorCode,
              errorMessage: outcome.errorMessage,
            }),
          )
          const message =
            outcome.errorMessage !== null && outcome.errorMessage.length > 0
              ? outcome.errorCode === null
                ? `运行失败：${outcome.errorMessage}`
                : `运行失败：${outcome.errorMessage}（${outcome.errorCode}）`
              : `运行失败：${outcome.errorCode ?? '未返回错误码'}`
          notify({ kind: 'error', message })
          return
        }

        commit((state) => completeChain(state))
      } catch (error) {
        if (stopRequestedRef.current) {
          commit((state) => (state.status === 'running' ? { ...state, status: 'aborted' } : state))
          return
        }
        commit((state) =>
          failStep(state, activeIndex, {
            runId: currentRunIdRef.current,
            errorCode: null,
            errorMessage: describeError(error),
          }),
        )
        notify(handleError(error))
      }
    },
    [commitState, executeStep, handleError],
  )

  /** 启动一次新运行：新建 Session（title `Flow: <文档名>`），从第 0 步跑完整条链。 */
  const start = useCallback(
    async (plan: FlowRunPlan) => {
      if (stateRef.current?.status === 'running') return
      stopRequestedRef.current = false
      setStopping(false)
      setNotice(null)

      // 同步占位 running 状态：await 创建 Session 期间重复触发不会启动第二条链
      const pending: FlowRunState = {
        ...createFlowRunState(plan.steps.map((step) => step.nodeId)),
        status: 'running',
      }
      stateRef.current = pending
      setRun(pending)

      let sessionId: string
      try {
        const session = await createAgentSession({ title: `Flow: ${plan.documentName}`.slice(0, TITLE_MAX_LENGTH) })
        sessionId = session.id
      } catch (error) {
        // 占位状态被 reset 替换时不要回写，也不把旧文档的启动失败提示到新文档上
        if (stateRef.current === pending) {
          stateRef.current = null
          setRun(null)
          setNotice(handleError(error))
        }
        return
      }
      // await 期间被 reset（切文档/清空）：放弃启动，不碰当前状态
      if (stateRef.current !== pending) return

      const active: ActivePlan = {
        sessionId,
        input: plan.input,
        steps: plan.steps,
        flowRunId: crypto.randomUUID(),
        retries: plan.steps.map(() => 0),
      }
      planRef.current = active
      currentRunIdRef.current = null
      stateRef.current = attachSession(pending, sessionId)
      setRun(stateRef.current)
      await runLoop(active, 0)
    },
    [handleError, runLoop],
  )

  /** 从失败或中止的步骤重试：复用上游产出，幂等键换新，从该步继续跑。 */
  const retryFrom = useCallback(
    (nodeId: string) => {
      const plan = planRef.current
      const state = stateRef.current
      if (plan === null || state === null || state.status === 'running') return
      const index = plan.steps.findIndex((step) => step.nodeId === nodeId)
      if (index === -1) return

      plan.retries[index] = (plan.retries[index] ?? 0) + 1
      stopRequestedRef.current = false
      setStopping(false)
      setNotice(null)
      stateRef.current = { ...retryFromState(state, index), status: 'running' }
      setRun(stateRef.current)
      void runLoop(plan, index)
    },
    [runLoop],
  )

  /** 停止：abort 当前 Run 并停止推进，链状态标 aborted；已跑节点产出保留。 */
  const stop = useCallback(async () => {
    if (stateRef.current?.status !== 'running') return
    setStopping(true)
    stopRequestedRef.current = true

    const plan = planRef.current
    const runId = currentRunIdRef.current
    streamRef.current?.abort()
    try {
      if (plan !== null && runId !== null) await abortAgentRun(plan.sessionId, runId)
    } catch (error) {
      // Run 已进终态返回 409，按已结束处理；其余 abort 失败不影响本地停止
      if (!isApiRequestError(error, 409) && mountedRef.current) {
        setNotice(handleError(error))
      }
    } finally {
      if (mountedRef.current) setStopping(false)
    }
  }, [handleError])

  /** 清空运行态（切换文档或重新编辑后调用）。 */
  const reset = useCallback(() => {
    if (stateRef.current?.status === 'running') {
      stopRequestedRef.current = true
      streamRef.current?.abort()
    }
    planRef.current = null
    stateRef.current = null
    currentRunIdRef.current = null
    setStopping(false)
    setNotice(null)
    setRun(null)
  }, [])

  return { notice, reset, retryFrom, run, start, stop, stopping }
}
