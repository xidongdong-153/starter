import type { AgentTranscriptItem } from '@starter/contracts'
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
import type { HarnessStreamState } from '@admin/features/ai/harness/stream-reducer'
import { createEmptyHarnessStreamState, reduceHarnessEvent } from '@admin/features/ai/harness/stream-reducer'
import { useMobile } from '@admin/hooks/useMobile'
import { formatDate, formatRelativeTime } from '@admin/utils/dayjs'
import { App as AntdApp, Alert, Button, Drawer, Empty, Input, Modal, Select, Spin, Tag, Tooltip } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArrowDown,
  Bot,
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
  User,
  Wrench,
} from 'lucide-react'
import { MarkdownRenderer } from '../components/MarkdownRenderer'

const { TextArea } = Input
type TextAreaRef = GetRef<typeof Input.TextArea>
const sessionPage = { page: 1, pageSize: 50 }

function TranscriptItemView({ item }: { item: AgentTranscriptItem }) {
  const { t } = useTranslation()

  if (item.type === 'user_message') {
    return (
      <article className="flex justify-end">
        <div className="items-end flex max-w-[min(840px,94%)] flex-col gap-1.5">
          <div className="text-fg-muted flex items-center gap-2 px-1 text-xs">
            <span className="text-fg-muted/60 text-[11px]">{formatDate(item.createdAt, 'HH:mm')}</span>
            <span className="font-medium">{t('ai.sessions.user')}</span>
            <div className="bg-primary/15 text-primary border-primary/20 flex size-5.5 items-center justify-center rounded-full border">
              <User className="size-3.5" />
            </div>
          </div>
          <div className="bg-primary/10 border-primary/20 rounded-2xl rounded-tr-xs border px-4 py-3 sm:px-5 sm:py-3.5">
            <p className="text-fg m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.content}</p>
          </div>
        </div>
      </article>
    )
  }

  if (item.type === 'assistant_message') {
    const isDone = item.status === 'completed'
    const tagColor = isDone
      ? 'success'
      : item.status === 'aborted' || item.status === 'interrupted'
        ? 'warning'
        : 'error'
    return (
      <article className="flex justify-start">
        <div className="items-start flex max-w-[min(840px,94%)] flex-col gap-1.5">
          <div className="text-fg-muted flex items-center gap-2 px-1 text-xs">
            <div className="bg-surface-muted text-primary border-border-subtle flex size-5.5 items-center justify-center rounded-full border shadow-2xs">
              <Bot className="size-3.5" />
            </div>
            <span className="font-medium">{t('ai.sessions.assistant')}</span>
            {!isDone ? (
              <Tag color={tagColor} className="m-0 text-[11px]">
                {t(`ai.sessions.status.${item.status}`)}
              </Tag>
            ) : null}
            <span className="text-fg-muted/70 hidden font-mono text-[11px] sm:inline">
              {item.model.providerId}/{item.model.modelId}
            </span>
            <span className="text-fg-muted/60 text-[11px]">{formatDate(item.createdAt, 'HH:mm')}</span>
          </div>
          <div className="border-border-subtle bg-surface rounded-2xl rounded-tl-xs border px-4 py-3 sm:px-5 sm:py-3.5 shadow-2xs">
            <MarkdownRenderer content={item.content} />
          </div>
          {item.errorCode ? (
            <p className="text-danger border-danger/30 bg-danger/5 m-0 mt-2 rounded-lg border p-2 text-xs">
              {item.errorCode}
            </p>
          ) : null}
        </div>
      </article>
    )
  }

  if (item.type === 'tool_activity') {
    return <ToolActivityItem item={item} />
  }

  return (
    <div className="border-border-subtle bg-surface-muted/50 text-fg-muted my-2 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs">
      <Archive className="size-3.5 shrink-0" />
      <span>{t('ai.sessions.tool.compaction')}</span>
      <span className="text-fg-muted/70 min-w-0 flex-1 truncate">{item.summary}</span>
    </div>
  )
}

function ToolActivityItem({ item }: { item: Extract<AgentTranscriptItem, { type: 'tool_activity' }> }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const isSuccess = item.status === 'succeeded'
  const isError = [
    'failed',
    'not_found',
    'invalid_arguments',
    'forbidden',
    'timed_out',
    'cancelled',
    'interrupted',
  ].includes(item.status)

  return (
    <div className="border-border-subtle bg-surface-muted/50 my-2 overflow-hidden rounded-xl border text-xs shadow-2xs">
      <div
        className={`flex items-center justify-between px-3 py-2 ${
          item.safeSummary ? 'cursor-pointer select-none hover:bg-surface-muted/80' : ''
        }`}
        onClick={() => item.safeSummary && setExpanded(!expanded)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Wrench className="text-primary size-3.5 shrink-0" />
          <span className="text-fg font-mono font-medium">{item.name}</span>
          <Tag color={isSuccess ? 'success' : isError ? 'error' : 'default'} className="m-0 text-[11px]">
            {t(`ai.sessions.tool.status.${item.status}`)}
          </Tag>
        </div>
        {item.safeSummary ? (
          <span className="text-fg-muted text-[11px]">
            {expanded ? t('ai.sessions.expand') : t('ai.sessions.collapse')}
          </span>
        ) : null}
      </div>
      {expanded && item.safeSummary ? (
        <div className="border-border-subtle/80 bg-surface/50 chat-scrollbar max-h-48 overflow-y-auto border-t px-3 py-2 text-xs leading-5">
          <p className="text-fg-muted m-0 whitespace-pre-wrap font-mono">{item.safeSummary}</p>
        </div>
      ) : null}
    </div>
  )
}

function StreamingToolList({ tools }: { tools: HarnessStreamState['tools'] }) {
  const { t } = useTranslation()
  const [selectedTool, setSelectedTool] = useState<string | null>(null)
  const selected = tools.find((item) => item.toolCallId === selectedTool)

  if (tools.length === 0) return null

  return (
    <div className="border-border-subtle bg-surface-muted/50 mt-3 overflow-hidden rounded-xl border text-xs">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Wrench className="text-primary size-3.5 shrink-0" />
          <span className="text-fg-muted font-medium">{t('ai.sessions.tool.title')}</span>
          <span className="text-fg-muted/60 text-[11px]">{tools.length}</span>
        </div>
        {tools.some((item) => item.safeSummary) ? (
          <span className="text-fg-muted text-[11px]">
            {selectedTool ? t('ai.sessions.collapse') : t('ai.sessions.expand')}
          </span>
        ) : null}
      </div>
      <div className="border-border-subtle/60 flex gap-1.5 overflow-x-auto border-t px-2.5 py-2">
        {tools.map((tool) => {
          const isError = [
            'failed',
            'not_found',
            'invalid_arguments',
            'forbidden',
            'timed_out',
            'cancelled',
            'interrupted',
          ].includes(tool.status)
          const done = tool.status !== 'running'
          return (
            <button
              key={tool.toolCallId}
              type="button"
              onClick={() => setSelectedTool((current) => (current === tool.toolCallId ? null : tool.toolCallId))}
              className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 transition-colors ${
                selectedTool === tool.toolCallId
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-border-subtle bg-surface hover:border-primary/30'
              }`}
            >
              {done ? (
                <span className={isError ? 'text-danger size-2.5' : 'text-success size-2.5'}>
                  {isError ? '●' : '●'}
                </span>
              ) : (
                <LoaderCircle className="text-primary size-3 animate-spin" />
              )}
              <span className="text-fg font-mono text-[11px]">{tool.name}</span>
            </button>
          )
        })}
      </div>
      {selected?.safeSummary ? (
        <div className="border-border-subtle/80 bg-surface/50 chat-scrollbar max-h-40 overflow-y-auto border-t px-3 py-2">
          <p className="text-fg-muted m-0 whitespace-pre-wrap font-mono">{selected.safeSummary}</p>
        </div>
      ) : null}
    </div>
  )
}

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

  const controllerRef = useRef<AbortController | null>(null)
  const streamTokenRef = useRef(0)
  const outputRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<TextAreaRef | null>(null)

  const sessionDetailQuery = useAgentSessionQuery(selectedId)
  const transcriptQuery = useAgentTranscriptQuery(selectedId)
  const runQuery = useAgentRunQuery(selectedId, streamState.runId ?? activeRunId)

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

  useEffect(() => {
    if (outputRef.current && !showScrollBottom) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [
    streamState.messages.length,
    streamState.messages.map((m) => m.content).join(''),
    transcriptQuery.data?.items.length,
    showScrollBottom,
  ])

  const refreshAfterRun = async () => {
    await Promise.all([
      transcriptQuery.refetch(),
      runQuery.refetch(),
      sessionDetailQuery.refetch(),
      sessionsQuery.refetch(),
    ])
  }

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
      await startAgentRun(sessionId, { agentId, lane: 'main', input: text }, controller.signal, (event) =>
        handleStreamEvent(event, token, sessionId),
      )
      if (streamTokenRef.current === token && selectedId === sessionId) {
        // Run 已终态：以服务端持久化结果替换临时流式视图
        setPendingUserText(null)
        await refreshAfterRun()
        setStreaming(false)
        setStreamState(createEmptyHarnessStreamState())
      }
    } catch (error) {
      if (streamTokenRef.current !== token || (error instanceof DOMException && error.name === 'AbortError')) return
      setStreaming(false)
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

  const transcriptItems = transcriptQuery.data?.items ?? []
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
                <div className="mx-auto max-w-4xl space-y-6">
                  {transcriptItems.map((item) => (
                    <TranscriptItemView key={item.id} item={item} />
                  ))}

                  {pendingUserText ? (
                    <article className="flex justify-end">
                      <div className="items-end flex max-w-[min(840px,94%)] flex-col gap-1.5">
                        <div className="text-fg-muted flex items-center gap-2 px-1 text-xs">
                          <span>{t('ai.sessions.user')}</span>
                          <div className="bg-primary/15 text-primary border-primary/20 flex size-5.5 items-center justify-center rounded-full border">
                            <User className="size-3.5" />
                          </div>
                        </div>
                        <div className="bg-primary/10 border-primary/20 rounded-2xl rounded-tr-xs border px-4 py-3 sm:px-5 sm:py-3.5">
                          <p className="text-fg m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {pendingUserText}
                          </p>
                        </div>
                      </div>
                    </article>
                  ) : null}

                  {streamState.messages.length > 0 || streamState.tools.length > 0 ? (
                    <article className="flex justify-start">
                      <div className="items-start flex max-w-[min(840px,94%)] flex-col gap-1.5">
                        <div className="text-fg-muted flex items-center gap-2 px-1 text-xs">
                          <div className="bg-surface-muted text-primary border-border-subtle flex size-5.5 items-center justify-center rounded-full border shadow-2xs">
                            <Bot className="size-3.5" />
                          </div>
                          <span className="font-medium">{t('ai.sessions.assistant')}</span>
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
                            <Tag
                              color={terminalStatus === 'completed' ? 'success' : 'error'}
                              className="m-0 text-[11px]"
                            >
                              {t(`ai.sessions.runStatus.${terminalStatus}`)}
                            </Tag>
                          ) : null}
                        </div>
                        <div className="border-border-subtle bg-surface rounded-2xl rounded-tl-xs border px-4 py-3 sm:px-5 sm:py-3.5 shadow-2xs">
                          {streamState.messages.map((item) => (
                            <div key={item.messageId}>
                              {item.content ? (
                                <MarkdownRenderer content={item.content} />
                              ) : (
                                <div className="flex items-center gap-2 text-sm text-fg-muted">
                                  <LoaderCircle className="text-primary size-4 animate-spin" />
                                  <span>{t('ai.sessions.generating')}...</span>
                                </div>
                              )}
                            </div>
                          ))}
                          <StreamingToolList tools={streamState.tools} />
                        </div>
                      </div>
                    </article>
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
