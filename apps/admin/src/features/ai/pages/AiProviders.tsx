import type { AdminAiModel, AdminAiProvider, AiModelRef } from '@starter/contracts'
import type { TableProps } from 'antd'

import { PermissionKeys } from '@starter/contracts'
import {
  useAdminAiModelsQuery,
  useAiProvidersQuery,
  useCheckAiProviderMutation,
  useClearAiProviderCredentialMutation,
  useRefreshAiProviderModelsMutation,
  useReplaceAdminAiModelsMutation,
  useSetAdminAiDefaultMutation,
  useSetAiProviderStateMutation,
  useUpdateAiProviderConfigMutation,
} from '@admin/api/ai'
import { AdminPageHeader, PermissionGuard } from '@admin/components/common'
import { usePermission } from '@admin/hooks/usePermission'
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { KeyRound, RefreshCw, Save, Search, Settings2, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ProviderFormValues {
  apiKey?: string
  settings: Record<string, string>
}

function refKey(ref: AiModelRef): string {
  return `${ref.providerId}\u0000${ref.modelId}`
}

function statusColor(status: AdminAiProvider['authStatus']): string | undefined {
  if (status === 'ready') return 'green'
  if (status === 'error') return 'red'
  if (status === 'needs_check') return 'gold'
  return undefined
}

export function AiProviders() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const managePermission = usePermission(PermissionKeys.AI_CONFIG_MANAGE)
  const providersQuery = useAiProvidersQuery()
  const modelsQuery = useAdminAiModelsQuery()
  const updateConfig = useUpdateAiProviderConfigMutation()
  const clearCredential = useClearAiProviderCredentialMutation()
  const checkProvider = useCheckAiProviderMutation()
  const setProviderState = useSetAiProviderStateMutation()
  const refreshModels = useRefreshAiProviderModelsMutation()
  const replaceModels = useReplaceAdminAiModelsMutation()
  const setDefault = useSetAdminAiDefaultMutation()
  const [form] = Form.useForm<ProviderFormValues>()

  const [query, setQuery] = useState('')
  const [drawerProvider, setDrawerProvider] = useState<AdminAiProvider | null>(null)
  const [selectedModelKeys, setSelectedModelKeys] = useState<string[]>([])
  const [defaultModelKey, setDefaultModelKey] = useState<string | undefined>()
  const drawerProviderId = drawerProvider?.providerId

  useEffect(() => {
    if (!drawerProviderId) return
    const updated = providersQuery.data?.find((provider) => provider.providerId === drawerProviderId)
    if (updated) setDrawerProvider(updated)
  }, [drawerProviderId, providersQuery.data])

  useEffect(() => {
    const data = modelsQuery.data
    if (!data) return
    setSelectedModelKeys(data.items.filter((model) => model.enabled).map(refKey))
    setDefaultModelKey(data.globalDefaultModel ? refKey(data.globalDefaultModel) : undefined)
  }, [modelsQuery.data])

  const providers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return providersQuery.data ?? []
    return (providersQuery.data ?? []).filter(
      (provider) => provider.name.toLowerCase().includes(needle) || provider.providerId.toLowerCase().includes(needle),
    )
  }, [providersQuery.data, query])

  const modelMap = useMemo(
    () => new Map((modelsQuery.data?.items ?? []).map((model) => [refKey(model), model])),
    [modelsQuery.data],
  )

  const openProvider = (provider: AdminAiProvider) => {
    setDrawerProvider(provider)
    form.setFieldsValue({ apiKey: undefined, settings: provider.configuredSettings })
  }

  const closeProvider = () => {
    setDrawerProvider(null)
    form.resetFields()
  }

  const saveProvider = async (values: ProviderFormValues) => {
    if (!drawerProvider) return
    try {
      await updateConfig.mutateAsync({
        providerId: drawerProvider.providerId,
        values: {
          ...(values.apiKey?.trim() ? { apiKey: values.apiKey.trim() } : {}),
          settings: Object.fromEntries(
            Object.entries(values.settings ?? {})
              .map(([key, value]) => [key, value?.trim() ?? ''])
              .filter(([, value]) => value),
          ),
        },
      })
      message.success(t('ai.providers.saveSuccess'))
      closeProvider()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.providers.saveFailed'))
    }
  }

  const runProviderAction = async (action: () => Promise<unknown>, successKey: string) => {
    try {
      await action()
      message.success(t(successKey))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.providers.actionFailed'))
    }
  }

  const saveWhitelist = async () => {
    const models = selectedModelKeys.flatMap((key) => {
      const model = modelMap.get(key)
      return model ? [{ providerId: model.providerId, modelId: model.modelId }] : []
    })
    await runProviderAction(() => replaceModels.mutateAsync({ models }), 'ai.models.saveSuccess')
  }

  const saveDefault = async () => {
    const model = defaultModelKey ? modelMap.get(defaultModelKey) : undefined
    await runProviderAction(
      () => setDefault.mutateAsync(model ? { providerId: model.providerId, modelId: model.modelId } : null),
      'ai.models.defaultSaveSuccess',
    )
  }

  const providerColumns: TableProps<AdminAiProvider>['columns'] = [
    {
      key: 'provider',
      title: t('ai.providers.columns.provider'),
      render: (_, provider) => (
        <div className="min-w-48">
          <div className="font-medium">{provider.name}</div>
          <Typography.Text className="break-all text-xs" type="secondary">
            {provider.providerId}
          </Typography.Text>
        </div>
      ),
    },
    {
      key: 'auth',
      title: t('ai.providers.columns.auth'),
      render: (_, provider) => (
        <div className="flex flex-wrap gap-1">
          {provider.supportedAuthModes.map((mode) => (
            <Tag key={mode} className="m-0">
              {t(`ai.authMode.${mode}`)}
            </Tag>
          ))}
        </div>
      ),
    },
    {
      key: 'status',
      title: t('ai.providers.columns.status'),
      render: (_, provider) => (
        <div className="space-y-1">
          <Tag className="m-0" color={statusColor(provider.authStatus)}>
            {t(`ai.authStatus.${provider.authStatus}`)}
          </Tag>
          {provider.credentialMask ? <div className="text-fg-muted text-xs">{provider.credentialMask}</div> : null}
          {provider.authSource ? (
            <div className="text-fg-muted text-xs">{t(`ai.authSource.${provider.authSource}`)}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'models',
      title: t('ai.providers.columns.models'),
      render: (_, provider) => `${provider.enabledModelCount} / ${provider.catalogModelCount}`,
      width: 110,
    },
    {
      key: 'enabled',
      title: t('ai.providers.columns.enabled'),
      width: 90,
      render: (_, provider) => (
        <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
          <Switch
            checked={provider.enabled}
            disabled={setProviderState.isPending}
            onChange={(enabled) =>
              void runProviderAction(
                () => setProviderState.mutateAsync({ providerId: provider.providerId, enabled }),
                enabled ? 'ai.providers.enableSuccess' : 'ai.providers.disableSuccess',
              )
            }
          />
        </PermissionGuard>
      ),
    },
    {
      key: 'actions',
      title: t('ai.providers.columns.actions'),
      fixed: 'right',
      width: 150,
      render: (_, provider) => (
        <div className="flex gap-1">
          <Tooltip title={t('ai.providers.configure')}>
            <Button
              type="text"
              aria-label={t('ai.providers.configure')}
              icon={<Settings2 className="size-4" />}
              onClick={() => openProvider(provider)}
            />
          </Tooltip>
          <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
            <Tooltip title={t('ai.providers.check')}>
              <Button
                type="text"
                aria-label={t('ai.providers.check')}
                loading={checkProvider.isPending && checkProvider.variables === provider.providerId}
                icon={<ShieldCheck className="size-4" />}
                onClick={() =>
                  void runProviderAction(
                    () => checkProvider.mutateAsync(provider.providerId),
                    'ai.providers.checkSuccess',
                  )
                }
              />
            </Tooltip>
            {provider.supportsModelRefresh ? (
              <Tooltip title={t('ai.providers.refresh')}>
                <Button
                  type="text"
                  aria-label={t('ai.providers.refresh')}
                  loading={refreshModels.isPending && refreshModels.variables === provider.providerId}
                  icon={<RefreshCw className="size-4" />}
                  onClick={() =>
                    void runProviderAction(
                      () => refreshModels.mutateAsync(provider.providerId),
                      'ai.providers.refreshSuccess',
                    )
                  }
                />
              </Tooltip>
            ) : null}
          </PermissionGuard>
        </div>
      ),
    },
  ]

  const modelColumns: TableProps<AdminAiModel>['columns'] = [
    {
      key: 'model',
      title: t('ai.models.columns.model'),
      render: (_, model) => (
        <div className="min-w-56">
          <div className="font-medium">{model.name}</div>
          <Typography.Text className="break-all text-xs" type="secondary">
            {model.modelId}
          </Typography.Text>
        </div>
      ),
    },
    { dataIndex: 'providerName', key: 'provider', title: t('ai.models.columns.provider') },
    {
      key: 'context',
      title: t('ai.models.columns.context'),
      render: (_, model) => model.capabilities.contextWindow.toLocaleString(),
      width: 120,
    },
    {
      key: 'capabilities',
      title: t('ai.models.columns.capabilities'),
      render: (_, model) => (
        <div className="flex flex-wrap gap-1">
          {model.capabilities.supportsTools ? <Tag className="m-0">Tools</Tag> : null}
          {model.capabilities.supportsReasoning ? <Tag className="m-0">Reasoning</Tag> : null}
          {model.capabilities.supportsImageInput ? <Tag className="m-0">Vision</Tag> : null}
        </div>
      ),
    },
    {
      key: 'status',
      title: t('ai.models.columns.status'),
      render: (_, model) => (
        <Tag color={model.available ? 'green' : model.unavailableReason === 'model_missing' ? 'red' : 'gold'}>
          {model.available ? t('ai.models.available') : t(`ai.models.unavailable.${model.unavailableReason}`)}
        </Tag>
      ),
    },
  ]

  const providerError = providersQuery.error
  const modelsError = modelsQuery.error
  const enabledDefaultOptions = selectedModelKeys.flatMap((key) => {
    const model = modelMap.get(key)
    return model?.available ? [{ label: `${model.providerName} / ${model.name}`, value: key }] : []
  })

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t('ai.providers.title')}
        description={t('ai.providers.description')}
        summaryItems={[
          { label: t('ai.providers.summary.total'), value: providersQuery.data?.length ?? 0 },
          {
            label: t('ai.providers.summary.enabled'),
            value: providersQuery.data?.filter((provider) => provider.enabled).length ?? 0,
          },
        ]}
      />

      <Tabs
        items={[
          {
            key: 'providers',
            label: t('ai.providers.tab'),
            children: (
              <section className="space-y-4">
                <Input
                  allowClear
                  className="max-w-md"
                  prefix={<Search className="size-4" />}
                  placeholder={t('ai.providers.search')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {providerError ? (
                  <Alert
                    showIcon
                    type="error"
                    message={t('ai.providers.loadFailed')}
                    description={providerError instanceof Error ? providerError.message : undefined}
                    action={<Button onClick={() => void providersQuery.refetch()}>{t('common.retry')}</Button>}
                  />
                ) : null}
                <Table
                  columns={providerColumns}
                  dataSource={providers}
                  loading={providersQuery.isLoading}
                  locale={{ emptyText: <Empty description={t('ai.providers.empty')} /> }}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  rowKey="providerId"
                  scroll={{ x: 980 }}
                  size="middle"
                />
              </section>
            ),
          },
          {
            key: 'models',
            label: t('ai.models.tab'),
            children: (
              <section className="space-y-4">
                {modelsError ? (
                  <Alert
                    showIcon
                    type="error"
                    message={t('ai.models.loadFailed')}
                    description={modelsError instanceof Error ? modelsError.message : undefined}
                    action={<Button onClick={() => void modelsQuery.refetch()}>{t('common.retry')}</Button>}
                  />
                ) : null}
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 flex-1 gap-2">
                    <Select
                      allowClear
                      className="min-w-0 flex-1 lg:max-w-lg"
                      disabled={!managePermission.allowed}
                      options={enabledDefaultOptions}
                      placeholder={t('ai.models.defaultPlaceholder')}
                      value={defaultModelKey}
                      onChange={setDefaultModelKey}
                      showSearch
                      optionFilterProp="label"
                    />
                    <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
                      <Button
                        icon={<Save className="size-4" />}
                        loading={setDefault.isPending}
                        onClick={() => void saveDefault()}
                      >
                        {t('ai.models.saveDefault')}
                      </Button>
                    </PermissionGuard>
                  </div>
                  <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
                    <Button
                      type="primary"
                      icon={<Save className="size-4" />}
                      loading={replaceModels.isPending}
                      onClick={() => void saveWhitelist()}
                    >
                      {t('ai.models.saveWhitelist')}
                    </Button>
                  </PermissionGuard>
                </div>
                <Table
                  columns={modelColumns}
                  dataSource={modelsQuery.data?.items ?? []}
                  loading={modelsQuery.isLoading}
                  locale={{ emptyText: <Empty description={t('ai.models.empty')} /> }}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  rowKey={refKey}
                  rowSelection={
                    managePermission.allowed
                      ? {
                          selectedRowKeys: selectedModelKeys,
                          onChange: (keys) => setSelectedModelKeys(keys.map(String)),
                          getCheckboxProps: (model) => ({
                            disabled:
                              model.unavailableReason === 'model_missing' ||
                              model.unavailableReason === 'model_unavailable' ||
                              model.unavailableReason === 'provider_not_ready',
                          }),
                        }
                      : undefined
                  }
                  scroll={{ x: 980 }}
                  size="middle"
                />
              </section>
            ),
          },
        ]}
      />

      <Drawer
        destroyOnHidden
        open={Boolean(drawerProvider)}
        title={drawerProvider ? `${drawerProvider.name} / ${t('ai.providers.configure')}` : undefined}
        width={560}
        onClose={closeProvider}
        extra={
          <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
            <Button
              type="primary"
              icon={<Save className="size-4" />}
              loading={updateConfig.isPending}
              onClick={() => form.submit()}
            >
              {t('common.save')}
            </Button>
          </PermissionGuard>
        }
      >
        {drawerProvider ? (
          <div className="space-y-5">
            <Alert
              showIcon
              type={drawerProvider.authStatus === 'error' ? 'error' : 'info'}
              message={t(`ai.authStatus.${drawerProvider.authStatus}`)}
              description={drawerProvider.setupInstructions.join(' ')}
            />
            <Form<ProviderFormValues>
              disabled={!managePermission.allowed}
              form={form}
              layout="vertical"
              initialValues={{ settings: {} }}
              onFinish={(values) => void saveProvider(values)}
            >
              {drawerProvider.supportedAuthModes.includes('api_key') ? (
                <Form.Item name="apiKey" label={t('ai.providers.apiKey')}>
                  <Input.Password
                    autoComplete="new-password"
                    prefix={<KeyRound className="size-4" />}
                    placeholder={drawerProvider.credentialMask ?? t('ai.providers.apiKeyPlaceholder')}
                  />
                </Form.Item>
              ) : null}
              {drawerProvider.configFields.map((field) => (
                <Form.Item
                  key={field.key}
                  name={['settings', field.key]}
                  label={field.label}
                  extra={field.description}
                  rules={field.required ? [{ required: true, message: t('ai.providers.fieldRequired') }] : undefined}
                >
                  {field.type === 'select' ? (
                    <Select options={field.options} />
                  ) : (
                    <Input type={field.type === 'url' ? 'url' : 'text'} />
                  )}
                </Form.Item>
              ))}
            </Form>
            <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
              <div className="border-border-subtle flex flex-wrap gap-2 border-t pt-4">
                <Button
                  icon={<ShieldCheck className="size-4" />}
                  loading={checkProvider.isPending}
                  onClick={() =>
                    void runProviderAction(
                      () => checkProvider.mutateAsync(drawerProvider.providerId),
                      'ai.providers.checkSuccess',
                    )
                  }
                >
                  {t('ai.providers.check')}
                </Button>
                <Popconfirm
                  title={t('ai.providers.clearConfirm')}
                  onConfirm={() =>
                    void runProviderAction(
                      () => clearCredential.mutateAsync(drawerProvider.providerId),
                      'ai.providers.clearSuccess',
                    )
                  }
                >
                  <Button danger icon={<Trash2 className="size-4" />} loading={clearCredential.isPending}>
                    {t('ai.providers.clearCredential')}
                  </Button>
                </Popconfirm>
              </div>
            </PermissionGuard>
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}
