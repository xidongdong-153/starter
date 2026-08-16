import type {
  AiConversationContentBlock,
  AiConversationList,
  AiConversationMessageDto,
  AiConversationStreamEvent,
  AiModelRef,
  AiUserModel,
} from '@starter/contracts'

import {
  retryAiConversation,
  streamAiConversation,
  useAiConversationQuery,
  useAiConversationsQuery,
  useAiModelsQuery,
  useAiPreferenceQuery,
  useCreateAiConversationMutation,
  useDeleteAiConversationMutation,
  useStopAiConversationGenerationMutation,
} from '@admin/api/ai'
import { useMobile } from '@admin/hooks/useMobile'
import { formatDate, formatRelativeTime } from '@admin/utils/dayjs'
import type { GetRef } from 'antd'
import { Alert, App, Button, Drawer, Empty, Input, Modal, Select, Spin, Tag, Tooltip } from 'antd'
import {
  ArrowDown,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Code2,
  Copy,
  Database,
  Eraser,
  FileCheck,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  PanelLeft,
  PanelLeftClose,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Square,
  Trash2,
  User,
  Wrench,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownRenderer } from '../components/MarkdownRenderer'

const { TextArea } = Input
type TextAreaRef = GetRef<typeof Input.TextArea>
const conversationPage = { page: 1, pageSize: 50 }

type StreamStatus = 'streaming' | 'completed' | 'aborted' | 'failed'

interface StreamMeta {
  assistantMessageId: string
  generationId: string
  model: AiModelRef
}

function modelKey(model: AiModelRef): string {
  return `${model.providerId}\u0000${model.modelId}`
}

function groupModelOptions(models: AiUserModel[]) {
  const providers = new Map<string, { label: string; options: { label: string; value: string }[] }>()
  for (const model of models) {
    const group = providers.get(model.providerId) ?? { label: model.providerName, options: [] }
    group.options.push({ label: model.name, value: modelKey(model) })
    providers.set(model.providerId, group)
  }
  return [...providers.values()]
}

function statusColor(status: AiConversationMessageDto['status']): string {
  if (status === 'completed') return 'success'
  if (status === 'aborted') return 'warning'
  if (status === 'failed' || status === 'interrupted') return 'error'
  return 'processing'
}

function ToolActivityItem({
  block,
  safeSummaries,
}: {
  block: AiConversationContentBlock & { type: 'tool_activity' }
  safeSummaries?: string[]
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const hasDetails = Boolean(safeSummaries && safeSummaries.length > 0)

  const isSuccess = block.status === 'succeeded'
  const isRunning = block.status === 'running'

  return (
    <div className="border-border-subtle bg-surface-muted/50 my-2 overflow-hidden rounded-xl border text-xs shadow-2xs">
      <div
        className={`flex items-center justify-between px-3 py-2 ${
          hasDetails ? 'cursor-pointer select-none hover:bg-surface-muted/80' : ''
        }`}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Wrench className="text-primary size-3.5 shrink-0" />
          <span className="text-fg font-mono font-medium">{block.name}</span>
          <Tag color={isSuccess ? 'success' : isRunning ? 'processing' : 'error'} className="m-0 text-[11px]">
            {isSuccess
              ? t('ai.conversations.toolSucceeded')
              : isRunning
                ? t('ai.conversations.toolRunning')
                : block.status}
          </Tag>
        </div>
        {hasDetails ? (
          <button
            type="button"
            className="text-fg-muted hover:text-fg flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs transition-colors"
          >
            <span>{expanded ? t('ai.conversations.collapse') : t('ai.conversations.expand')}</span>
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : null}
      </div>
      {expanded && safeSummaries?.length ? (
        <div className="border-border-subtle/80 bg-surface/50 chat-scrollbar max-h-48 overflow-y-auto border-t px-3 py-2 text-xs leading-5">
          <p className="text-fg-muted m-0 whitespace-pre-wrap font-mono">{safeSummaries.join('\n')}</p>
        </div>
      ) : null}
    </div>
  )
}

function MessageBlocks({ blocks, safeSummaries }: { blocks: AiConversationContentBlock[]; safeSummaries?: string[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((block) => {
        if (block.type === 'text') {
          return <MarkdownRenderer key={block.blockId} content={block.text} />
        }

        return <ToolActivityItem key={block.blockId} block={block} safeSummaries={safeSummaries} />
      })}
    </div>
  )
}

function ConversationMessage({
  message,
  onRetry,
  retryable,
  retryPending,
}: {
  message: AiConversationMessageDto
  onRetry: (generationId: string) => void
  retryable: boolean
  retryPending: boolean
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

  const fullText = useMemo(() => {
    return message.blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n\n')
  }, [message.blocks])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullText)
      setCopied(true)
      setTimeout(setCopied, 2000, false)
    } catch {
      // 剪贴板不可用时静默降级
    }
  }

  const timeString = message.createdAt ? formatDate(message.createdAt, 'HH:mm') : ''

  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'} group/msg`}>
      <div className={`max-w-[min(840px,94%)] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1.5`}>
        {/* Role & status header */}
        <div className="text-fg-muted flex items-center gap-2 px-1 text-xs">
          {isUser ? (
            <>
              {timeString ? <span className="text-fg-muted/60 text-[11px]">{timeString}</span> : null}
              <span className="font-medium">{t('ai.conversations.user')}</span>
              <div className="bg-primary/15 text-primary border-primary/20 flex size-5.5 items-center justify-center rounded-full border">
                <User className="size-3.5" />
              </div>
            </>
          ) : (
            <>
              <div className="bg-surface-muted text-primary border-border-subtle flex size-5.5 items-center justify-center rounded-full border shadow-2xs">
                <Bot className="size-3.5" />
              </div>
              <span className="font-medium">{t('ai.conversations.assistant')}</span>
              {message.status !== 'completed' ? (
                <Tag color={statusColor(message.status)} className="m-0 text-[11px]">
                  {t(`ai.conversations.${message.status}`)}
                </Tag>
              ) : null}
              {message.model ? (
                <span className="text-fg-muted/70 hidden font-mono text-[11px] sm:inline">
                  {message.model.providerId}/{message.model.modelId}
                </span>
              ) : null}
              {timeString ? <span className="text-fg-muted/60 text-[11px]">{timeString}</span> : null}
            </>
          )}
        </div>

        {/* Message bubble */}
        <div
          className={`border-border-subtle relative border px-4 py-3 sm:px-5 sm:py-3.5 transition-shadow ${
            isUser
              ? 'bg-primary/10 border-primary/20 rounded-2xl rounded-tr-xs'
              : 'bg-surface rounded-2xl rounded-tl-xs shadow-2xs'
          }`}
        >
          <MessageBlocks blocks={message.blocks} />
          {message.errorCode ? (
            <p className="text-danger border-danger/30 bg-danger/5 m-0 mt-3 rounded-lg border p-2 text-xs">
              {message.errorCode}
            </p>
          ) : null}
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 px-1 text-xs opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100">
          {fullText ? (
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="text-fg-muted hover:text-fg hover:bg-surface-muted/60 active:scale-95 inline-flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-0.5 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="text-success size-3" />
                  <span className="text-success text-[11px] font-medium">{t('ai.conversations.copySuccess')}</span>
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  <span className="text-[11px]">{t('ai.conversations.copy')}</span>
                </>
              )}
            </button>
          ) : null}

          {retryable && message.generationId ? (
            <Button
              type="link"
              size="small"
              className="h-auto p-0 text-[11px]"
              icon={<RotateCcw className="size-3" />}
              loading={retryPending}
              onClick={() => onRetry(message.generationId as string)}
            >
              {t('ai.conversations.retry')}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  createPending,
  deletePending,
  onCollapse,
  showCollapseBtn = false,
}: {
  conversations: AiConversationList | undefined
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  createPending: boolean
  deletePending: boolean
  onCollapse?: () => void
  showCollapseBtn?: boolean
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const rawItems = conversations?.items ?? []

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rawItems
    return rawItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.lastModel && `${item.lastModel.providerId} ${item.lastModel.modelId}`.toLowerCase().includes(q)),
    )
  }, [rawItems, search])

  return (
    <aside className="border-border-subtle bg-surface-muted/30 flex h-full min-h-0 w-full flex-col border-r lg:w-[280px] lg:shrink-0">
      {/* Sidebar header */}
      <div className="border-border-subtle/80 flex items-center justify-between border-b px-3.5 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="text-primary size-4.5" />
          <span className="text-fg text-sm font-semibold">{t('ai.conversations.title')}</span>
          <span className="border-border-subtle bg-surface-muted/80 text-fg-muted rounded-full border px-2 py-0.2 text-[11px]">
            {rawItems.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip title={t('ai.conversations.newConversation')}>
            <Button
              type="primary"
              size="small"
              icon={<Plus className="size-3.5" />}
              aria-label={t('ai.conversations.newConversation')}
              loading={createPending}
              onClick={onCreate}
            />
          </Tooltip>
          {showCollapseBtn && onCollapse ? (
            <Tooltip title={t('ai.conversations.collapseSidebar')}>
              <Button
                type="text"
                size="small"
                icon={<PanelLeftClose className="size-4" />}
                aria-label={t('ai.conversations.collapseSidebar')}
                onClick={onCollapse}
              />
            </Tooltip>
          ) : null}
        </div>
      </div>

      {/* Search filter */}
      <div className="border-border-subtle/60 border-b p-2.5">
        <Input
          role="searchbox"
          prefix={<Search className="text-fg-muted size-3.5" />}
          placeholder={t('ai.conversations.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          size="middle"
          className="rounded-lg text-xs"
        />
      </div>

      {/* Scrollable list */}
      <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={search ? t('ai.conversations.listEmpty') : t('ai.conversations.empty')}
            className="my-10 text-xs"
          />
        ) : (
          <div className="space-y-1">
            {items.map((conversation) => {
              const isSelected = selectedId === conversation.id
              const relativeTime = conversation.updatedAt ? formatRelativeTime(conversation.updatedAt) : ''

              return (
                <div
                  key={conversation.id}
                  className={`group relative flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all duration-150 ${
                    isSelected
                      ? 'bg-primary/10 text-primary border-primary/20 border-l-primary border border-l-3 shadow-2xs'
                      : 'border-transparent hover:bg-surface-muted/80 border'
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
                    onClick={() => onSelect(conversation.id)}
                  >
                    <span className={`block truncate text-sm font-medium ${isSelected ? 'text-primary' : 'text-fg'}`}>
                      {conversation.title || t('ai.conversations.title')}
                    </span>
                    <div className="text-fg-muted mt-1 flex items-center justify-between gap-1 text-[11px]">
                      <span className="truncate">
                        {conversation.lastModel
                          ? `${conversation.lastModel.providerId}/${conversation.lastModel.modelId}`
                          : t('ai.conversations.modelUnavailable')}
                      </span>
                      {relativeTime ? <span className="text-fg-muted/60 shrink-0">{relativeTime}</span> : null}
                    </div>
                  </button>
                  <Tooltip title={t('ai.conversations.delete')}>
                    <Button
                      type="text"
                      size="small"
                      danger
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      icon={<Trash2 className="size-3.5" />}
                      aria-label={`${t('ai.conversations.delete')}: ${conversation.title}`}
                      loading={deletePending}
                      onClick={() => onDelete(conversation.id)}
                    />
                  </Tooltip>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

function QuickStarters({ onSelectPrompt }: { onSelectPrompt: (prompt: string) => void }) {
  const { t } = useTranslation()

  const starters = [
    {
      title: '代码审查与重构',
      description: t('ai.conversations.quickPrompts.codeReview'),
      icon: <Code2 className="text-primary size-4" />,
      prompt: '请帮我审查以下代码，指出潜在的代码质量问题、边界异常与重构建议：\n\n```ts\n\n```',
    },
    {
      title: 'SQL 性能优化',
      description: t('ai.conversations.quickPrompts.sqlHelp'),
      icon: <Database className="text-primary size-4" />,
      prompt: '针对以下业务场景设计表结构，并编写高效且命中索引的 SQL 查询语句：\n\n业务需求：',
    },
    {
      title: '技术机制拆解',
      description: t('ai.conversations.quickPrompts.explainConcept'),
      icon: <Lightbulb className="text-primary size-4" />,
      prompt: '请用简明清晰的事实解释以下技术概念的工作机制、典型应用场景与常见误区：\n\n概念：',
    },
    {
      title: '编写单元测试',
      description: t('ai.conversations.quickPrompts.testGen'),
      icon: <FileCheck className="text-primary size-4" />,
      prompt: '请为以下业务函数编写完整的 Vitest / Jest 单元测试用例，覆盖正常与边界分支：\n\n```ts\n\n```',
    },
  ]

  return (
    <div className="mx-auto my-auto max-w-2xl px-4 py-8">
      <div className="mb-6 text-center">
        <div className="bg-primary/10 text-primary border-primary/20 mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl border shadow-2xs">
          <Bot className="size-6" />
        </div>
        <h3 className="text-fg m-0 text-base font-semibold">{t('ai.conversations.emptyMessages')}</h3>
        <p className="text-fg-muted m-0 mt-1 text-xs">{t('ai.conversations.quickPromptsTitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {starters.map((item, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectPrompt(item.prompt)}
            className="border-border-subtle bg-surface hover:border-primary/40 hover:bg-surface-muted/60 active:scale-[0.98] group flex cursor-pointer flex-col items-start rounded-xl border p-4 text-left shadow-2xs transition-all duration-150"
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="bg-surface-muted group-hover:bg-primary/10 rounded-lg p-1.5 transition-colors">
                {item.icon}
              </div>
              <span className="text-fg text-sm font-medium group-hover:text-primary transition-colors">
                {item.title}
              </span>
            </div>
            <p className="text-fg-muted m-0 line-clamp-2 text-xs leading-5">{item.description}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

export function AiConversations() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const isMobile = useMobile()
  const conversationsQuery = useAiConversationsQuery(conversationPage)
  const modelsQuery = useAiModelsQuery()
  const preferenceQuery = useAiPreferenceQuery()
  const createConversationMutation = useCreateAiConversationMutation()
  const deleteConversation = useDeleteAiConversationMutation()
  const stopGeneration = useStopAiConversationGenerationMutation()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobileListOpen, setMobileListOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [input, setInput] = useState('')
  const [selectedModelKey, setSelectedModelKey] = useState<string>()
  const [streamMeta, setStreamMeta] = useState<StreamMeta | null>(null)
  const [streamText, setStreamText] = useState('')
  const [pendingUserText, setPendingUserText] = useState<string | null>(null)
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [toolSummaries, setToolSummaries] = useState<string[]>([])
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  const controllerRef = useRef<AbortController | null>(null)
  const streamTokenRef = useRef(0)
  const outputRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<TextAreaRef | null>(null)

  const detailQuery = useAiConversationQuery(selectedId)
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data])
  const modelMap = useMemo(() => new Map(models.map((model) => [modelKey(model), model])), [models])
  const modelOptions = useMemo(() => groupModelOptions(models), [models])
  const selectedConversation = detailQuery.data
  const activeGenerationId = streamMeta?.generationId ?? selectedConversation?.activeGenerationId ?? null
  const latestAssistant = [...(selectedConversation?.messages ?? [])]
    .reverse()
    .find((item) => item.role === 'assistant')
  const retryableMessage =
    latestAssistant && ['failed', 'aborted', 'interrupted'].includes(latestAssistant.status) ? latestAssistant : null

  useEffect(() => {
    const items = conversationsQuery.data?.items ?? []
    if (selectedId === null && items[0]) setSelectedId(items[0].id)
    if (selectedId && !items.some((item) => item.id === selectedId)) setSelectedId(items[0]?.id ?? null)
  }, [conversationsQuery.data?.items, selectedId])

  useEffect(() => {
    if (selectedModelKey !== undefined) return
    const effective = preferenceQuery.data?.effectiveModel
    if (effective) setSelectedModelKey(modelKey(effective))
  }, [preferenceQuery.data?.effectiveModel, selectedModelKey])

  const scrollToBottom = () => {
    if (outputRef.current) {
      outputRef.current.scrollTo({
        top: outputRef.current.scrollHeight,
        behavior: 'smooth',
      })
      setShowScrollBottom(false)
    }
  }

  const handleScroll = () => {
    if (!outputRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current
    const isFarFromBottom = scrollHeight - (scrollTop + clientHeight) > 100
    setShowScrollBottom(isFarFromBottom)
  }

  // 智能吸底：仅在未主动向上滚动翻看历史时自动跟随滚动
  useEffect(() => {
    if (outputRef.current && !showScrollBottom) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [streamText, selectedConversation?.messages.length, showScrollBottom])

  useEffect(
    () => () => {
      streamTokenRef.current += 1
      controllerRef.current?.abort()
    },
    [],
  )

  const resetStream = () => {
    setStreamMeta(null)
    setStreamText('')
    setPendingUserText(null)
    setStreamStatus(null)
    setStreamError(null)
    setToolSummaries([])
  }

  const refreshConversation = async (conversationId: string) => {
    await Promise.all([conversationsQuery.refetch(), detailQuery.refetch()])
    if (selectedId === conversationId) {
      setStreamMeta(null)
      setStreamText('')
      setPendingUserText(null)
      setToolSummaries([])
    }
  }

  const handleStreamEvent = (event: AiConversationStreamEvent, token: number, conversationId: string) => {
    if (streamTokenRef.current !== token || selectedId !== conversationId) return
    if (event.type === 'start') {
      setStreamMeta({
        assistantMessageId: event.assistantMessageId,
        generationId: event.generationId,
        model: event.model,
      })
      setStreamStatus('streaming')
      return
    }
    if (event.type === 'text_delta') {
      setStreamText((current) => current + event.text)
      return
    }
    if (event.type === 'tool_activity') {
      if (event.safeSummary) setToolSummaries((current) => [...current, event.safeSummary as string])
      return
    }
    if (event.type === 'completed') {
      setStreamStatus('completed')
      return
    }
    setStreamStatus(event.code === 'AI.REQUEST_ABORTED' ? 'aborted' : 'failed')
    setStreamError(event.message)
  }

  const startStream = async (
    conversationId: string,
    request: () => Promise<void>,
    token: number,
    controller: AbortController,
  ) => {
    try {
      await request()
      if (streamTokenRef.current === token && selectedId === conversationId) {
        await refreshConversation(conversationId)
      }
    } catch (error) {
      if (streamTokenRef.current !== token || (error instanceof DOMException && error.name === 'AbortError')) return
      setStreamStatus('failed')
      setStreamError(error instanceof Error ? error.message : t('ai.conversations.failed'))
      setPendingUserText(null)
      try {
        await refreshConversation(conversationId)
      } catch {
        setStreamMeta(null)
      }
    } finally {
      if (streamTokenRef.current === token && controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }

  const sendMessage = (customText?: string) => {
    const text = (customText ?? input).trim()
    if (!selectedId || !text || controllerRef.current || activeGenerationId || models.length === 0) return
    const conversationId = selectedId
    const model = selectedModelKey ? modelMap.get(selectedModelKey) : undefined
    const token = ++streamTokenRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setInput('')
    setStreamText('')
    setPendingUserText(text)
    setStreamError(null)
    setToolSummaries([])
    setStreamStatus('streaming')
    void startStream(
      conversationId,
      () =>
        streamAiConversation(
          {
            conversationId,
            text,
            ...(model ? { model: { providerId: model.providerId, modelId: model.modelId } } : {}),
          },
          controller.signal,
          (event) => handleStreamEvent(event, token, conversationId),
        ),
      token,
      controller,
    )
  }

  const retryMessage = (generationId: string) => {
    if (!selectedId || controllerRef.current || activeGenerationId) return
    const conversationId = selectedId
    const model = selectedModelKey ? modelMap.get(selectedModelKey) : undefined
    const token = ++streamTokenRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setStreamText('')
    setPendingUserText(null)
    setStreamError(null)
    setToolSummaries([])
    setStreamStatus('streaming')
    void startStream(
      conversationId,
      () =>
        retryAiConversation(
          {
            conversationId,
            generationId,
            ...(model ? { model: { providerId: model.providerId, modelId: model.modelId } } : {}),
          },
          controller.signal,
          (event) => handleStreamEvent(event, token, conversationId),
        ),
      token,
      controller,
    )
  }

  const stopStream = async () => {
    if (!selectedId || !activeGenerationId) return
    const conversationId = selectedId
    const generationId = activeGenerationId
    try {
      await stopGeneration.mutateAsync({ conversationId, generationId })
      message.success(t('ai.conversations.stopSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.conversations.failed'))
    }
  }

  const createConversation = async () => {
    try {
      const conversation = await createConversationMutation.mutateAsync({})
      streamTokenRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = null
      resetStream()
      setSelectedId(conversation.id)
      setMobileListOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.conversations.createFailed'))
    }
  }

  const confirmDelete = (conversationId: string) => {
    Modal.confirm({
      title: t('ai.conversations.delete'),
      content: t('ai.conversations.deleteConfirm'),
      okText: t('ai.conversations.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        await deleteConversation.mutateAsync(conversationId)
        if (selectedId === conversationId) {
          streamTokenRef.current += 1
          controllerRef.current?.abort()
          controllerRef.current = null
          const next = conversationsQuery.data?.items.find((item) => item.id !== conversationId)
          setSelectedId(next?.id ?? null)
          resetStream()
        }
        message.success(t('ai.conversations.deleteSuccess'))
      },
    })
  }

  const selectConversation = (conversationId: string) => {
    streamTokenRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    resetStream()
    setSelectedId(conversationId)
    setMobileListOpen(false)
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      sendMessage()
    }
  }

  const handlePromptSelect = (promptText: string) => {
    setInput(promptText)
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)
  }

  const loadError = conversationsQuery.error ?? modelsQuery.error
  const isLoading = conversationsQuery.isLoading || modelsQuery.isLoading
  const streamActive = activeGenerationId !== null || streamStatus === 'streaming'
  const canSend = Boolean(selectedId && input.trim() && models.length > 0 && !streamActive)

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {loadError ? (
        <Alert
          className="mb-3 shrink-0 rounded-xl"
          showIcon
          type="error"
          message={t('ai.conversations.loadFailed')}
          description={loadError instanceof Error ? loadError.message : undefined}
          action={
            <Button
              size="small"
              icon={<RefreshCw className="size-3.5" />}
              onClick={() => void Promise.all([conversationsQuery.refetch(), modelsQuery.refetch()])}
            >
              {t('ai.conversations.retryLoad')}
            </Button>
          }
        />
      ) : null}

      {isLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Spin />
        </div>
      ) : conversationsQuery.data?.items.length === 0 ? (
        <section className="border-border-subtle bg-surface flex min-h-0 flex-1 items-center justify-center rounded-2xl border shadow-xs">
          <Empty description={t('ai.conversations.empty')}>
            <p className="text-fg-muted mb-4 max-w-sm text-sm">{t('ai.conversations.emptyHint')}</p>
            <Button
              type="primary"
              icon={<Plus className="size-4" />}
              loading={createConversationMutation.isPending}
              onClick={() => void createConversation()}
            >
              {t('ai.conversations.newConversation')}
            </Button>
          </Empty>
        </section>
      ) : (
        <section className="border-border-subtle bg-surface flex min-h-0 flex-1 overflow-hidden rounded-2xl border shadow-xs">
          {/* Mobile drawer list */}
          {isMobile ? (
            <Drawer
              title={t('ai.conversations.mobileConversations')}
              placement="left"
              width="min(88vw, 320px)"
              open={mobileListOpen}
              onClose={() => setMobileListOpen(false)}
              styles={{ body: { padding: 0 } }}
            >
              <ConversationList
                conversations={conversationsQuery.data}
                selectedId={selectedId}
                onSelect={selectConversation}
                onCreate={() => void createConversation()}
                onDelete={confirmDelete}
                createPending={createConversationMutation.isPending}
                deletePending={deleteConversation.isPending}
              />
            </Drawer>
          ) : !sidebarCollapsed ? (
            <ConversationList
              conversations={conversationsQuery.data}
              selectedId={selectedId}
              onSelect={selectConversation}
              onCreate={() => void createConversation()}
              onDelete={confirmDelete}
              createPending={createConversationMutation.isPending}
              deletePending={deleteConversation.isPending}
              showCollapseBtn
              onCollapse={() => setSidebarCollapsed(true)}
            />
          ) : null}

          {/* Main chat viewport & composer */}
          <main className="flex min-w-0 flex-1 flex-col">
            {/* Chat header */}
            <div className="border-border-subtle/80 bg-surface/90 flex min-h-[56px] items-center justify-between gap-3 border-b px-4 py-2.5 backdrop-blur-xs sm:px-6">
              <div className="flex min-w-0 items-center gap-2.5">
                {isMobile ? (
                  <Button
                    type="text"
                    size="small"
                    icon={<MessageCircle className="size-4" />}
                    onClick={() => setMobileListOpen(true)}
                    aria-label={t('ai.conversations.mobileConversations')}
                  />
                ) : sidebarCollapsed ? (
                  <Tooltip title={t('ai.conversations.expandSidebar')}>
                    <Button
                      type="text"
                      size="small"
                      icon={<PanelLeft className="size-4" />}
                      aria-label={t('ai.conversations.expandSidebar')}
                      onClick={() => setSidebarCollapsed(false)}
                    />
                  </Tooltip>
                ) : null}

                <div className="min-w-0">
                  <h2 className="text-fg m-0 truncate text-sm font-semibold">
                    {selectedConversation?.title || t('ai.conversations.title')}
                  </h2>
                  <div className="text-fg-muted mt-0.5 flex items-center gap-2 text-[11px]">
                    {selectedConversation?.lastModel ? (
                      <span className="font-mono">
                        {selectedConversation.lastModel.providerId}/{selectedConversation.lastModel.modelId}
                      </span>
                    ) : null}
                    {selectedConversation?.updatedAt ? (
                      <span className="text-fg-muted/60">
                        {formatDate(selectedConversation.updatedAt, 'YYYY-MM-DD HH:mm')}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Right actions: Model selector & Status */}
              <div className="flex items-center gap-2">
                <Select
                  className="w-[180px] sm:w-[220px]"
                  size="small"
                  options={modelOptions}
                  value={selectedModelKey}
                  onChange={setSelectedModelKey}
                  placeholder={t('ai.conversations.selectModel')}
                  showSearch
                  optionFilterProp="label"
                  disabled={streamActive || models.length === 0}
                />

                {selectedConversation?.status === 'generating' || streamActive ? (
                  <Tag
                    color="processing"
                    icon={<LoaderCircle className="size-3 animate-spin" />}
                    className="m-0 text-[11px]"
                  >
                    {t('ai.conversations.generating')}
                  </Tag>
                ) : null}

                <Tooltip title={t('ai.conversations.newConversation')}>
                  <Button
                    type="default"
                    size="small"
                    icon={<Plus className="size-3.5" />}
                    onClick={() => void createConversation()}
                    loading={createConversationMutation.isPending}
                  />
                </Tooltip>
              </div>
            </div>

            {/* Message scroll container */}
            <div
              ref={outputRef}
              onScroll={handleScroll}
              className="chat-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8"
            >
              {detailQuery.isLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Spin />
                </div>
              ) : detailQuery.error ? (
                <Alert
                  showIcon
                  type="error"
                  message={t('ai.conversations.detailFailed')}
                  description={detailQuery.error instanceof Error ? detailQuery.error.message : undefined}
                  action={<Button onClick={() => void detailQuery.refetch()}>{t('ai.conversations.retryLoad')}</Button>}
                />
              ) : selectedConversation?.messages.length || streamActive ? (
                <div className="mx-auto max-w-4xl space-y-6">
                  {(selectedConversation?.messages ?? []).map((item, index) => (
                    <ConversationMessage
                      key={item.id}
                      message={item}
                      onRetry={retryMessage}
                      retryable={
                        retryableMessage?.id === item.id && index === (selectedConversation?.messages.length ?? 0) - 1
                      }
                      retryPending={streamActive}
                    />
                  ))}

                  {/* Pending user optimistic message */}
                  {pendingUserText ? (
                    <article className="flex justify-end">
                      <div className="max-w-[min(840px,94%)] items-end flex flex-col gap-1.5">
                        <div className="text-fg-muted flex items-center gap-2 px-1 text-xs">
                          <span>{t('ai.conversations.user')}</span>
                          <div className="bg-primary/15 text-primary border-primary/20 flex size-5.5 items-center justify-center rounded-full border">
                            <User className="size-3.5" />
                          </div>
                        </div>
                        <div className="border-primary/20 bg-primary/10 rounded-2xl rounded-tr-xs border px-4 py-3 sm:px-5 sm:py-3.5">
                          <p className="text-fg m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {pendingUserText}
                          </p>
                        </div>
                      </div>
                    </article>
                  ) : null}

                  {/* Streaming assistant message */}
                  {streamActive ? (
                    <article className="flex justify-start">
                      <div className="max-w-[min(840px,94%)] items-start flex flex-col gap-1.5">
                        <div className="text-fg-muted flex items-center gap-2 px-1 text-xs">
                          <div className="bg-surface-muted text-primary border-border-subtle flex size-5.5 items-center justify-center rounded-full border shadow-2xs">
                            <Bot className="size-3.5" />
                          </div>
                          <span className="font-medium">{t('ai.conversations.assistant')}</span>
                          <Tag
                            color="processing"
                            icon={<LoaderCircle className="size-3 animate-spin" />}
                            className="m-0 text-[11px]"
                          >
                            {t('ai.conversations.streaming')}
                          </Tag>
                        </div>
                        <div className="border-border-subtle bg-surface rounded-2xl rounded-tl-xs border px-4 py-3 sm:px-5 sm:py-3.5 shadow-2xs">
                          {streamText ? (
                            <div>
                              <MarkdownRenderer content={streamText} />
                              <span className="bg-primary ml-1 inline-block h-4 w-1.5 animate-pulse rounded-xs align-middle" />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-sm text-fg-muted">
                              <LoaderCircle className="size-4 animate-spin text-primary" />
                              <span>{t('ai.conversations.generating')}...</span>
                            </div>
                          )}
                          {toolSummaries.length ? (
                            <div className="border-border-subtle bg-surface-muted/60 chat-scrollbar mt-3 max-h-48 overflow-y-auto rounded-xl border p-2.5 text-xs">
                              <div className="text-fg-muted mb-1 flex items-center gap-1.5 font-medium">
                                <Wrench className="size-3 text-primary" />
                                <span>{t('ai.conversations.toolActivity')}</span>
                              </div>
                              <p className="text-fg m-0 font-mono text-[11px] leading-5">{toolSummaries.join('\n')}</p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ) : null}
                </div>
              ) : (
                <QuickStarters onSelectPrompt={handlePromptSelect} />
              )}

              {streamError ? (
                <Alert
                  className="mx-auto mt-5 max-w-4xl rounded-xl"
                  showIcon
                  type="error"
                  icon={<CircleAlert className="size-4" />}
                  message={t('ai.conversations.errorTitle')}
                  description={streamError}
                />
              ) : null}

              {/* Floating smooth scroll to bottom capsule */}
              {showScrollBottom ? (
                <div className="sticky bottom-3 right-0 z-10 flex justify-center pointer-events-none">
                  <button
                    type="button"
                    onClick={scrollToBottom}
                    className="pointer-events-auto border-border-subtle bg-surface/95 text-fg hover:text-primary hover:border-primary/40 active:scale-95 flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-md backdrop-blur-sm transition-all duration-200"
                  >
                    <ArrowDown className="size-3.5" />
                    <span>{t('ai.conversations.scrollToBottom')}</span>
                    {streamActive ? <span className="bg-primary size-1.5 rounded-full animate-ping" /> : null}
                  </button>
                </div>
              ) : null}
            </div>

            {/* Input composer footer */}
            <div className="border-border-subtle/80 bg-surface-muted/20 border-t p-3 sm:px-6 sm:py-4">
              {modelsQuery.data?.length === 0 ? (
                <Alert
                  className="mb-3 rounded-lg"
                  type="warning"
                  showIcon
                  message={t('ai.conversations.modelUnavailable')}
                />
              ) : null}
              <div className="mx-auto max-w-4xl">
                <div className="border-border-subtle bg-surface focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 rounded-2xl border p-3 shadow-2xs transition-all duration-200">
                  <TextArea
                    ref={textareaRef}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={handleInputKeyDown}
                    placeholder={t('ai.conversations.inputPlaceholder')}
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    maxLength={100000}
                    disabled={!selectedId || streamActive}
                    variant="borderless"
                    className="chat-scrollbar p-1 text-sm leading-relaxed resize-none text-fg"
                  />

                  <div className="border-border-subtle/40 mt-2 flex items-center justify-between border-t pt-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-fg-muted/80 text-[11px]">{t('ai.conversations.keyboardHint')}</span>
                      {input.length > 0 ? (
                        <>
                          <span className="text-border-subtle">·</span>
                          <span className="text-fg-muted/70 text-[11px]">{input.length} 字</span>
                          <Button
                            type="text"
                            size="small"
                            className="text-fg-muted hover:text-fg h-auto p-0 text-[11px]"
                            icon={<Eraser className="size-3" />}
                            onClick={() => setInput('')}
                          >
                            {t('ai.conversations.clearInput')}
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
                          loading={stopGeneration.isPending}
                          onClick={() => void stopStream()}
                        >
                          {t('ai.conversations.stop')}
                        </Button>
                      ) : (
                        <Button
                          type="primary"
                          size="middle"
                          icon={<Send className="size-3.5" />}
                          disabled={!canSend}
                          onClick={() => sendMessage()}
                        >
                          {t('ai.conversations.send')}
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
