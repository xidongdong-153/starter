'use client'

import type { AgentDefinitionSummary, AgentRunStatus, AgentTranscriptItem, ApiErrorCode } from '@starter/contracts'
import { ApiErrorCodes } from '@starter/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatRunState } from '@web/lib/ai/chat-events'
import { applyHarnessEvent, createChatRunState } from '@web/lib/ai/chat-events'
import type { ChatNotice } from '@web/lib/ai/chat-run-view'
import { applyLiveSnapshot, describeError, terminalNotice } from '@web/lib/ai/chat-run-view'
import { startRunStream } from '@web/lib/ai/harness-stream'
import {
  abortAgentRun,
  createAgentSession,
  getAgentRun,
  getAgentSessions,
  getAgentTranscript,
  getRuntimeAgents,
} from '@web/lib/api/ai-chat.api'
import { isApiRequestError } from '@web/lib/http'

/** 断流后查询 Run 状态的间隔。 */
const POLL_INTERVAL_MS = 1500
/** 自动生成的 Session 标题长度上限。 */
const TITLE_MAX_LENGTH = 40

/**
 * Chat 页面的数据与 Run 生命周期。
 *
 * 挂载时读 Agent 列表和 Session 列表，有未归档 Session 就复用最近一个并读 transcript。
 * 发送时先消费 SSE 折叠出流式视图，Run 进终态后用 transcript 替换。
 * 流提前结束不算失败：已经收到过事件就轮询 `GET /runs/{runId}`，用 API 的 `live` 快照覆盖本地 timeline；
 * 一个事件都没收到才按启动失败报错。
 *
 * `userId` 为 null 时不发任何 AI 请求。
 */
export function useChatRun(userId: string | null) {
  const [agents, setAgents] = useState<AgentDefinitionSummary[]>([])
  const [agentId, setAgentId] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [history, setHistory] = useState<AgentTranscriptItem[]>([])
  const [runState, setRunState] = useState<ChatRunState | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [pendingUserText, setPendingUserText] = useState<string | null>(null)
  const [boot, setBoot] = useState<'failed' | 'loading' | 'ready'>('loading')
  const [bootAttempt, setBootAttempt] = useState(0)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [notice, setNotice] = useState<ChatNotice | null>(null)

  const mountedRef = useRef(true)
  const streamRef = useRef<AbortController | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 每次开始或停止轮询都换一个 token，在飞的 tick 回来后按它判断自己是否已作废。 */
  const pollTokenRef = useRef(0)
  const runIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  const stopPolling = useCallback(() => {
    pollTokenRef.current += 1
    if (pollRef.current === null) return
    clearTimeout(pollRef.current)
    pollRef.current = null
  }, [])

  /** session id 同时写进 ref，异步回调不用等 state 提交。 */
  const rememberSession = useCallback((value: string | null) => {
    sessionIdRef.current = value
    setSessionId(value)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      streamRef.current?.abort()
      pollTokenRef.current += 1
      if (pollRef.current !== null) clearTimeout(pollRef.current)
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    let active = true
    setBoot('loading')

    void (async () => {
      try {
        const [agentList, sessionList] = await Promise.all([getRuntimeAgents(), getAgentSessions()])
        if (!active) return
        setAgents(agentList.items)
        setAgentId(agentList.items[0]?.id ?? '')

        // 列表按更新时间倒序，第一条是最近使用的未归档 Session；没有就等首次发送时再创建。
        const latest = sessionList.items[0]
        if (latest) {
          const transcript = await getAgentTranscript(latest.id)
          if (!active) return
          rememberSession(latest.id)
          setHistory(transcript.items)
        }
        setBoot('ready')
      } catch (error) {
        if (!active) return
        setNotice({ kind: isApiRequestError(error, 401) ? 'auth' : 'error', message: describeError(error) })
        setBoot('failed')
      }
    })()

    return () => {
      active = false
    }
  }, [userId, bootAttempt, rememberSession])

  const handleRequestError = useCallback(
    (error: unknown, retryText?: string) => {
      if (isApiRequestError(error, 401)) {
        setNotice({ kind: 'auth', message: '登录状态已失效，请重新登录。' })
        return
      }
      if (isApiRequestError(error, 404)) {
        // Session 已经不存在或被归档，清掉本地引用，重新发送会创建新的 Session。
        rememberSession(null)
        setHistory([])
        setNotice({ kind: 'error', message: '这个对话已经不存在，重新发送会创建新的对话。', retryText })
        return
      }
      // 按 error code 判断，不看 API 的中文 message：SESSION_BUSY 的原文带「Session lane」这种内部概念。
      if (isApiRequestError(error, 409) && error.code === ApiErrorCodes.AI_SESSION_BUSY) {
        setNotice({ kind: 'error', message: '上一次运行还没结束，等它结束后再发送。', retryText })
        return
      }
      setNotice({ kind: 'error', message: describeError(error), retryText })
    },
    [rememberSession],
  )

  const finishRun = useCallback(
    async (
      currentSessionId: string,
      status: AgentRunStatus,
      errorCode: ApiErrorCode | null,
      errorMessage: string | null = null,
    ) => {
      setStopping(false)
      setNotice(terminalNotice(status, errorCode, errorMessage))

      try {
        const transcript = await getAgentTranscript(currentSessionId)
        if (!mountedRef.current) return
        setHistory(transcript.items)
        setRunState(null)
        setPendingUserText(null)
      } catch (error) {
        // 读历史失败时保留流式视图，已经产生的输出不清空。
        if (!mountedRef.current) return
        setNotice({ kind: 'error', message: `读取对话历史失败：${describeError(error)}` })
      } finally {
        if (mountedRef.current) setRunning(false)
      }
    },
    [],
  )

  const beginRunPolling = useCallback(
    (currentSessionId: string, runId: string) => {
      stopPolling()
      const token = pollTokenRef.current

      // 链式调度而不是 setInterval：单次查询超过间隔时不会有两个 tick 同时读到终态。
      const tick = async () => {
        try {
          const run = await getAgentRun(currentSessionId, runId)
          if (!mountedRef.current || token !== pollTokenRef.current) return
          const live = run.live
          if (live) setRunState((current) => applyLiveSnapshot(current, live))
          if (run.status === 'starting' || run.status === 'running') {
            pollRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS)
            return
          }
          stopPolling()
          await finishRun(currentSessionId, run.status, run.errorCode)
        } catch (error) {
          if (token !== pollTokenRef.current) return
          stopPolling()
          if (!mountedRef.current) return
          setRunning(false)
          setStopping(false)
          handleRequestError(error)
        }
      }

      void tick()
    },
    [finishRun, handleRequestError, stopPolling],
  )

  const consumeRunStream = useCallback(
    async (currentSessionId: string, value: string, controller: AbortController) => {
      let state = createChatRunState()
      let received = 0
      let terminal = false

      for await (const event of startRunStream({
        agentId,
        input: value,
        sessionId: currentSessionId,
        signal: controller.signal,
      })) {
        received += 1
        if (runIdRef.current !== event.runId) {
          runIdRef.current = event.runId
          setRunId(event.runId)
        }
        state = applyHarnessEvent(state, event)
        if (!mountedRef.current) return
        setRunState(state)
        if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.aborted') {
          terminal = true
        }
      }

      if (!mountedRef.current) return
      // 旧流结束得很晚时，当前 Run 已经是另一个 controller，后面的轮询和清空都不归它管。
      if (streamRef.current !== controller) return

      if (terminal) {
        await finishRun(currentSessionId, state.status, state.errorCode, state.errorMessage)
        return
      }

      const runId = runIdRef.current
      if (received > 0 && runId) {
        // 用户点停止时是本地主动 abort，不是断流，不能给错的归因提示。
        if (!controller.signal.aborted) setNotice({ kind: 'info', message: '事件流已断开，正在查询运行状态。' })
        beginRunPolling(currentSessionId, runId)
        return
      }

      if (controller.signal.aborted) {
        setRunning(false)
        setPendingUserText(null)
        setRunState(null)
        return
      }

      throw new Error('Agent Run 没有产生任何事件，请稍后重试。')
    },
    [agentId, beginRunPolling, finishRun],
  )

  const send = useCallback(
    async (value: string) => {
      if (value.length === 0 || agentId.length === 0 || running) return

      stopPolling()
      streamRef.current?.abort()
      runIdRef.current = null
      setRunId(null)
      setNotice(null)
      setPendingUserText(value)
      setRunState(createChatRunState())
      setRunning(true)
      setStopping(false)

      const controller = new AbortController()
      streamRef.current = controller

      try {
        const activeSessionId = sessionId ?? (await createAgentSession({ title: value.slice(0, TITLE_MAX_LENGTH) })).id
        if (activeSessionId !== sessionId) rememberSession(activeSessionId)
        await consumeRunStream(activeSessionId, value, controller)
      } catch (error) {
        if (!mountedRef.current) return
        setRunning(false)
        setStopping(false)
        setPendingUserText(null)
        setRunState(null)
        handleRequestError(error, value)
      }
    },
    [agentId, consumeRunStream, handleRequestError, rememberSession, running, sessionId, stopPolling],
  )

  const stop = useCallback(async () => {
    setStopping(true)
    const controller = streamRef.current
    const runId = runIdRef.current
    const currentSessionId = sessionIdRef.current
    try {
      if (currentSessionId && runId) await abortAgentRun(currentSessionId, runId)
    } catch (error) {
      // Run 已经进终态时返回 409，按已结束继续处理。
      if (!isApiRequestError(error, 409)) handleRequestError(error)
    } finally {
      // 只 abort 发起停止时的那条流，不动期间可能已经换成的新流。
      if (streamRef.current === controller) controller?.abort()
    }
  }, [handleRequestError])

  const reload = useCallback(() => setBootAttempt((count) => count + 1), [])

  return {
    agentId,
    agents,
    boot,
    // runId 要等 run.started 到达才有；在那之前 abort 接口没有目标，停止按钮保持禁用。
    canStop: running && runId !== null,
    history,
    notice,
    pendingUserText,
    reload,
    running,
    runState,
    selectAgent: setAgentId,
    send,
    stop,
    stopping,
  }
}
