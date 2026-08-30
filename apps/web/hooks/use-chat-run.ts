'use client'

import type {
  AgentDefinitionSummary,
  AgentRun,
  AgentRunStatus,
  AgentSession,
  AgentTranscriptItem,
  ApiErrorCode,
  RunEvent,
} from '@starter/contracts'
import { ApiErrorCodes } from '@starter/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'

import { pickNextSessionId, removeSession, upsertSession } from '@web/lib/ai/chat-session-view'
import type { ChatRunState } from '@web/lib/ai/chat-events'
import { applyRunEvent, createChatRunState } from '@web/lib/ai/chat-events'
import type { ChatNotice } from '@web/lib/ai/chat-run-view'
import { applyLiveSnapshot, describeError, terminalNotice } from '@web/lib/ai/chat-run-view'
import { resumeRunStream, startRunStream } from '@web/lib/ai/run-event-stream'
import type { ChatAttachmentItem } from '@web/hooks/use-chat-attachments'
import {
  abortAgentRun,
  archiveAgentSession,
  createAgentSession,
  getActiveAgentRun,
  getAgentRun,
  getAgentSessions,
  getAgentTranscript,
  getRuntimeAgents,
  renameAgentSession,
} from '@web/lib/api/ai-chat.api'
import { isApiRequestError } from '@web/lib/http'

/** 断流后查询 Run 状态的间隔。 */
const POLL_INTERVAL_MS = 1500
/** 自动生成的 Session 标题长度上限。 */
const TITLE_MAX_LENGTH = 40

/** 发送中用户气泡里展示的图片缩略图。 */
export interface PendingChatImage {
  attachmentId: string
  url: string
}

/**
 * Chat 页面的数据与 Run 生命周期。
 *
 * 挂载时读 Agent 列表和 Session 列表，有未归档 Session 就复用最近一个并读 transcript。
 * 刷新页面时这一轮可能还在跑：按 session 查到进行中的 Run 就接回它的事件流，继续渲染。
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
  const [pendingUserImages, setPendingUserImages] = useState<PendingChatImage[] | null>(null)
  const [boot, setBoot] = useState<'failed' | 'loading' | 'ready'>('loading')
  const [bootAttempt, setBootAttempt] = useState(0)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [notice, setNotice] = useState<ChatNotice | null>(null)
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [sessionTotal, setSessionTotal] = useState(0)
  const [sessionBusy, setSessionBusy] = useState(false)

  const mountedRef = useRef(true)
  const streamRef = useRef<AbortController | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 每次开始或停止轮询都换一个 token，在飞的 tick 回来后按它判断自己是否已作废。 */
  const pollTokenRef = useRef(0)
  /** 切换会话时递增，作废晚到的 transcript 响应（同 pollTokenRef 的做法）。 */
  const selectTokenRef = useRef(0)
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

  /** Run 进终态后重新拉一次列表，让自动标题和 updatedAt 排序和服务端一致。 */
  const refreshSessions = useCallback(async () => {
    try {
      const sessionList = await getAgentSessions()
      if (!mountedRef.current) return
      setSessions(sessionList.items)
      setSessionTotal(sessionList.total)
    } catch (error) {
      // 拉取失败只提示，不清空已有列表；已有更高优先级的提示（如运行失败）时不覆盖。
      if (!mountedRef.current) return
      setNotice((current) => current ?? { kind: 'error', message: `刷新会话列表失败：${describeError(error)}` })
    }
  }, [])

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
        setPendingUserImages(null)
      } catch (error) {
        // 读历史失败时保留流式视图，已经产生的输出不清空。
        if (!mountedRef.current) return
        setNotice({ kind: 'error', message: `读取对话历史失败：${describeError(error)}` })
      } finally {
        if (mountedRef.current) {
          setRunning(false)
          // 自动标题和排序由服务端决定，重拉一次列表对齐；失败不清空已有列表。
          void refreshSessions()
        }
      }
    },
    [refreshSessions],
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

  const consumeRunEvents = useCallback(
    async (
      currentSessionId: string,
      events: AsyncIterable<RunEvent>,
      controller: AbortController,
      mode: 'resume' | 'start',
    ) => {
      let state = createChatRunState()
      let received = 0
      let terminal = false

      for await (const event of events) {
        received += 1
        if (runIdRef.current !== event.runId) {
          runIdRef.current = event.runId
          setRunId(event.runId)
        }
        state = applyRunEvent(state, event)
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
      // 恢复流一个事件都没收到只说明流没建起来，Run 本身刚查到还在跑，照样转轮询。
      if (runId && (received > 0 || mode === 'resume')) {
        // 用户点停止时是本地主动 abort，不是断流，不能给错的归因提示。
        if (!controller.signal.aborted) setNotice({ kind: 'info', message: '事件流已断开，正在查询运行状态。' })
        beginRunPolling(currentSessionId, runId)
        return
      }

      if (controller.signal.aborted) {
        setRunning(false)
        setPendingUserText(null)
        setPendingUserImages(null)
        setRunState(null)
        return
      }

      throw new Error('Agent Run 没有产生任何事件，请稍后重试。')
    },
    [beginRunPolling, finishRun],
  )

  /**
   * 接回一条已经在跑的 Run：进运行中状态，从 sequence 1 全量回放并继续消费实时增量。
   *
   * 不设 `pendingUserText`：这一轮的用户提问 Run 开始时就已经在 transcript 里，再设一份会出现两个相同的气泡。
   * 调用方要先用失效令牌确认 `sessionId` 还是当前会话，再把查到的 Run 交给它。
   */
  const resumeActiveRun = useCallback(
    async (currentSessionId: string, active: AgentRun) => {
      stopPolling()
      streamRef.current?.abort()
      runIdRef.current = active.id
      setRunId(active.id)
      setRunState(createChatRunState())
      setRunning(true)
      setStopping(false)

      const controller = new AbortController()
      streamRef.current = controller

      try {
        await consumeRunEvents(
          currentSessionId,
          resumeRunStream({
            afterSequence: 0,
            runId: active.id,
            sessionId: currentSessionId,
            signal: controller.signal,
          }),
          controller,
          'resume',
        )
      } catch (error) {
        if (!mountedRef.current || streamRef.current !== controller) return
        // 建流阶段被停止：Run 已经在服务端跑着，runId 也已知，转轮询等它的终态提示，不按请求失败报错。
        if (controller.signal.aborted) {
          beginRunPolling(currentSessionId, active.id)
          return
        }
        setRunning(false)
        setStopping(false)
        setRunState(null)
        handleRequestError(error)
      }
    },
    [beginRunPolling, consumeRunEvents, handleRequestError, stopPolling],
  )

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
        // 整个列表本地维护，切换会话用；只有最近 20 条，超过时用 total 提示。
        setSessions(sessionList.items)
        setSessionTotal(sessionList.total)

        const latest = sessionList.items[0]
        if (latest) {
          // transcript 和 active-run 并行请求，刷新页面时少一个往返。
          const [transcript, activeRun] = await Promise.all([
            getAgentTranscript(latest.id),
            getActiveAgentRun(latest.id),
          ])
          if (!active) return
          rememberSession(latest.id)
          setHistory(transcript.items)
          // 恢复流要一直读到 Run 终态，不能阻住首屏。
          if (activeRun) void resumeActiveRun(latest.id, activeRun)
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
  }, [userId, bootAttempt, rememberSession, resumeActiveRun])

  const send = useCallback(
    async (value: string, attachments: ChatAttachmentItem[] = []) => {
      if (value.length === 0 || agentId.length === 0 || running) return true

      // 只有上传完成的附件能随请求发出；待发送区在上传中时会禁用发送，这里是防御。
      const images: PendingChatImage[] = attachments.flatMap((item) =>
        item.status === 'ready' && item.attachmentId !== null && item.url !== null
          ? [{ attachmentId: item.attachmentId, url: item.url }]
          : [],
      )
      const attachmentIds = images.map((image) => image.attachmentId)

      stopPolling()
      streamRef.current?.abort()
      runIdRef.current = null
      setRunId(null)
      setNotice(null)
      setPendingUserText(value)
      setPendingUserImages(images.length > 0 ? images : null)
      setRunState(createChatRunState())
      setRunning(true)
      setStopping(false)

      const controller = new AbortController()
      streamRef.current = controller

      try {
        // 首次发送时才创建 Session；创建成功先在本地插入列表并选中，等 Run 结束再由服务端列表校准。
        let activeSessionId = sessionId
        if (activeSessionId === null) {
          const created = await createAgentSession({ title: value.slice(0, TITLE_MAX_LENGTH) })
          activeSessionId = created.id
          rememberSession(created.id)
          setSessions((items) => upsertSession(items, created))
        }
        await consumeRunEvents(
          activeSessionId,
          startRunStream({
            agentId,
            input: value,
            attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
            sessionId: activeSessionId,
            signal: controller.signal,
          }),
          controller,
          'start',
        )
        return true
      } catch (error) {
        if (!mountedRef.current) return false
        setRunning(false)
        setStopping(false)
        setPendingUserText(null)
        setPendingUserImages(null)
        setRunState(null)
        handleRequestError(error, value)
        return false
      }
    },
    [agentId, consumeRunEvents, handleRequestError, rememberSession, running, sessionId, stopPolling],
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

  /** 选中另一个会话并读它 main lane 最新一页 transcript 替换时间线。 */
  const selectSession = useCallback(
    async (targetSessionId: string) => {
      if (targetSessionId === sessionIdRef.current) return
      // 切换前作废在飞的轮询和流，避免旧链路的回调写进新会话视图。
      stopPolling()
      streamRef.current?.abort()
      runIdRef.current = null
      setRunId(null)
      setNotice(null)
      setSessionBusy(true)
      const token = ++selectTokenRef.current
      try {
        const transcript = await getAgentTranscript(targetSessionId)
        if (!mountedRef.current || token !== selectTokenRef.current) return
        rememberSession(targetSessionId)
        setHistory(transcript.items)
        setRunState(null)
        setPendingUserText(null)
        setPendingUserImages(null)
        // 切回的会话可能还有 Run 在跑，查到就接回它的事件流。
        const activeRun = await getActiveAgentRun(targetSessionId)
        if (!mountedRef.current || token !== selectTokenRef.current) return
        if (activeRun) void resumeActiveRun(targetSessionId, activeRun)
      } catch (error) {
        if (!mountedRef.current || token !== selectTokenRef.current) return
        handleRequestError(error)
      } finally {
        if (mountedRef.current && token === selectTokenRef.current) setSessionBusy(false)
      }
    },
    [handleRequestError, rememberSession, resumeActiveRun, stopPolling],
  )

  /** 新建对话：只清空本地引用和时间线，等首次发送时再 POST 创建。 */
  const startNewSession = useCallback(() => {
    if (running) return
    stopPolling()
    streamRef.current?.abort()
    runIdRef.current = null
    setRunId(null)
    rememberSession(null)
    setHistory([])
    setRunState(null)
    setPendingUserText(null)
    setPendingUserImages(null)
    setNotice(null)
  }, [rememberSession, running, stopPolling])

  /** 改当前会话标题；空标题和超长标题由组件本地拦截，这里直接调 PATCH。 */
  const renameSession = useCallback(
    async (title: string) => {
      const currentSessionId = sessionIdRef.current
      if (currentSessionId === null) return
      setSessionBusy(true)
      try {
        const updated = await renameAgentSession(currentSessionId, title)
        if (!mountedRef.current) return
        setSessions((items) => upsertSession(items, updated))
      } catch (error) {
        if (!mountedRef.current) return
        handleRequestError(error)
        // 让调用方知道保存没成功，从而退出编辑态。
        throw error
      } finally {
        if (mountedRef.current) setSessionBusy(false)
      }
    },
    [handleRequestError],
  )

  /** 归档当前会话；归档的就是当前会话时切到下一条并读它的历史，列表空则回到空态。 */
  const archiveSession = useCallback(async () => {
    const currentSessionId = sessionIdRef.current
    if (currentSessionId === null) return
    setSessionBusy(true)
    try {
      await archiveAgentSession(currentSessionId)
      if (!mountedRef.current) return
      const nextId = pickNextSessionId(sessions, currentSessionId)
      setSessions((items) => removeSession(items, currentSessionId))
      if (nextId === null) {
        // 最后一条也归档了，回到空态。
        rememberSession(null)
        setHistory([])
        setRunState(null)
        setPendingUserText(null)
        setPendingUserImages(null)
        setNotice(null)
        return
      }
      if (nextId === currentSessionId) return
      // 归档的是当前会话：先记住新会话再读 transcript，避免后续请求还指向旧会话。
      const token = ++selectTokenRef.current
      rememberSession(nextId)
      setHistory([])
      setRunState(null)
      setPendingUserText(null)
      setPendingUserImages(null)
      setNotice(null)
      try {
        const transcript = await getAgentTranscript(nextId)
        if (!mountedRef.current || token !== selectTokenRef.current) return
        setHistory(transcript.items)
      } catch (error) {
        if (!mountedRef.current || token !== selectTokenRef.current) return
        handleRequestError(error)
      }
    } catch (error) {
      if (!mountedRef.current) return
      if (isApiRequestError(error, 404)) {
        // 会话已经被归档或删除：从列表移除，避免残留选中态。
        setSessions((items) => removeSession(items, currentSessionId))
      }
      handleRequestError(error)
    } finally {
      if (mountedRef.current) setSessionBusy(false)
    }
  }, [handleRequestError, rememberSession, sessions])

  return {
    agentId,
    agents,
    archiveSession,
    boot,
    // 会话区四个控件是否有权操作：不进 Run 且没有会话请求在飞。
    canMutateSessions: boot === 'ready' && !running && !sessionBusy,
    // runId 要等 run.started 到达才有；在那之前 abort 接口没有目标，停止按钮保持禁用。
    canStop: running && runId !== null,
    history,
    notice,
    pendingUserText,
    pendingUserImages,
    reload,
    renameSession,
    running,
    runState,
    selectAgent: setAgentId,
    selectSession,
    send,
    sessionBusy,
    sessionId,
    sessions,
    sessionTotal,
    startNewSession,
    stop,
    stopping,
  }
}
