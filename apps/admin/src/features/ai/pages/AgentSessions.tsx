import type { GetRef } from 'antd'

import {
  useAbortAgentRunMutation,
  useAgentDefinitionsQuery,
  useAgentRunQuery,
  useAgentSessionQuery,
  useAgentSessionsQuery,
  useAgentTranscriptQuery,
  useArchiveAgentSessionMutation,
  useCreateAgentSessionMutation,
  startAgentRun,
  useUpdateAgentSessionMutation,
} from '@admin/api/ai'
import { AgentTimeline, AgentTimelineItemView } from '@admin/features/ai/components/timeline/AgentTimeline'
import type { HarnessStreamState } from '@admin/features/ai/harness/stream-reducer'
import { createEmptyHarnessStreamState, reduceHarnessEvent } from '@admin/features/ai/harness/stream-reducer'
import type { AgentTimelineItem } from '@admin/features/ai/harness/timeline'
import { fromLiveSnapshot, fromTranscript } from '@admin/features/ai/harness/timeline'
import { useMobile } from '@admin/hooks/useMobile'
import { formatDate, formatRelativeTime } from '@admin/utils/dayjs'
import { App as AntdApp, Alert, Button, Drawer, Empty, Input, Modal, Select, Spin, Tag, Tooltip } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArrowDown,
  ChevronUp,
  CircleAlert,
  LoaderCircle,
  MessageCircle,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Square,
  Trash2,
} from 'lucide-react'

const { TextArea } = Input
type TextAreaRef = GetRef<typeof Input.TextArea>
const sessionPage = { page: 1, pageSize: 50 }
/** SSE 提前结束后改用轮询读取 Run 状态和 live 快照的间隔。 */
const RUN_POLL_INTERVAL_MS = 2000

function SessionList({
  sessions,
  selectedId,
  onSelect,
  onCreate,
  onArchive,
  createPending,
  archivePending,
  onCollapse,
  showCollapseBtn = false,
}: {
  sessions: { items: { id: string; title: string; archivedAt: string | null; updatedAt: string }[] } | undefined
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onArchive: (id: string) => void
  createPending: boolean
  archivePending: boolean
  onCollapse?: () => void
  showCollapseBtn?: boolean
}) {
  const { t } = useTranslation()
  const items = sessions?.items ?? []

  return (
    <aside className="border-border-subtle bg-surface-muted/30 flex h-full min-h-0 w-full flex-col border-r lg:w-[280px] lg:shrink-0">
      <div className="border-border-subtle/80 flex items-center justify-between border-b px-3.5 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="text-primary size-4.5" />
          <span className="text-fg text-sm font-semibold">{t('ai.sessions.list')}</span>
          <span className="border-border-subtle bg-surface-muted/80 text-fg-muted rounded-full border px-2 py-0.2 text-[11px]">
            {items.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip title={t('ai.sessions.new')}>
            <Button
              type="primary"
              size="small"
              icon={<Plus className="size-3.5" />}
              aria-label={t('ai.sessions.new')}
              loading={createPending}
              onClick={onCreate}
            />
          </Tooltip>
          {showCollapseBtn && onCollapse ? (
            <Tooltip title={t('ai.sessions.collapseSidebar')}>
              <Button
                type="text"
                size="small"
                icon={<PanelLeftClose className="size-4" />}
                aria-label={t('ai.sessions.collapseSidebar')}
                onClick={onCollapse}
              />
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('ai.sessions.empty')} className="my-10 text-xs" />
        ) : (
          <div className="space-y-1">
            {items.map((session) => {
              const isSelected = selectedId === session.id
              return (
                <div
                  key={session.id}
                  className={`group relative flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all duration-150 ${
                    isSelected
                      ? 'bg-primary/10 text-primary border-primary/20 border-l-primary border border-l-3 shadow-2xs'
                      : 'border-transparent hover:bg-surface-muted/80 border'
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
                    onClick={() => onSelect(session.id)}
                  >
                    <span className={`block truncate text-sm font-medium ${isSelected ? 'text-primary' : 'text-fg'}`}>
                      {session.title}
                    </span>
                    <div className="text-fg-muted mt-1 flex items-center gap-1 text-[11px]">
                      {session.archivedAt ? <span className="text-warning">{t('ai.sessions.archived')}</span> : null}
                      <span className="text-fg-muted/60 truncate">{formatRelativeTime(session.updatedAt)}</span>
                    </div>
                  </button>
                  {session.archivedAt ? null : (
                    <Tooltip title={t('ai.sessions.archiveAction')}>
                      <Button
                        type="text"
                        size="small"
                        className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                        icon={<Archive className="size-3.5" />}
                        aria-label={`${t('ai.sessions.archiveAction')}: ${session.title}`}
                        loading={archivePending}
                        onClick={() => onArchive(session.id)}
                      />
                    </Tooltip>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

export function AgentSessions() {
  const { t } = useTranslation()
  const { message } = AntdApp.useApp()
  const isMobile = useMobile()
  const sessionsQuery = useAgentSessionsQuery(sessionPage)
  const agentsQuery = useAgentDefinitionsQuery({ page: 1, pageSize: 50 })
  const createSessionMutation = useCreateAgentSessionMutation()
  const updateSessionMutation = useUpdateAgentSessionMutation()
  const archiveSessionMutation = useArchiveAgentSessionMutation()
  const abortRunMutation = useAbortAgentRunMutation()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobileListOpen, setMobileListOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [input, setInput] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [streamState, setStreamState] = useState<HarnessStreamState>(createEmptyHarnessStreamState())
  const [streamError, setStreamError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [pendingUserText, setPendingUserText] = useState<string | null>(null)
  /** SSE 提前结束后转轮询：只是当前页面的运行时视图状态，不持久化。 */
  const [polling, setPolling] = useState(false)

  const controllerRef = useRef<AbortController | null>(null)
  const streamTokenRef = useRef(0)
  const outputRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<TextAreaRef | null>(null)

  const sessionDetailQuery = useAgentSessionQuery(selectedId)
  const transcriptQuery = useAgentTranscriptQuery(selectedId)
  const runQuery = useAgentRunQuery(selectedId, streamState.runId ?? activeRunId, {
    refetchInterval: polling ? RUN_POLL_INTERVAL_MS : false,
  })

  const selectedSession = sessionDetailQuery.data
  const agents = agentsQuery.data?.items ?? []

  useEffect(() => {
    const items = sessionsQuery.data?.items ?? []
    if (selectedId === null && items[0]) setSelectedId(items[0].id)
    if (selectedId && !items.some((item) => item.id === selectedId)) setSelectedId(items[0]?.id ?? null)
  }, [sessionsQuery.data?.items, selectedId])

  useEffect(() => {
    const defaultAgent = selectedSession?.defaultAgentId
    if (defaultAgent && agents.some((agent) => agent.id === defaultAgent)) {
      setSelectedAgentId(defaultAgent)
    } else if (!selectedAgentId && agents[0]) {
      setSelectedAgentId(agents[0].id)
    }
  }, [selectedSession?.defaultAgentId, agents, selectedAgentId])

  useEffect(
    () => () => {
      streamTokenRef.current += 1
      controllerRef.current?.abort()
    },
    [],
  )

  const scrollToBottom = () => {
    if (outputRef.current) {
      outputRef.current.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' })
      setShowScrollBottom(false)
    }
  }

  const handleScroll = () => {
    if (!outputRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current
    setShowScrollBottom(scrollHeight - (scrollTop + clientHeight) > 100)
  }

  // transcript 首屏是最新一页，往后每页更早，渲染时倒序拼接成时间正序
  const transcriptPages = transcriptQuery.data?.pages
  const transcriptItems = useMemo(
    () =>
      (transcriptPages ?? [])
        .slice()
        .reverse()
        .flatMap((page) => page.items),
    [transcriptPages],
  )
  const transcriptTimeline = useMemo(() => fromTranscript(transcriptItems), [transcriptItems])
  // 轮询期间用服务端 live 快照覆盖流式视图；live 为 null 时保留已有时间线，不清空
  const liveSnapshot = polling ? (runQuery.data?.live ?? null) : null
  const liveTimeline = useMemo(() => (liveSnapshot ? fromLiveSnapshot(liveSnapshot) : null), [liveSnapshot])
  const streamTimeline = liveTimeline ?? streamState.timeline
  const streamTurn = liveSnapshot ? liveSnapshot.turn : streamState.turn
  const streamMaxTurns = liveSnapshot ? liveSnapshot.maxTurns : streamState.maxTurns

  /** 流式内容的变化指纹，用于在生成过程中保持视图贴底。 */
  const streamSignature = streamTimeline
    .map((item) => {
      if (item.kind === 'message') return item.blocks.map((block) => block.text).join('')
      if (item.kind === 'tool') return `${item.key}:${item.status}`
      return item.key
    })
    .join('|')

  useEffect(() => {
    if (outputRef.current && !showScrollBottom) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [streamTimeline.length, streamSignature, transcriptItems.length, showScrollBottom])

  const refreshAfterRun = async () => {
    await Promise.all([
      transcriptQuery.refetch(),
      runQuery.refetch(),
      sessionDetailQuery.refetch(),
      sessionsQuery.refetch(),
    ])
  }

  const finishRun = async () => {
    setPolling(false)
    setStreaming(false)
    setPendingUserText(null)
    await refreshAfterRun()
    setStreamState(createEmptyHarnessStreamState())
  }

  // 轮询兜底：SSE 提前结束后靠 GET /runs/{runId} 跟进，Run 进终态或查询失败就停
  useEffect(() => {
    if (!polling) return
    const run = runQuery.data
    if (run && (run.status === 'starting' || run.status === 'running')) return
    if (!run && !runQuery.isError) return
    if (runQuery.isError) {
      setStreamError(runQuery.error instanceof Error ? runQuery.error.message : t('ai.sessions.runFailed'))
    }
    void finishRun()
  }, [polling, runQuery.data?.status, runQuery.isError])

  const handleStreamEvent = (event: Parameters<typeof reduceHarnessEvent>[1], token: number, sessionId: string) => {
    if (streamTokenRef.current !== token || selectedId !== sessionId) return
    setStreamState((current) => reduceHarnessEvent(current, event))
    if (event.runId) setActiveRunId(event.runId)
    if (event.type === 'run.failed') {
      setStreamError(event.data.error.message)
    }
    if (event.type === 'run.aborted') {
      setStreamError(null)
    }
  }

  const sendRun = async (customText?: string) => {
    const text = (customText ?? input).trim()
    if (!selectedId || !text || controllerRef.current || streaming) return
    const agentId = selectedAgentId
    if (!agentId) {
      message.warning(t('ai.sessions.agentRequired'))
      return
    }
    const sessionId = selectedId
    const token = ++streamTokenRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setInput('')
    setPendingUserText(text)
    setStreamError(null)
    setStreamState(createEmptyHarnessStreamState())
    setActiveRunId(null)
    setStreaming(true)
    try {
      const result = await startAgentRun(
        sessionId,
        { agentId, lane: 'main', input: text },
        controller.signal,
        (event) => handleStreamEvent(event, token, sessionId),
      )
      if (streamTokenRef.current === token && selectedId === sessionId) {
        if (result.terminal) {
          // Run 已终态：以服务端持久化结果替换临时流式视图
          await finishRun()
        } else {
          // SSE 提前结束（事件队列超限等）：Run 还在后台跑，保留已有时间线并转轮询
          setPolling(true)
        }
      }
    } catch (error) {
      if (streamTokenRef.current !== token || (error instanceof DOMException && error.name === 'AbortError')) return
      setStreaming(false)
      setPolling(false)
      setPendingUserText(null)
      setStreamError(error instanceof Error ? error.message : t('ai.sessions.runFailed'))
      // SSE 断开不调用 abort：读取服务端持久化结果恢复，用 transcript 替换临时视图
      await refreshAfterRun()
      setStreamState(createEmptyHarnessStreamState())
    } finally {
      if (streamTokenRef.current === token && controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }

  const stopRun = async () => {
    if (!selectedId) return
    const runId = streamState.runId ?? activeRunId
    if (!runId) return
    const sessionId = selectedId
    try {
      await abortRunMutation.mutateAsync({ sessionId, runId })
      await refreshAfterRun()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.sessions.runFailed'))
    }
  }

  const createSession = async () => {
    try {
      const session = await createSessionMutation.mutateAsync({ title: t('ai.sessions.defaultTitle') })
      streamTokenRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = null
      setStreamState(createEmptyHarnessStreamState())
      setStreamError(null)
      setPendingUserText(null)
      setPolling(false)
      setSelectedId(session.id)
      setMobileListOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.sessions.createFailed'))
    }
  }

  const confirmArchive = (sessionId: string) => {
    Modal.confirm({
      title: t('ai.sessions.archiveTitle'),
      content: t('ai.sessions.archiveConfirm'),
      okText: t('ai.sessions.archiveAction'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        await archiveSessionMutation.mutateAsync(sessionId)
        if (selectedId === sessionId) {
          streamTokenRef.current += 1
          controllerRef.current?.abort()
          controllerRef.current = null
          setStreamState(createEmptyHarnessStreamState())
          setStreamError(null)
          setPendingUserText(null)
          setPolling(false)
          setSelectedId(null)
        }
        message.success(t('ai.sessions.archived'))
      },
    })
  }

  const startTitleEdit = () => {
    if (!selectedSession) return
    setTitleDraft(selectedSession.title)
    setEditingTitle(true)
  }

  const saveTitle = async () => {
    const title = titleDraft.trim()
    if (!selectedId || !title) {
      setEditingTitle(false)
      return
    }
    try {
      await updateSessionMutation.mutateAsync({ sessionId: selectedId, values: { title } })
      setEditingTitle(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.sessions.saveFailed'))
    }
  }

  const selectSession = (sessionId: string) => {
    streamTokenRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setStreamState(createEmptyHarnessStreamState())
    setStreamError(null)
    setPendingUserText(null)
    setStreaming(false)
    setPolling(false)
    setActiveRunId(null)
    setSelectedId(sessionId)
    setMobileListOpen(false)
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void sendRun(event.currentTarget.value)
    }
  }

  const pendingUserItem: AgentTimelineItem | null = pendingUserText
    ? { key: 'pending-user', kind: 'user', content: pendingUserText, createdAt: null }
    : null
  const terminalStatus = streamState.terminal?.status
  const streamActive = streaming || streamState.runId !== null
  const canSend = Boolean(selectedId && !selectedSession?.archivedAt && !streaming && input.trim() && selectedAgentId)

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {sessionsQuery.error ? (
        <Alert
          className="mb-3 shrink-0 rounded-xl"
          showIcon
          type="error"
          message={t('ai.sessions.loadFailed')}
          description={sessionsQuery.error instanceof Error ? sessionsQuery.error.message : undefined}
          action={
            <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void sessionsQuery.refetch()}>
              {t('ai.sessions.retry')}
            </Button>
          }
        />
      ) : null}

      {sessionsQuery.isLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Spin />
        </div>
      ) : sessionsQuery.data?.items.length === 0 ? (
        <section className="border-border-subtle bg-surface flex min-h-0 flex-1 items-center justify-center rounded-2xl border shadow-xs">
          <Empty description={t('ai.sessions.emptyHint')}>
            <Button
              type="primary"
              icon={<Plus className="size-4" />}
              loading={createSessionMutation.isPending}
              onClick={() => void createSession()}
            >
              {t('ai.sessions.new')}
            </Button>
          </Empty>
        </section>
      ) : (
        <section className="border-border-subtle bg-surface flex min-h-0 flex-1 overflow-hidden rounded-2xl border shadow-xs">
          {isMobile ? (
            <Drawer
              title={t('ai.sessions.list')}
              placement="left"
              width="min(88vw, 320px)"
              open={mobileListOpen}
              onClose={() => setMobileListOpen(false)}
              styles={{ body: { padding: 0 } }}
            >
              <SessionList
                sessions={sessionsQuery.data}
                selectedId={selectedId}
                onSelect={selectSession}
                onCreate={() => void createSession()}
                onArchive={confirmArchive}
                createPending={createSessionMutation.isPending}
                archivePending={archiveSessionMutation.isPending}
              />
            </Drawer>
          ) : !sidebarCollapsed ? (
            <SessionList
              sessions={sessionsQuery.data}
              selectedId={selectedId}
              onSelect={selectSession}
              onCreate={() => void createSession()}
              onArchive={confirmArchive}
              createPending={createSessionMutation.isPending}
              archivePending={archiveSessionMutation.isPending}
              showCollapseBtn
              onCollapse={() => setSidebarCollapsed(true)}
            />
          ) : null}

          <main className="flex min-w-0 flex-1 flex-col">
            <div className="border-border-subtle/80 bg-surface/90 flex min-h-[56px] items-center justify-between gap-3 border-b px-4 py-2.5 backdrop-blur-xs sm:px-6">
              <div className="flex min-w-0 items-center gap-2.5">
                {isMobile ? (
                  <Button
                    type="text"
                    size="small"
                    icon={<MessageCircle className="size-4" />}
                    onClick={() => setMobileListOpen(true)}
                    aria-label={t('ai.sessions.list')}
                  />
                ) : sidebarCollapsed ? (
                  <Tooltip title={t('ai.sessions.expandSidebar')}>
                    <Button
                      type="text"
                      size="small"
                      icon={<PanelLeft className="size-4" />}
                      aria-label={t('ai.sessions.expandSidebar')}
                      onClick={() => setSidebarCollapsed(false)}
                    />
                  </Tooltip>
                ) : null}

                <div className="min-w-0">
                  {editingTitle ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        size="small"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={() => void saveTitle()}
                        onPressEnter={() => void saveTitle()}
                        maxLength={120}
                        aria-label={t('ai.sessions.titleEdit')}
                        className="w-56"
                      />
                      <Button
                        size="small"
                        type="text"
                        icon={<Plus className="size-3.5 rotate-45" />}
                        aria-label={t('common.cancel')}
                        onClick={() => setEditingTitle(false)}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h2 className="text-fg m-0 truncate text-sm font-semibold">{selectedSession?.title ?? ''}</h2>
                      {selectedSession?.archivedAt ? (
                        <Tag color="warning" className="m-0 text-[11px]">
                          {t('ai.sessions.archived')}
                        </Tag>
                      ) : null}
                      <Tooltip title={t('ai.sessions.titleEdit')}>
                        <Button
                          type="text"
                          size="small"
                          icon={<Pencil className="size-3.5" />}
                          aria-label={t('ai.sessions.titleEdit')}
                          disabled={!selectedSession || Boolean(selectedSession.archivedAt) || streamActive}
                          onClick={startTitleEdit}
                        />
                      </Tooltip>
                    </div>
                  )}
                  <div className="text-fg-muted mt-0.5 flex items-center gap-2 text-[11px]">
                    {selectedSession?.createdAt ? (
                      <span className="text-fg-muted/60">
                        {formatDate(selectedSession.createdAt, 'YYYY-MM-DD HH:mm')}
                      </span>
                    ) : null}
                    {runQuery.data ? (
                      <Tag
                        color={runQuery.data.status === 'completed' ? 'success' : 'processing'}
                        className="m-0 text-[11px]"
                      >
                        {t(`ai.sessions.runStatus.${runQuery.data.status}`)}
                      </Tag>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Select
                  className="w-[200px]"
                  size="small"
                  value={selectedAgentId ?? undefined}
                  onChange={setSelectedAgentId}
                  placeholder={t('ai.sessions.selectAgent')}
                  options={agents.map((agent) => ({ label: agent.name, value: agent.id }))}
                  disabled={streamActive || agents.length === 0}
                  notFoundContent={t('ai.sessions.noAgents')}
                />
              </div>
            </div>

            <div
              ref={outputRef}
              onScroll={handleScroll}
              className="chat-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8"
            >
              {transcriptQuery.isLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Spin />
                </div>
              ) : transcriptQuery.error ? (
                <Alert
                  showIcon
                  type="error"
                  message={t('ai.sessions.transcriptFailed')}
                  description={transcriptQuery.error instanceof Error ? transcriptQuery.error.message : undefined}
                  action={<Button onClick={() => void transcriptQuery.refetch()}>{t('ai.sessions.retry')}</Button>}
                />
              ) : transcriptItems.length === 0 && !streamActive && !pendingUserText ? (
                <div className="flex h-full items-center justify-center">
                  <Empty description={t('ai.sessions.transcriptEmpty')} />
                </div>
              ) : (
                <div className="mx-auto max-w-4xl space-y-4">
                  {transcriptQuery.hasNextPage ? (
                    <div className="flex justify-center">
                      <Button
                        size="small"
                        type="text"
                        icon={<ChevronUp className="size-3.5" />}
                        loading={transcriptQuery.isFetchingNextPage}
                        onClick={() => void transcriptQuery.fetchNextPage()}
                      >
                        {t('ai.sessions.loadEarlier')}
                      </Button>
                    </div>
                  ) : null}

                  <AgentTimeline items={transcriptTimeline} />

                  {pendingUserItem ? <AgentTimelineItemView item={pendingUserItem} /> : null}

                  <AgentTimeline items={streamTimeline} />

                  {streamActive || terminalStatus ? (
                    <div className="text-fg-muted flex flex-wrap items-center gap-2 px-1 text-[11px]">
                      {streamMaxTurns !== null && streamTurn > 0 ? (
                        <Tag className="m-0 text-[11px]">
                          {t('ai.sessions.turnProgress', {
                            turn: streamTurn,
                            maxTurns: streamMaxTurns,
                          })}
                        </Tag>
                      ) : null}
                      {!streamState.terminal ? (
                        <Tag
                          color="processing"
                          icon={<LoaderCircle className="size-3 animate-spin" />}
                          className="m-0 text-[11px]"
                        >
                          {t('ai.sessions.streaming')}
                        </Tag>
                      ) : null}
                      {terminalStatus ? (
                        <Tag color={terminalStatus === 'completed' ? 'success' : 'error'} className="m-0 text-[11px]">
                          {t(`ai.sessions.runStatus.${terminalStatus}`)}
                        </Tag>
                      ) : null}
                      {streamState.terminal?.reason === 'max_turns' ? (
                        <span className="text-warning">{t('ai.sessions.maxTurnsNotice')}</span>
                      ) : null}
                      {polling ? <span className="text-warning">{t('ai.sessions.pollingNotice')}</span> : null}
                    </div>
                  ) : null}
                </div>
              )}

              {streamError ? (
                <Alert
                  className="mx-auto mt-4 max-w-4xl rounded-xl"
                  showIcon
                  type="error"
                  icon={<CircleAlert className="size-4" />}
                  message={t('ai.sessions.errorTitle')}
                  description={streamError}
                />
              ) : null}

              {showScrollBottom ? (
                <div className="sticky bottom-3 right-0 z-10 flex justify-center pointer-events-none">
                  <button
                    type="button"
                    onClick={scrollToBottom}
                    className="pointer-events-auto border-border-subtle bg-surface/95 text-fg hover:text-primary hover:border-primary/40 active:scale-95 flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-md backdrop-blur-sm transition-all duration-200"
                  >
                    <ArrowDown className="size-3.5" />
                    <span>{t('ai.sessions.scrollToBottom')}</span>
                    {streamActive ? <span className="bg-primary size-1.5 rounded-full animate-ping" /> : null}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="border-border-subtle/80 bg-surface-muted/20 border-t p-3 sm:px-6 sm:py-4">
              {selectedSession?.archivedAt ? (
                <Alert className="mb-3 rounded-lg" type="warning" showIcon message={t('ai.sessions.archivedWarning')} />
              ) : null}
              <div className="mx-auto max-w-4xl">
                <div className="border-border-subtle bg-surface focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 rounded-2xl border p-3 shadow-2xs transition-all duration-200">
                  <TextArea
                    ref={textareaRef}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={handleInputKeyDown}
                    placeholder={t('ai.sessions.inputPlaceholder')}
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    maxLength={100000}
                    disabled={!selectedId || Boolean(selectedSession?.archivedAt) || streamActive}
                    variant="borderless"
                    className="chat-scrollbar p-1 text-sm leading-relaxed resize-none text-fg"
                  />

                  <div className="border-border-subtle/40 mt-2 flex items-center justify-between border-t pt-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-fg-muted/80 text-[11px]">{t('ai.sessions.keyboardHint')}</span>
                      {input.length > 0 ? (
                        <>
                          <span className="text-border-subtle">·</span>
                          <span className="text-fg-muted/70 text-[11px]">{input.length} 字</span>
                          <Button
                            type="text"
                            size="small"
                            className="text-fg-muted hover:text-fg h-auto p-0 text-[11px]"
                            icon={<Trash2 className="size-3" />}
                            onClick={() => setInput('')}
                          >
                            {t('ai.sessions.clearInput')}
                          </Button>
                        </>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      {streamActive ? (
                        <Button
                          danger
                          size="middle"
                          icon={<Square className="size-3.5" />}
                          loading={abortRunMutation.isPending}
                          onClick={() => void stopRun()}
                        >
                          {t('ai.sessions.stop')}
                        </Button>
                      ) : (
                        <Button
                          type="primary"
                          size="middle"
                          icon={<Send className="size-3.5" />}
                          disabled={!canSend}
                          onClick={() => void sendRun()}
                        >
                          {t('ai.sessions.send')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </section>
      )}
    </div>
  )
}
