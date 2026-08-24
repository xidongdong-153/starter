import type {
  AdminAiProvider,
  CreateCustomAiProviderInput,
  CustomAiProvider,
  CustomAiProviderModel,
  CustomAiProviderProtocol,
  UpdateCustomAiProviderInput,
} from '@starter/contracts'

import {
  aiProviderIdSchema,
  createCustomAiProviderSchema,
  customAiProviderBaseUrlSchema,
  customAiProviderModelsSchema,
  updateCustomAiProviderSchema,
} from '@starter/contracts'
import {
  Alert,
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'antd'
import type { TableProps } from 'antd'
import { KeyRound, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useCheckCustomAiProviderMutation,
  useClearCustomAiProviderCredentialMutation,
  useCreateCustomAiProviderMutation,
  useCustomAiProviderQuery,
  useDeleteCustomAiProviderMutation,
  useReplaceCustomAiProviderModelsMutation,
  useSetCustomAiProviderStateMutation,
  useUpdateCustomAiProviderCredentialMutation,
  useUpdateCustomAiProviderMutation,
} from '@admin/api/ai'

interface ModelFormValue extends CustomAiProviderModel {
  key: string
}

interface CustomProviderFormValues {
  providerId: string
  name: string
  baseUrl: string
  protocol: CustomAiProviderProtocol
  compat: Record<string, boolean | string | undefined>
  apiKey?: string
  models: ModelFormValue[]
}

export interface CustomProviderDrawerProps {
  provider: AdminAiProvider | null
  open: boolean
  onClose: () => void
  onSaved?: () => void
}

const protocolOptions: { label: string; value: CustomAiProviderProtocol }[] = [
  { label: 'OpenAI Completions', value: 'openai-completions' },
  { label: 'OpenAI Responses', value: 'openai-responses' },
  { label: 'Anthropic Messages', value: 'anthropic-messages' },
]

type CompatField = { key: string; type?: 'boolean' } | { key: string; type: 'select'; options: string[] }

const compatFields: Record<CustomAiProviderProtocol, CompatField[]> = {
  'openai-completions': [
    { key: 'supportsStore' },
    { key: 'supportsDeveloperRole' },
    { key: 'supportsReasoningEffort' },
    { key: 'supportsUsageInStreaming' },
    { key: 'supportsFinishReason' },
    { key: 'requiresToolResultName' },
    { key: 'requiresAssistantAfterToolResult' },
    { key: 'requiresThinkingAsText' },
    { key: 'requiresReasoningContentOnAssistantMessages' },
    {
      key: 'thinkingFormat',
      type: 'select',
      options: [
        'openai',
        'openrouter',
        'deepseek',
        'together',
        'baseten',
        'zai',
        'qwen',
        'chat-template',
        'qwen-chat-template',
        'string-thinking',
        'ant-ling',
      ],
    },
    { key: 'supportsThinkingTokenBudget' },
    { key: 'supportsOpenAIGrammarTools' },
    { key: 'supportsStrictMode' },
    { key: 'zaiToolStream' },
    { key: 'sendSessionAffinityHeaders' },
    { key: 'supportsLongCacheRetention' },
    { key: 'maxTokensField', type: 'select', options: ['max_completion_tokens', 'max_tokens'] },
    { key: 'cacheControlFormat', type: 'select', options: ['anthropic'] },
    { key: 'deferredToolsMode', type: 'select', options: ['kimi'] },
    { key: 'sessionAffinityFormat', type: 'select', options: ['openai', 'openai-nosession', 'openrouter'] },
  ],
  'openai-responses': [
    { key: 'supportsDeveloperRole' },
    { key: 'supportsLongCacheRetention' },
    { key: 'supportsStrictMode' },
    { key: 'supportsOpenAIGrammarTools' },
    { key: 'supportsToolSearch' },
    { key: 'supportsExplicitPromptCacheMode' },
    { key: 'sessionAffinityFormat', type: 'select', options: ['openai', 'openai-nosession', 'openrouter'] },
  ],
  'anthropic-messages': [
    { key: 'supportsEagerToolInputStreaming' },
    { key: 'supportsLongCacheRetention' },
    { key: 'sendSessionAffinityHeaders' },
    { key: 'supportsCacheControlOnTools' },
    { key: 'supportsTemperature' },
    { key: 'forceAdaptiveThinking' },
    { key: 'allowEmptySignature' },
    { key: 'supportsStrictTools' },
    { key: 'supportsToolReferences' },
  ],
}

function emptyModel(): ModelFormValue {
  return {
    key: crypto.randomUUID(),
    modelId: '',
    name: '',
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    supportsImageInput: false,
    supportsReasoning: false,
    supportsTools: true,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
  }
}

export function toCustomProviderFormValues(provider: CustomAiProvider | null): CustomProviderFormValues {
  if (!provider) {
    return {
      providerId: '',
      name: '',
      baseUrl: '',
      protocol: 'openai-completions',
      compat: {},
      models: [emptyModel()],
    }
  }
  return {
    providerId: provider.providerId,
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    compat: provider.compat,
    models: provider.models.map((model) => ({ ...model, key: `${model.modelId}-${crypto.randomUUID()}` })),
  }
}

function trimCompat(protocol: CustomAiProviderProtocol, compat: CustomProviderFormValues['compat']) {
  const allowedKeys = new Set(compatFields[protocol].map((field) => field.key))
  return Object.fromEntries(
    Object.entries(compat ?? {}).filter(([key, value]) => allowedKeys.has(key) && value !== undefined && value !== ''),
  )
}

function formModels(models: ModelFormValue[]): CustomAiProviderModel[] {
  return models.map(({ key: _key, ...model }) => model)
}

export function toCreateCustomProviderInput(values: CustomProviderFormValues): CreateCustomAiProviderInput {
  return createCustomAiProviderSchema.parse({
    providerId: values.providerId.trim(),
    name: values.name.trim(),
    baseUrl: values.baseUrl.trim(),
    protocol: values.protocol,
    compat: trimCompat(values.protocol, values.compat),
    ...(values.apiKey?.trim() ? { apiKey: values.apiKey.trim() } : {}),
    models: formModels(values.models),
  })
}

export function toUpdateCustomProviderInput(
  values: CustomProviderFormValues,
  expectedRevision: number,
): UpdateCustomAiProviderInput {
  const { apiKey: _apiKey, providerId: _providerId, ...input } = toCreateCustomProviderInput(values)
  return updateCustomAiProviderSchema.parse({ ...input, expectedRevision })
}

function protocolFieldLabel(t: (key: string) => string, key: string) {
  return t(`ai.customProviders.compat.${key}`)
}

export function CustomProviderDrawer({ provider, open, onClose, onSaved }: CustomProviderDrawerProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<CustomProviderFormValues>()
  const initialized = useRef(false)
  const editing = provider !== null
  const providerId = provider?.providerId ?? null
  const detailQuery = useCustomAiProviderQuery(providerId)
  const currentProvider = detailQuery.data
  const createProvider = useCreateCustomAiProviderMutation()
  const updateProvider = useUpdateCustomAiProviderMutation()
  const checkProvider = useCheckCustomAiProviderMutation()
  const setProviderState = useSetCustomAiProviderStateMutation()
  const clearCredential = useClearCustomAiProviderCredentialMutation()
  const deleteProvider = useDeleteCustomAiProviderMutation()
  const replaceModels = useReplaceCustomAiProviderModelsMutation()
  const updateCredential = useUpdateCustomAiProviderCredentialMutation()
  const activeMutation = createProvider.isPending || updateProvider.isPending || updateCredential.isPending
  const detailReady = !editing || currentProvider !== undefined

  useEffect(() => {
    if (!open) {
      initialized.current = false
      form.resetFields()
      return
    }
    if (initialized.current || (editing && !currentProvider)) return
    form.setFieldsValue(toCustomProviderFormValues(currentProvider ?? null))
    initialized.current = true
  }, [editing, form, open, currentProvider])

  const protocol = Form.useWatch('protocol', form) ?? 'openai-completions'
  const models = Form.useWatch('models', form) ?? []
  const compat = useMemo(() => compatFields[protocol], [protocol])

  const submit = async () => {
    if (editing && !currentProvider) return

    let values: CustomProviderFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    try {
      if (currentProvider) {
        await updateProvider.mutateAsync({
          providerId: currentProvider.providerId,
          values: toUpdateCustomProviderInput(values, currentProvider.revision),
        })
        if (values.apiKey?.trim()) {
          await updateCredential.mutateAsync({
            providerId: currentProvider.providerId,
            values: { apiKey: values.apiKey.trim() },
          })
        }
      } else {
        await createProvider.mutateAsync(toCreateCustomProviderInput(values))
      }
      message.success(t('ai.customProviders.saveSuccess'))
      onSaved?.()
      onClose()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.customProviders.saveFailed'))
    } finally {
      createProvider.reset()
      updateCredential.reset()
    }
  }

  const runAction = async (action: () => Promise<unknown>, successKey: string) => {
    try {
      await action()
      message.success(t(successKey))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.customProviders.actionFailed'))
    }
  }

  const saveModels = async () => {
    if (!currentProvider) return
    const formValue = form.getFieldValue('models') as ModelFormValue[] | undefined
    const parsed = customAiProviderModelsSchema.safeParse(formValue?.map(({ key: _key, ...model }) => model))
    if (!parsed.success) {
      message.error(t('ai.customProviders.models.invalid'))
      return
    }
    await runAction(
      () =>
        replaceModels.mutateAsync({
          providerId: currentProvider.providerId,
          values: { expectedRevision: currentProvider.revision, models: parsed.data },
        }),
      'ai.customProviders.models.saveSuccess',
    )
  }

  const modelColumns: TableProps<ModelFormValue>['columns'] = [
    {
      title: t('ai.customProviders.models.modelId'),
      dataIndex: 'modelId',
      render: (_, model, index) => (
        <Form.Item
          name={['models', index, 'modelId']}
          rules={[{ required: true, message: t('ai.customProviders.modelRequired') }]}
        >
          <Input aria-label={`${t('ai.customProviders.models.modelId')} ${index + 1}`} />
        </Form.Item>
      ),
    },
    {
      title: t('ai.customProviders.models.name'),
      dataIndex: 'name',
      render: (_, model, index) => (
        <Form.Item
          name={['models', index, 'name']}
          rules={[{ required: true, message: t('ai.customProviders.modelRequired') }]}
        >
          <Input aria-label={`${t('ai.customProviders.models.name')} ${index + 1}`} />
        </Form.Item>
      ),
    },
    {
      title: t('ai.customProviders.models.contextWindow'),
      dataIndex: 'contextWindow',
      width: 140,
      render: (_, model, index) => (
        <Form.Item
          name={['models', index, 'contextWindow']}
          rules={[{ required: true, message: t('ai.customProviders.modelRequired') }]}
        >
          <InputNumber min={1} className="w-full" />
        </Form.Item>
      ),
    },
    {
      title: t('ai.customProviders.models.maxOutputTokens'),
      dataIndex: 'maxOutputTokens',
      width: 140,
      render: (_, model, index) => (
        <Form.Item name={['models', index, 'maxOutputTokens']}>
          <InputNumber min={1} className="w-full" />
        </Form.Item>
      ),
    },
    {
      title: t('ai.customProviders.models.costs'),
      width: 220,
      render: (_, model, index) => (
        <div className="grid grid-cols-2 gap-1">
          {(['inputCost', 'outputCost', 'cacheReadCost', 'cacheWriteCost'] as const).map((field) => (
            <Form.Item key={field} name={['models', index, field]} noStyle>
              <InputNumber
                min={0}
                step={0.000001}
                className="w-full"
                aria-label={`${t(`ai.customProviders.models.${field}`)} ${index + 1}`}
                placeholder={t(`ai.customProviders.models.${field}`)}
              />
            </Form.Item>
          ))}
        </div>
      ),
    },
    {
      title: t('ai.customProviders.models.capabilities'),
      width: 260,
      render: (_, model, index) => (
        <Space wrap>
          {(['supportsImageInput', 'supportsReasoning', 'supportsTools'] as const).map((field) => (
            <Form.Item key={field} name={['models', index, field]} valuePropName="checked" noStyle>
              <Switch size="small" checkedChildren={t(`ai.customProviders.models.${field}`)} />
            </Form.Item>
          ))}
        </Space>
      ),
    },
    {
      title: t('common.actions'),
      width: 56,
      render: (_, model, index) => (
        <Tooltip title={t('common.delete')}>
          <Button
            danger
            disabled={models.length <= 1}
            type="text"
            aria-label={`${t('common.delete')} ${model.modelId || index + 1}`}
            icon={<X className="size-4" />}
            onClick={() => {
              const next = models.filter((_, modelIndex) => modelIndex !== index)
              form.setFieldValue('models', next)
            }}
          />
        </Tooltip>
      ),
    },
  ]

  return (
    <Drawer
      destroyOnHidden
      open={open}
      width="min(860px, 100vw)"
      title={editing ? `${provider?.name} / ${t('ai.customProviders.edit')}` : t('ai.customProviders.create')}
      onClose={onClose}
      extra={
        <Button
          type="primary"
          icon={<Save className="size-4" />}
          loading={activeMutation || (editing && detailQuery.isLoading)}
          disabled={!detailReady}
          onClick={() => void submit()}
        >
          {t('common.save')}
        </Button>
      }
    >
      {detailQuery.isLoading && editing ? <Spin className="mb-5" /> : null}
      {detailQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('ai.customProviders.loadFailed')}
          description={detailQuery.error instanceof Error ? detailQuery.error.message : undefined}
          action={<Button onClick={() => void detailQuery.refetch()}>{t('common.retry')}</Button>}
          className="mb-5"
        />
      ) : null}
      {currentProvider?.authStatus === 'needs_check' ? (
        <Alert showIcon type="warning" message={t('ai.customProviders.needsCheck')} className="mb-5" />
      ) : null}
      <Form<CustomProviderFormValues>
        disabled={!detailReady}
        form={form}
        layout="vertical"
        initialValues={toCustomProviderFormValues(currentProvider ?? null)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Form.Item
            name="providerId"
            label={t('ai.customProviders.providerId')}
            rules={[
              { required: true, message: t('ai.customProviders.fieldRequired') },
              {
                validator: (_, value: string) =>
                  !value || aiProviderIdSchema.safeParse(value.trim()).success
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('ai.customProviders.providerIdInvalid'))),
              },
            ]}
          >
            <Input disabled={editing} placeholder="my-provider" />
          </Form.Item>
          <Form.Item
            name="name"
            label={t('ai.customProviders.name')}
            rules={[{ required: true, message: t('ai.customProviders.fieldRequired') }]}
          >
            <Input />
          </Form.Item>
        </div>
        <Form.Item
          name="baseUrl"
          label={t('ai.customProviders.baseUrl')}
          rules={[
            { required: true, message: t('ai.customProviders.fieldRequired') },
            {
              validator: (_, value: string) =>
                !value || customAiProviderBaseUrlSchema.safeParse(value.trim()).success
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('ai.customProviders.baseUrlInvalid'))),
            },
          ]}
        >
          <Input placeholder="https://api.example.com" />
        </Form.Item>
        <Form.Item
          name="protocol"
          label={t('ai.customProviders.protocol')}
          rules={[{ required: true, message: t('ai.customProviders.fieldRequired') }]}
        >
          <Select options={protocolOptions} />
        </Form.Item>
        <section className="border-border-subtle mb-5 border-t pt-4">
          <div className="text-fg mb-3 text-sm font-semibold">{t('ai.customProviders.compatTitle')}</div>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {compat.map((field) =>
              field.type === 'select' ? (
                <Form.Item key={field.key} name={['compat', field.key]} label={protocolFieldLabel(t, field.key)}>
                  <Select allowClear options={field.options.map((value) => ({ label: value, value }))} />
                </Form.Item>
              ) : (
                <Form.Item
                  key={field.key}
                  name={['compat', field.key]}
                  valuePropName="checked"
                  label={protocolFieldLabel(t, field.key)}
                >
                  <Switch />
                </Form.Item>
              ),
            )}
          </div>
        </section>
        <Form.Item
          name="apiKey"
          label={t('ai.customProviders.apiKey')}
          extra={
            currentProvider?.credentialMask
              ? t('ai.customProviders.credentialMask', { mask: currentProvider.credentialMask })
              : undefined
          }
        >
          <Input.Password
            autoComplete="new-password"
            prefix={<KeyRound className="text-fg-muted size-4" />}
            placeholder={t('ai.customProviders.apiKeyPlaceholder')}
          />
        </Form.Item>
        <section className="border-border-subtle border-t pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-fg text-sm font-semibold">{t('ai.customProviders.models.title')}</div>
              <div className="text-fg-muted text-xs">{t('ai.customProviders.models.description')}</div>
            </div>
            <Space wrap>
              {currentProvider ? (
                <Button
                  icon={<Save className="size-4" />}
                  loading={replaceModels.isPending}
                  onClick={() => void saveModels()}
                >
                  {t('ai.customProviders.models.save')}
                </Button>
              ) : null}
              <Button
                icon={<Plus className="size-4" />}
                onClick={() => form.setFieldValue('models', [...models, emptyModel()])}
              >
                {t('ai.customProviders.models.add')}
              </Button>
            </Space>
          </div>
          <div className="overflow-x-auto">
            <Table<ModelFormValue>
              size="small"
              pagination={false}
              rowKey="key"
              columns={modelColumns}
              dataSource={models}
              locale={{ emptyText: t('ai.customProviders.models.empty') }}
              scroll={{ x: 760 }}
            />
          </div>
          <Form.Item
            name="models"
            hidden
            rules={[
              {
                validator: (_, value: ModelFormValue[]) =>
                  value?.length
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('ai.customProviders.models.required'))),
              },
            ]}
          >
            <Input />
          </Form.Item>
        </section>
      </Form>
      {currentProvider ? (
        <div className="border-border-subtle mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <Space wrap>
            <Button
              icon={<ShieldCheck className="size-4" />}
              loading={checkProvider.isPending}
              onClick={() =>
                void runAction(
                  () =>
                    checkProvider.mutateAsync({
                      providerId: currentProvider.providerId,
                      values: { expectedRevision: currentProvider.revision },
                    }),
                  'ai.customProviders.checkSuccess',
                )
              }
            >
              {t('ai.customProviders.check')}
            </Button>
            <Tag color={currentProvider.enabled ? 'green' : 'default'}>
              {currentProvider.enabled ? t('ai.customProviders.enabled') : t('ai.customProviders.disabled')}
            </Tag>
            <Switch
              checked={currentProvider.enabled}
              disabled={setProviderState.isPending || currentProvider.authStatus !== 'ready'}
              checkedChildren={t('ai.customProviders.enabled')}
              unCheckedChildren={t('ai.customProviders.disabled')}
              onChange={(enabled) =>
                void runAction(
                  () => setProviderState.mutateAsync({ providerId: currentProvider.providerId, enabled }),
                  enabled ? 'ai.customProviders.enableSuccess' : 'ai.customProviders.disableSuccess',
                )
              }
            />
          </Space>
          <Space wrap>
            {currentProvider.credentialMask ? (
              <Popconfirm
                title={t('ai.customProviders.clearCredentialConfirm')}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                onConfirm={() =>
                  void runAction(
                    () => clearCredential.mutateAsync(currentProvider.providerId),
                    'ai.customProviders.clearCredentialSuccess',
                  )
                }
              >
                <Button loading={clearCredential.isPending}>{t('ai.customProviders.clearCredential')}</Button>
              </Popconfirm>
            ) : null}
            <Tooltip title={currentProvider.enabled ? t('ai.customProviders.deleteDisabled') : undefined}>
              <Popconfirm
                title={t('ai.customProviders.deleteConfirm')}
                description={t('ai.customProviders.deleteDescription')}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                onConfirm={() =>
                  void runAction(async () => {
                    await deleteProvider.mutateAsync({
                      providerId: currentProvider.providerId,
                      values: { expectedRevision: currentProvider.revision },
                    })
                    onClose()
                  }, 'ai.customProviders.deleteSuccess')
                }
              >
                <Button
                  danger
                  disabled={currentProvider.enabled}
                  icon={<Trash2 className="size-4" />}
                  loading={deleteProvider.isPending}
                >
                  {t('common.delete')}
                </Button>
              </Popconfirm>
            </Tooltip>
          </Space>
        </div>
      ) : null}
    </Drawer>
  )
}
