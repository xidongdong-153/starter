import type { AiModelRef, AiTestStreamEvent, AiUserModel } from '@starter/contracts'

import { streamAiTest, useAiModelsQuery, useAiPreferenceQuery, useUpdateAiPreferenceMutation } from '@admin/api/ai'
import { AdminPageHeader } from '@admin/components/common'
import { Alert, App, Button, Empty, Input, Select, Spin, Tag, Typography } from 'antd'
import { RotateCcw, Save, Send, Square, Trash2 } from 'lucide-react'
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
  const controllerRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)

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

  if (modelsQuery.isLoading || preferenceQuery.isLoading) {
    return <Spin className="mt-20 block" />
  }

  const loadError = modelsQuery.error ?? preferenceQuery.error

  return (
    <div className="space-y-8">
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

      <section className="border-border-subtle border-b pb-8">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-fg text-base font-semibold">{t('ai.preference.title')}</h2>
            <p className="text-fg-muted mt-1 text-sm">{t('ai.preference.description')}</p>
          </div>
          <div className="flex gap-2">
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
          <Empty description={t('ai.models.empty')} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,520px)_1fr]">
            <Select
              allowClear
              className="w-full"
              options={modelOptions}
              placeholder={t('ai.preference.placeholder')}
              value={selectedKey}
              onChange={setSelectedKey}
              showSearch
              optionFilterProp="label"
            />
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span className="text-fg-muted">{t('ai.preference.effective')}</span>
              {preferenceQuery.data?.effectiveModel ? (
                <Typography.Text code className="break-all">
                  {preferenceQuery.data.effectiveModel.providerId}/{preferenceQuery.data.effectiveModel.modelId}
                </Typography.Text>
              ) : (
                <Tag>{t('ai.preference.none')}</Tag>
              )}
              {preferenceQuery.data?.effectiveSource ? (
                <Tag color={preferenceQuery.data.effectiveSource === 'user' ? 'blue' : 'default'}>
                  {t(`ai.preference.source.${preferenceQuery.data.effectiveSource}`)}
                </Tag>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <section className="pb-8">
        <div className="mb-4">
          <h2 className="text-fg text-base font-semibold">{t('ai.test.title')}</h2>
          <p className="text-fg-muted mt-1 text-sm">{t('ai.test.description')}</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]">
          <div className="space-y-3">
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
            <TextArea
              autoSize={{ minRows: 7, maxRows: 14 }}
              maxLength={8000}
              placeholder={t('ai.test.promptPlaceholder')}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
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
          </div>
          <div className="border-border-subtle bg-surface-muted min-h-64 overflow-auto rounded-md border p-4">
            {streamError ? <Alert showIcon type="error" message={streamError} /> : null}
            {answer ? (
              <Typography.Paragraph className="text-fg m-0 whitespace-pre-wrap break-words">
                {answer}
              </Typography.Paragraph>
            ) : !streamError ? (
              <span className="text-fg-muted text-sm">{t('ai.test.empty')}</span>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
