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
import { AdminPageHeader } from '@admin/components/common'
import { useMobile } from '@admin/hooks/useMobile'
import { Alert, App, Button, Drawer, Empty, Input, Modal, Select, Spin, Tag, Tooltip } from 'antd'
import {
  Bot,
  CircleAlert,
  LoaderCircle,
  MessageCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input
const conversationPage = { page: 1, pageSize: 20 }

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

function MessageBlocks({ blocks, safeSummaries }: { blocks: AiConversationContentBlock[]; safeSummaries?: string[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((block) => {
        if (block.type === 'text') {
          return (
            <p key={block.blockId} className="text-fg m-0 whitespace-pre-wrap break-words text-sm leading-7">
              {block.text}
            </p>
          )
        }

        return (
          <div
            key={block.blockId}
            className="border-border-subtle bg-surface-muted flex items-start gap-2 rounded-lg border p-3"
          >
            <Wrench className="text-fg-muted mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-fg font-medium">{block.name}</span>
                <Tag
                  color={block.status === 'succeeded' ? 'success' : block.status === 'running' ? 'processing' : 'error'}
                >
                  {block.status}
                </Tag>
              </div>
              {safeSummaries?.length ? (
                <p className="text-fg-muted m-0 mt-1 break-words">{safeSummaries.join(' ')}</p>
              ) : null}
            </div>
          </div>
        )
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
  const isUser = message.role === 'user'
  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[min(760px,92%)] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className="text-fg-muted flex items-center gap-2 px-1 text-xs">
          {isUser ? t('ai.conversations.user') : t('ai.conversations.assistant')}
          {!isUser && message.status !== 'completed' ? (
            <Tag color={statusColor(message.status)}>{t(`ai.conversations.${message.status}`)}</Tag>
          ) : null}
        </div>
        <div
          className={`border-border-subtle border px-4 py-3 ${
            isUser ? 'bg-primary/10 rounded-2xl rounded-br-sm' : 'bg-surface rounded-2xl rounded-bl-sm'
          }`}
        >
          <MessageBlocks blocks={message.blocks} />
          {message.errorCode ? <p className="text-danger m-0 mt-2 break-words text-xs">{message.errorCode}</p> : null}
        </div>
        {retryable && message.generationId ? (
          <Button
            type="link"
            size="small"
            icon={<RotateCcw className="size-3.5" />}
            loading={retryPending}
            onClick={() => onRetry(message.generationId as string)}
          >
            {t('ai.conversations.retry')}
          </Button>
        ) : null}
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
}: {
  conversations: AiConversationList | undefined
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  createPending: boolean
  deletePending: boolean
}) {
  const { t } = useTranslation()
  const items = conversations?.items ?? []
  return (
    <aside className="border-border-subtle bg-surface/70 flex min-h-0 w-full flex-col border-r lg:w-[280px] lg:shrink-0">
      <div className="border-border-subtle flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="text-fg m-0 text-sm font-semibold">{t('ai.conversations.mobileConversations')}</p>
          <p className="text-fg-muted m-0 mt-0.5 text-xs">{items.length}</p>
        </div>
        <Tooltip title={t('ai.conversations.newConversation')}>
          <Button
            type="primary"
            shape="circle"
            icon={<Plus className="size-4" />}
            aria-label={t('ai.conversations.newConversation')}
            loading={createPending}
            onClick={onCreate}
          />
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('ai.conversations.listEmpty')} className="my-12" />
        ) : (
          <div className="space-y-1">
            {items.map((conversation) => (
              <div
                key={conversation.id}
                className={`group flex items-center gap-1 rounded-lg p-2 transition-colors ${
                  selectedId === conversation.id ? 'bg-primary/10 text-primary' : 'hover:bg-surface-muted'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-1 text-left"
                  onClick={() => onSelect(conversation.id)}
                >
                  <span className="text-fg block truncate text-sm font-medium">{conversation.title}</span>
                  <span className="text-fg-muted mt-1 block truncate text-xs">
                    {conversation.lastModel
                      ? `${conversation.lastModel.providerId} / ${conversation.lastModel.modelId}`
                      : t('ai.conversations.modelUnavailable')}
                  </span>
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
            ))}
          </div>
        )}
      </div>
    </aside>
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
  const [input, setInput] = useState('')
  const [selectedModelKey, setSelectedModelKey] = useState<string>()
  const [streamMeta, setStreamMeta] = useState<StreamMeta | null>(null)
  const [streamText, setStreamText] = useState('')
  const [pendingUserText, setPendingUserText] = useState<string | null>(null)
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [toolSummaries, setToolSummaries] = useState<string[]>([])
  const controllerRef = useRef<AbortController | null>(null)
  const streamTokenRef = useRef(0)
  const outputRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [streamText, selectedConversation?.messages.length])

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

  const sendMessage = () => {
    const text = input.trim()
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
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      sendMessage()
    }
  }

  const loadError = conversationsQuery.error ?? modelsQuery.error
  const isLoading = conversationsQuery.isLoading || modelsQuery.isLoading
  const streamActive = activeGenerationId !== null || streamStatus === 'streaming'
  const canSend = Boolean(selectedId && input.trim() && models.length > 0 && !streamActive)

  return (
    <div className="flex h-full min-h-[640px] flex-col">
      <AdminPageHeader
        title={t('ai.conversations.title')}
        description={t('ai.conversations.description')}
        actions={
          <Button
            icon={<Plus className="size-4" />}
            type="primary"
            loading={createConversationMutation.isPending}
            onClick={() => void createConversation()}
          >
            {t('ai.conversations.newConversation')}
          </Button>
        }
      />

      {loadError ? (
        <Alert
          className="mb-4"
          showIcon
          type="error"
          message={t('ai.conversations.loadFailed')}
          description={loadError instanceof Error ? loadError.message : undefined}
          action={
            <Button
              icon={<RefreshCw className="size-4" />}
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
        <section className="border-border-subtle bg-surface flex min-h-0 flex-1 items-center justify-center rounded-xl border">
          <Empty description={t('ai.conversations.empty')}>
            <p className="text-fg-muted mb-4 max-w-sm text-sm">{t('ai.conversations.emptyHint')}</p>
            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => void createConversation()}>
              {t('ai.conversations.newConversation')}
            </Button>
          </Empty>
        </section>
      ) : (
        <section className="border-border-subtle bg-surface flex min-h-0 flex-1 overflow-hidden rounded-xl border">
          {isMobile ? (
            <Drawer
              title={t('ai.conversations.mobileConversations')}
              placement="left"
              width="min(88vw, 340px)"
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
          ) : (
            <ConversationList
              conversations={conversationsQuery.data}
              selectedId={selectedId}
              onSelect={selectConversation}
              onCreate={() => void createConversation()}
              onDelete={confirmDelete}
              createPending={createConversationMutation.isPending}
              deletePending={deleteConversation.isPending}
            />
          )}

          <main className="flex min-w-0 flex-1 flex-col">
            <div className="border-border-subtle flex min-h-[60px] items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                {isMobile ? (
                  <Button
                    type="text"
                    icon={<MessageCircle className="size-4" />}
                    onClick={() => setMobileListOpen(true)}
                    aria-label={t('ai.conversations.mobileConversations')}
                  />
                ) : null}
                <div className="min-w-0">
                  <h2 className="text-fg m-0 truncate text-base font-semibold">
                    {selectedConversation?.title ?? t('ai.conversations.title')}
                  </h2>
                  {selectedConversation?.lastModel ? (
                    <p className="text-fg-muted m-0 mt-1 truncate text-xs">
                      {selectedConversation.lastModel.providerId} / {selectedConversation.lastModel.modelId}
                    </p>
                  ) : null}
                </div>
              </div>
              {selectedConversation?.status === 'generating' || streamActive ? (
                <Tag color="processing" icon={<LoaderCircle className="size-3 animate-spin" />}>
                  {t('ai.conversations.generating')}
                </Tag>
              ) : null}
            </div>

            <div ref={outputRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
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
                  {pendingUserText ? (
                    <article className="flex justify-end">
                      <div className="max-w-[min(760px,92%)]">
                        <div className="text-fg-muted mb-1 px-1 text-right text-xs">{t('ai.conversations.user')}</div>
                        <div className="border-border-subtle bg-primary/10 rounded-2xl rounded-br-sm border px-4 py-3">
                          <p className="text-fg m-0 whitespace-pre-wrap break-words text-sm leading-7">
                            {pendingUserText}
                          </p>
                        </div>
                      </div>
                    </article>
                  ) : null}
                  {streamActive ? (
                    <article className="flex justify-start">
                      <div className="max-w-[min(760px,92%)]">
                        <div className="text-fg-muted mb-1 flex items-center gap-2 px-1 text-xs">
                          <Bot className="size-3.5" />
                          {t('ai.conversations.assistant')}
                        </div>
                        <div className="border-border-subtle bg-surface rounded-2xl rounded-bl-sm border px-4 py-3">
                          <p className="text-fg m-0 whitespace-pre-wrap break-words text-sm leading-7">
                            {streamText || t('ai.conversations.generating')}
                            <span className="bg-primary ml-1 inline-block h-4 w-1.5 animate-pulse rounded-xs align-middle" />
                          </p>
                          {toolSummaries.length ? (
                            <div className="text-fg-muted mt-3 flex items-center gap-2 text-xs">
                              <Wrench className="size-3.5" />
                              {toolSummaries.join(' ')}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-full min-h-[280px] items-center justify-center">
                  <Empty
                    image={<MessageCircle className="text-fg-muted/50 mx-auto size-10" />}
                    description={t('ai.conversations.emptyMessages')}
                  />
                </div>
              )}
              {streamError ? (
                <Alert
                  className="mx-auto mt-5 max-w-4xl"
                  showIcon
                  type="error"
                  icon={<CircleAlert className="size-4" />}
                  message={t('ai.conversations.errorTitle')}
                  description={streamError}
                />
              ) : null}
            </div>

            <div className="border-border-subtle bg-surface-muted/40 border-t p-4 sm:px-8">
              {modelsQuery.data?.length === 0 ? (
                <Alert className="mb-3" type="warning" showIcon message={t('ai.conversations.modelUnavailable')} />
              ) : null}
              <div className="mx-auto max-w-4xl">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Select
                    className="w-full sm:max-w-[360px]"
                    options={modelOptions}
                    value={selectedModelKey}
                    onChange={setSelectedModelKey}
                    placeholder={t('ai.conversations.selectModel')}
                    showSearch
                    optionFilterProp="label"
                    disabled={streamActive || models.length === 0}
                  />
                  {streamActive ? (
                    <Button
                      danger
                      icon={<Square className="size-4" />}
                      loading={stopGeneration.isPending}
                      onClick={() => void stopStream()}
                    >
                      {t('ai.conversations.stop')}
                    </Button>
                  ) : null}
                </div>
                <TextArea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={t('ai.conversations.inputPlaceholder')}
                  autoSize={{ minRows: 2, maxRows: 8 }}
                  maxLength={100000}
                  disabled={!selectedId || streamActive}
                  className="resize-none"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-fg-muted text-xs">{input.length} / 100000</span>
                  <Button type="primary" icon={<Send className="size-4" />} disabled={!canSend} onClick={sendMessage}>
                    {t('ai.conversations.send')}
                  </Button>
                </div>
              </div>
            </div>
          </main>
        </section>
      )}
    </div>
  )
}
