import type { AiModelRef, AiTestStreamEvent, AiUserModel } from '@starter/contracts'

import { streamAiTest, useAiModelsQuery, useAiPreferenceQuery, useUpdateAiPreferenceMutation } from '@admin/api/ai'
import { AdminPageHeader } from '@admin/components/common'
import { Alert, App, Button, Empty, Input, Select, Spin, Tag, Tooltip, Typography } from 'antd'
import { Bot, Check, Copy, Eraser, RotateCcw, Save, Send, Sparkles, Square, Terminal, Trash2, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input

function refKey(ref: AiModelRef): string {
  return `${ref.providerId}\u0000${ref.modelId}`
}

function groupModelOptions(models: AiUserModel[]) {
  const providers = new Map<string, { label: string; options: { label: string; value: string }[] }>()
  for (const model of models) {
    const group = providers.get(model.providerId) ?? { label: model.providerName, options: [] }
    group.options.push({ label: model.name, value: refKey(model) })
    providers.set(model.providerId, group)
  }
  return [...providers.values()]
}

export function AiSettings() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const modelsQuery = useAiModelsQuery()
  const preferenceQuery = useAiPreferenceQuery()
  const updatePreference = useUpdateAiPreferenceMutation()
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data])
  const modelMap = useMemo(() => new Map(models.map((model) => [refKey(model), model])), [models])
  const modelOptions = useMemo(() => groupModelOptions(models), [models])

  const [selectedKey, setSelectedKey] = useState<string | undefined>()
  const [testModelKey, setTestModelKey] = useState<string | undefined>()
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const [streamError, setStreamError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [copied, setCopied] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const outputContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const selected = preferenceQuery.data?.selectedModel
    const effective = preferenceQuery.data?.effectiveModel
    setSelectedKey(selected ? refKey(selected) : undefined)
    setTestModelKey((current) => current ?? (effective ? refKey(effective) : undefined))
  }, [preferenceQuery.data])

  useEffect(
    () => () => {
      generationRef.current += 1
      controllerRef.current?.abort()
    },
    [],
  )

  useEffect(() => {
    if (outputContainerRef.current) {
      outputContainerRef.current.scrollTop = outputContainerRef.current.scrollHeight
    }
  }, [answer])

  const savePreference = async () => {
    const model = selectedKey ? modelMap.get(selectedKey) : undefined
    try {
      await updatePreference.mutateAsync(model ? { providerId: model.providerId, modelId: model.modelId } : null)
      message.success(t('ai.preference.saveSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.preference.saveFailed'))
    }
  }

  const clearPreference = async () => {
    setSelectedKey(undefined)
    try {
      await updatePreference.mutateAsync(null)
      message.success(t('ai.preference.clearSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.preference.saveFailed'))
    }
  }

  const handleStreamEvent = (event: AiTestStreamEvent, generation: number) => {
    if (generationRef.current !== generation) return
    if (event.type === 'text_delta') setAnswer((current) => current + event.text)
    if (event.type === 'error') setStreamError(event.message)
  }

  const runTest = async () => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) return
    generationRef.current += 1
    const generation = generationRef.current
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setAnswer('')
    setStreamError(null)
    setStreaming(true)
    const selectedModel = testModelKey ? modelMap.get(testModelKey) : undefined

    try {
      await streamAiTest(
        {
          prompt: trimmedPrompt,
          ...(selectedModel ? { model: { providerId: selectedModel.providerId, modelId: selectedModel.modelId } } : {}),
        },
        controller.signal,
        (event) => handleStreamEvent(event, generation),
      )
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError') && generationRef.current === generation) {
        setStreamError(error instanceof Error ? error.message : t('ai.test.failed'))
      }
    } finally {
      if (generationRef.current === generation) setStreaming(false)
    }
  }

  const stopTest = () => {
    generationRef.current += 1
    controllerRef.current?.abort()
    setStreaming(false)
  }

  const copyAnswer = async () => {
    if (!answer) return
    try {
      await navigator.clipboard.writeText(answer)
      setCopied(true)
      message.success(t('ai.test.copySuccess'))
      setTimeout(setCopied, 2000, false)
    } catch {
      message.error(t('ai.test.copyFailed'))
    }
  }

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (!streaming && prompt.trim() && models.length > 0) {
        void runTest()
      }
    }
  }

  if (modelsQuery.isLoading || preferenceQuery.isLoading) {
    return <Spin className="mt-20 block" />
  }

  const loadError = modelsQuery.error ?? preferenceQuery.error
  const effectiveModel = preferenceQuery.data?.effectiveModel
  const effectiveSource = preferenceQuery.data?.effectiveSource
  const currentTestModel = testModelKey
    ? modelMap.get(testModelKey)
    : effectiveModel
      ? modelMap.get(refKey(effectiveModel))
      : undefined

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t('ai.title')} description={t('ai.description')} />

      {loadError ? (
        <Alert
          showIcon
          type="error"
          message={t('ai.loadFailed')}
          description={loadError instanceof Error ? loadError.message : undefined}
          action={
            <Button onClick={() => void Promise.all([modelsQuery.refetch(), preferenceQuery.refetch()])}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : null}

      {/* 默认模型设置卡片 */}
      <section className="border-border-subtle bg-surface/85 rounded-2xl border p-5 shadow-sm backdrop-blur-xs sm:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="border-border-subtle bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg border">
              <Bot className="size-4" />
            </div>
            <div>
              <h2 className="text-fg text-base font-semibold tracking-tight">{t('ai.preference.title')}</h2>
              <p className="text-fg-muted text-xs sm:text-sm">{t('ai.preference.description')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              icon={<Trash2 className="size-4" />}
              disabled={!preferenceQuery.data?.selectedModel}
              loading={updatePreference.isPending}
              onClick={() => void clearPreference()}
            >
              {t('ai.preference.clear')}
            </Button>
            <Button
              type="primary"
              icon={<Save className="size-4" />}
              loading={updatePreference.isPending}
              onClick={() => void savePreference()}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>

        {models.length === 0 ? (
          <Empty description={t('ai.models.empty')} className="my-6" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center">
            <div>
              <label className="text-fg-muted mb-1.5 block text-xs font-medium">{t('ai.preference.placeholder')}</label>
              <Select
                allowClear
                className="w-full"
                options={modelOptions}
                placeholder={t('ai.preference.placeholder')}
                value={selectedKey}
                onChange={setSelectedKey}
                showSearch
                optionFilterProp="label"
                size="large"
              />
            </div>

            <div className="border-border-subtle bg-surface-muted/60 flex items-center justify-between rounded-xl border px-4 py-3">
              <div className="min-w-0 flex-1">
                <span className="text-fg-muted block text-xs">{t('ai.preference.effective')}</span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {effectiveModel ? (
                    <Typography.Text code className="bg-surface-elevated text-fg font-mono text-xs font-medium">
                      {effectiveModel.providerId} / {effectiveModel.modelId}
                    </Typography.Text>
                  ) : (
                    <Tag className="m-0">{t('ai.preference.none')}</Tag>
                  )}
                  {effectiveSource ? (
                    <Tag color={effectiveSource === 'user' ? 'blue' : 'default'} className="m-0 text-xs">
                      {t(`ai.preference.source.${effectiveSource}`)}
                    </Tag>
                  ) : null}
                </div>
              </div>
              <Sparkles className="text-primary/40 size-5 shrink-0" />
            </div>
          </div>
        )}
      </section>

      {/* 模型测试 Playground 控制台 */}
      <section className="border-border-subtle bg-surface/85 rounded-2xl border p-5 shadow-sm backdrop-blur-xs sm:p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="border-border-subtle bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg border">
            <Terminal className="size-4" />
          </div>
          <div>
            <h2 className="text-fg text-base font-semibold tracking-tight">{t('ai.test.title')}</h2>
            <p className="text-fg-muted text-xs sm:text-sm">{t('ai.test.description')}</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(320px,440px)_minmax(0,1fr)] lg:items-start">
          {/* 左侧输入区域 */}
          <div className="space-y-4">
            <div>
              <label className="text-fg-muted mb-1.5 block text-xs font-medium">{t('ai.test.modelPlaceholder')}</label>
              <Select
                allowClear
                className="w-full"
                options={modelOptions}
                placeholder={t('ai.test.modelPlaceholder')}
                value={testModelKey}
                onChange={setTestModelKey}
                showSearch
                optionFilterProp="label"
              />
            </div>

            <div className="relative">
              <TextArea
                autoSize={{ minRows: 8, maxRows: 16 }}
                maxLength={8000}
                placeholder={t('ai.test.promptPlaceholder')}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handlePromptKeyDown}
                className="font-normal"
              />
              <div className="text-fg-muted mt-1.5 flex items-center justify-between px-1 text-xs">
                <span className="opacity-70">{t('ai.test.shortcutTip')}</span>
                <span>{prompt.length} / 8000</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                {streaming ? (
                  <Button danger icon={<Square className="size-4" />} onClick={stopTest}>
                    {t('ai.test.stop')}
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    icon={<Send className="size-4" />}
                    disabled={!prompt.trim() || models.length === 0}
                    onClick={() => void runTest()}
                  >
                    {t('ai.test.send')}
                  </Button>
                )}
                <Button
                  icon={<RotateCcw className="size-4" />}
                  disabled={!prompt.trim() || streaming}
                  onClick={() => void runTest()}
                >
                  {t('ai.test.retry')}
                </Button>
              </div>

              {prompt ? (
                <Button
                  type="text"
                  size="small"
                  icon={<Eraser className="size-3.5" />}
                  disabled={streaming}
                  onClick={() => setPrompt('')}
                  className="text-fg-muted"
                >
                  {t('ai.test.clearPrompt')}
                </Button>
              ) : null}
            </div>
          </div>

          {/* 右侧输出控制台 */}
          <div className="border-border-subtle bg-surface-muted/50 flex min-h-[380px] flex-col rounded-xl border shadow-inner">
            {/* 控制台顶部状态栏 */}
            <div className="border-border-subtle bg-surface/70 flex items-center justify-between border-b px-4 py-2.5 backdrop-blur-xs">
              <div className="flex items-center gap-2">
                <div
                  className={`size-2 rounded-full ${streaming ? 'bg-primary animate-ping' : answer ? 'bg-emerald-500' : 'bg-fg-muted/40'}`}
                />
                <span className="text-fg-muted text-xs font-medium">
                  {streaming
                    ? t('ai.test.generating')
                    : currentTestModel
                      ? `${currentTestModel.providerName} / ${currentTestModel.name}`
                      : t('ai.test.title')}
                </span>
              </div>

              <div className="flex items-center gap-1">
                {answer ? (
                  <>
                    <span className="text-fg-muted mr-2 text-xs">
                      {t('ai.test.charCount')}: {answer.length}
                    </span>
                    <Tooltip title={t('ai.test.copyAnswer')}>
                      <Button
                        type="text"
                        size="small"
                        icon={copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                        onClick={() => void copyAnswer()}
                        aria-label={t('ai.test.copyAnswer')}
                      />
                    </Tooltip>
                    <Tooltip title={t('ai.test.clearPrompt')}>
                      <Button
                        type="text"
                        size="small"
                        icon={<Trash2 className="size-3.5" />}
                        disabled={streaming}
                        onClick={() => {
                          setAnswer('')
                          setStreamError(null)
                        }}
                        aria-label={t('ai.test.clearPrompt')}
                      />
                    </Tooltip>
                  </>
                ) : null}
              </div>
            </div>

            {/* 控制台内容主体 */}
            <div ref={outputContainerRef} className="flex-1 overflow-auto p-5">
              {streamError ? <Alert showIcon type="error" message={streamError} className="mb-4" /> : null}

              {answer ? (
                <div className="text-fg whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {answer}
                  {streaming ? (
                    <span className="bg-primary ml-1 inline-block h-4 w-1.5 animate-pulse rounded-xs align-middle" />
                  ) : null}
                </div>
              ) : !streamError ? (
                <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
                  <div className="border-border-subtle bg-surface/80 mb-3 flex size-12 items-center justify-center rounded-2xl border shadow-sm">
                    <Zap className="text-fg-muted/60 size-6" />
                  </div>
                  <p className="text-fg font-medium text-sm">{t('ai.test.empty')}</p>
                  <p className="text-fg-muted mt-1 max-w-sm text-xs leading-normal">{t('ai.test.emptyHint')}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
