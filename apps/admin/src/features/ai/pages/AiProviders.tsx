import type { AdminAiModel, AdminAiProvider, AiModelRef } from '@starter/contracts'
import type { TableProps } from 'antd'

import { PermissionKeys } from '@starter/contracts'
import {
  useAdminAiModelsQuery,
  useAiProvidersQuery,
  useCheckAiProviderMutation,
  useCheckCustomAiProviderMutation,
  useClearAiProviderCredentialMutation,
  useRefreshAiProviderModelsMutation,
  useReplaceAdminAiModelsMutation,
  useSetAdminAiDefaultMutation,
  useSetAiProviderStateMutation,
  useSetCustomAiProviderStateMutation,
  useUpdateAiProviderConfigMutation,
} from '@admin/api/ai'
import { AdminPageHeader, PermissionGuard } from '@admin/components/common'
import { usePermission } from '@admin/hooks/usePermission'
import { CustomProviderDrawer } from '@admin/features/ai/components/CustomProviderDrawer'
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Radio,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  Boxes,
  BrainCircuit,
  Eye,
  Globe,
  KeyRound,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react'
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

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`
  return tokens.toLocaleString()
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
  const checkCustomProvider = useCheckCustomAiProviderMutation()
  const setProviderState = useSetAiProviderStateMutation()
  const setCustomProviderState = useSetCustomAiProviderStateMutation()
  const refreshModels = useRefreshAiProviderModelsMutation()
  const replaceModels = useReplaceAdminAiModelsMutation()
  const setDefault = useSetAdminAiDefaultMutation()
  const [form] = Form.useForm<ProviderFormValues>()

  // Provider 过滤状态
  const [providerQuery, setProviderQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [enabledFilter, setEnabledFilter] = useState<string>('all')

  // Model 过滤状态
  const [modelQuery, setModelQuery] = useState('')
  const [modelProviderFilter, setModelProviderFilter] = useState<string>('all')
  const [modelCapabilityFilter, setModelCapabilityFilter] = useState<string>('all')

  const [drawerProvider, setDrawerProvider] = useState<AdminAiProvider | null>(null)
  const [customDrawerProvider, setCustomDrawerProvider] = useState<AdminAiProvider | null>(null)
  const [customDrawerOpen, setCustomDrawerOpen] = useState(false)
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

  // 过滤后的 Provider 列表
  const filteredProviders = useMemo(() => {
    let list = providersQuery.data ?? []
    const needle = providerQuery.trim().toLowerCase()
    if (needle) {
      list = list.filter(
        (provider) =>
          provider.name.toLowerCase().includes(needle) || provider.providerId.toLowerCase().includes(needle),
      )
    }
    if (statusFilter !== 'all') {
      list = list.filter((provider) => provider.authStatus === statusFilter)
    }
    if (enabledFilter === 'enabled') {
      list = list.filter((provider) => provider.enabled)
    } else if (enabledFilter === 'disabled') {
      list = list.filter((provider) => !provider.enabled)
    }
    return list
  }, [providersQuery.data, providerQuery, statusFilter, enabledFilter])

  const allModels = useMemo(() => modelsQuery.data?.items ?? [], [modelsQuery.data])
  const modelMap = useMemo(() => new Map(allModels.map((model) => [refKey(model), model])), [allModels])

  // Provider 下拉选项列表（用于模型 Tab 筛选）
  const providerOptionsForModelFilter = useMemo(() => {
    const map = new Map<string, string>()
    for (const model of allModels) {
      map.set(model.providerId, model.providerName)
    }
    return [
      { label: t('ai.models.allProviders'), value: 'all' },
      ...Array.from(map.entries()).map(([id, name]) => ({ label: name, value: id })),
    ]
  }, [allModels, t])

  // 过滤后的模型列表
  const filteredModels = useMemo(() => {
    let list = allModels
    const needle = modelQuery.trim().toLowerCase()
    if (needle) {
      list = list.filter(
        (model) =>
          model.name.toLowerCase().includes(needle) ||
          model.modelId.toLowerCase().includes(needle) ||
          model.providerName.toLowerCase().includes(needle),
      )
    }
    if (modelProviderFilter !== 'all') {
      list = list.filter((model) => model.providerId === modelProviderFilter)
    }
    if (modelCapabilityFilter === 'tools') {
      list = list.filter((model) => model.capabilities.supportsTools)
    } else if (modelCapabilityFilter === 'reasoning') {
      list = list.filter((model) => model.capabilities.supportsReasoning)
    } else if (modelCapabilityFilter === 'vision') {
      list = list.filter((model) => model.capabilities.supportsImageInput)
    }
    return list
  }, [allModels, modelQuery, modelProviderFilter, modelCapabilityFilter])

  const openProvider = (provider: AdminAiProvider) => {
    if (provider.kind === 'custom') {
      setCustomDrawerProvider(provider)
      setCustomDrawerOpen(true)
      return
    }
    setDrawerProvider(provider)
    form.setFieldsValue({ apiKey: undefined, settings: provider.configuredSettings })
  }

  const openCustomProvider = () => {
    setCustomDrawerProvider(null)
    setCustomDrawerOpen(true)
  }

  const closeProvider = () => {
    setDrawerProvider(null)
    form.resetFields()
  }

  const closeCustomProvider = () => {
    setCustomDrawerOpen(false)
    setCustomDrawerProvider(null)
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

  const selectAllFilteredModels = () => {
    const eligibleKeys = filteredModels
      .filter(
        (m) =>
          m.unavailableReason !== 'model_missing' &&
          m.unavailableReason !== 'model_unavailable' &&
          m.unavailableReason !== 'provider_not_ready',
      )
      .map(refKey)
    const newKeys = Array.from(new Set([...selectedModelKeys, ...eligibleKeys]))
    setSelectedModelKeys(newKeys)
  }

  const clearSelectedModels = () => {
    setSelectedModelKeys([])
  }

  const providerColumns: TableProps<AdminAiProvider>['columns'] = [
    {
      key: 'provider',
      title: t('ai.providers.columns.provider'),
      render: (_, provider) => (
        <div className="min-w-48">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-fg font-medium">{provider.name}</div>
            <Tag color={provider.kind === 'custom' ? 'blue' : 'default'} className="m-0 text-xs">
              {provider.kind === 'custom' ? t('ai.providers.custom') : t('ai.providers.builtIn')}
            </Tag>
          </div>
          <Typography.Text className="text-fg-muted font-mono text-xs" type="secondary">
            {provider.providerId}
          </Typography.Text>
        </div>
      ),
    },
    {
      key: 'auth',
      title: t('ai.providers.columns.auth'),
      render: (_, provider) => (
        <div className="flex flex-wrap gap-1.5">
          {provider.supportedAuthModes.map((mode) => (
            <Tag key={mode} className="border-border-subtle bg-surface-muted m-0 text-xs">
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
          <div className="flex items-center gap-1.5">
            <Tag className="m-0 font-medium" color={statusColor(provider.authStatus)}>
              {t(`ai.authStatus.${provider.authStatus}`)}
            </Tag>
            {provider.credentialMask ? (
              <span className="text-fg-muted font-mono text-xs">{provider.credentialMask}</span>
            ) : null}
          </div>
          {provider.authSource ? (
            <div className="text-fg-muted text-xs">{t(`ai.authSource.${provider.authSource}`)}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'models',
      title: t('ai.providers.columns.models'),
      render: (_, provider) => (
        <span className="text-fg font-medium">
          {provider.enabledModelCount} <span className="text-fg-muted font-normal">/ {provider.catalogModelCount}</span>
        </span>
      ),
      width: 120,
    },
    {
      key: 'enabled',
      title: t('ai.providers.columns.enabled'),
      width: 90,
      render: (_, provider) => (
        <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
          <Switch
            checked={provider.enabled}
            disabled={
              provider.kind === 'custom'
                ? setCustomProviderState.isPending || provider.authStatus !== 'ready'
                : setProviderState.isPending
            }
            onChange={(enabled) =>
              void runProviderAction(
                () =>
                  provider.kind === 'custom'
                    ? setCustomProviderState.mutateAsync({ providerId: provider.providerId, enabled })
                    : setProviderState.mutateAsync({ providerId: provider.providerId, enabled }),
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
      width: 160,
      render: (_, provider) => (
        <div className="flex items-center gap-1">
          {provider.kind === 'custom' ? (
            <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
              <Button
                type="primary"
                size="small"
                ghost
                icon={<Settings2 className="size-3.5" />}
                onClick={() => openProvider(provider)}
              >
                {t('ai.customProviders.edit')}
              </Button>
            </PermissionGuard>
          ) : (
            <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
              <Button
                type="primary"
                size="small"
                ghost
                icon={<Settings2 className="size-3.5" />}
                onClick={() => openProvider(provider)}
              >
                {t('ai.providers.configure')}
              </Button>
            </PermissionGuard>
          )}

          <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
            <Tooltip title={t('ai.providers.check')}>
              <Button
                type="text"
                size="small"
                aria-label={t('ai.providers.check')}
                loading={
                  (provider.kind === 'custom' ? checkCustomProvider.isPending : checkProvider.isPending) &&
                  (provider.kind === 'custom'
                    ? checkCustomProvider.variables?.providerId === provider.providerId
                    : checkProvider.variables === provider.providerId)
                }
                icon={<ShieldCheck className="size-3.5" />}
                onClick={() =>
                  void runProviderAction(
                    () =>
                      provider.kind === 'custom'
                        ? checkCustomProvider.mutateAsync({
                            providerId: provider.providerId,
                            values: { expectedRevision: provider.revision },
                          })
                        : checkProvider.mutateAsync(provider.providerId),

                    'ai.providers.checkSuccess',
                  )
                }
              />
            </Tooltip>
            {provider.supportsModelRefresh ? (
              <Tooltip title={t('ai.providers.refresh')}>
                <Button
                  type="text"
                  size="small"
                  aria-label={t('ai.providers.refresh')}
                  loading={refreshModels.isPending && refreshModels.variables === provider.providerId}
                  icon={<RefreshCw className="size-3.5" />}
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
          <div className="text-fg font-medium">{model.name}</div>
          <Typography.Text className="text-fg-muted font-mono text-xs" type="secondary">
            {model.modelId}
          </Typography.Text>
        </div>
      ),
    },
    {
      dataIndex: 'providerName',
      key: 'provider',
      title: t('ai.models.columns.provider'),
      render: (name) => <span className="font-medium">{name}</span>,
      width: 140,
    },
    {
      key: 'context',
      title: t('ai.models.columns.context'),
      render: (_, model) => (
        <span className="text-fg font-mono text-xs">{formatContextWindow(model.capabilities.contextWindow)}</span>
      ),
      width: 100,
    },
    {
      key: 'capabilities',
      title: t('ai.models.columns.capabilities'),
      render: (_, model) => (
        <div className="flex flex-wrap gap-1">
          {model.capabilities.supportsTools ? (
            <Tag color="orange" className="m-0 inline-flex items-center gap-1 text-[11px]">
              <Wrench className="size-2.5" /> Tools
            </Tag>
          ) : null}
          {model.capabilities.supportsReasoning ? (
            <Tag color="purple" className="m-0 inline-flex items-center gap-1 text-[11px]">
              <BrainCircuit className="size-2.5" /> Reasoning
            </Tag>
          ) : null}
          {model.capabilities.supportsImageInput ? (
            <Tag color="blue" className="m-0 inline-flex items-center gap-1 text-[11px]">
              <Eye className="size-2.5" /> Vision
            </Tag>
          ) : null}
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
      width: 130,
    },
  ]

  const providerError = providersQuery.error
  const modelsError = modelsQuery.error
  const enabledDefaultOptions = selectedModelKeys.flatMap((key) => {
    const model = modelMap.get(key)
    return model?.available ? [{ label: `${model.providerName} / ${model.name}`, value: key }] : []
  })

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-6">
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
        actions={
          <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
            <Button type="primary" icon={<Plus className="size-4" />} onClick={openCustomProvider}>
              {t('ai.customProviders.create')}
            </Button>
          </PermissionGuard>
        }
      />

      <div className="border-border-subtle bg-surface/85 flex min-h-0 flex-1 flex-col rounded-2xl border p-5 shadow-sm backdrop-blur-xs sm:p-6">
        <Tabs
          className="guide-tabs-fill"
          items={[
            {
              key: 'providers',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Boxes className="size-4" />
                  {t('ai.providers.tab')}
                </span>
              ),
              children: (
                <section className="flex min-h-0 flex-1 flex-col gap-4 pt-2">
                  {/* 筛选过滤工具栏 */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Input
                        allowClear
                        className="w-64"
                        prefix={<Search className="text-fg-muted size-4" />}
                        placeholder={t('ai.providers.search')}
                        value={providerQuery}
                        onChange={(event) => setProviderQuery(event.target.value)}
                      />
                      <Select
                        className="w-36"
                        value={statusFilter}
                        onChange={setStatusFilter}
                        options={[
                          { label: t('ai.providers.allStatus'), value: 'all' },
                          { label: t('ai.authStatus.ready'), value: 'ready' },
                          { label: t('ai.authStatus.needs_check'), value: 'needs_check' },
                          { label: t('ai.authStatus.error'), value: 'error' },
                          { label: t('ai.authStatus.not_configured'), value: 'not_configured' },
                        ]}
                      />
                      <Radio.Group
                        value={enabledFilter}
                        onChange={(e) => setEnabledFilter(e.target.value)}
                        optionType="button"
                        buttonStyle="solid"
                        size="middle"
                        options={[
                          { label: t('ai.providers.allStatus'), value: 'all' },
                          { label: t('ai.providers.summary.enabled'), value: 'enabled' },
                          { label: t('ai.models.unavailable.provider_disabled'), value: 'disabled' },
                        ]}
                      />
                    </div>
                  </div>

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
                    className="guide-table-fill min-h-64"
                    columns={providerColumns}
                    dataSource={filteredProviders}
                    loading={providersQuery.isLoading}
                    locale={{ emptyText: <Empty description={t('ai.providers.empty')} /> }}
                    pagination={{ pageSize: 20, showSizeChanger: false }}
                    rowKey="providerId"
                    scroll={{ x: 980, y: '100%' }}
                    size="middle"
                  />
                </section>
              ),
            },
            {
              key: 'models',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="size-4" />
                  {t('ai.models.tab')}
                </span>
              ),
              children: (
                <section className="flex min-h-0 flex-1 flex-col gap-6 pt-2">
                  {modelsError ? (
                    <Alert
                      showIcon
                      type="error"
                      message={t('ai.models.loadFailed')}
                      description={modelsError instanceof Error ? modelsError.message : undefined}
                      action={<Button onClick={() => void modelsQuery.refetch()}>{t('common.retry')}</Button>}
                    />
                  ) : null}

                  {/* 全局默认模型独立卡片 */}
                  <div className="border-border-subtle bg-surface-muted/50 flex flex-col justify-between gap-4 rounded-xl border p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Globe className="text-primary size-4" />
                        <span className="text-fg text-sm font-semibold">{t('ai.models.globalDefaultCardTitle')}</span>
                      </div>
                      <p className="text-fg-muted mt-0.5 text-xs">{t('ai.models.globalDefaultCardDesc')}</p>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 sm:max-w-md">
                      <Select
                        allowClear
                        className="min-w-0 flex-1 sm:w-64"
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
                  </div>

                  {/* 白名单表格与多维筛选 */}
                  <div className="flex min-h-0 flex-1 flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <Input
                          allowClear
                          className="w-56"
                          prefix={<Search className="text-fg-muted size-4" />}
                          placeholder={t('ai.models.searchPlaceholder')}
                          value={modelQuery}
                          onChange={(event) => setModelQuery(event.target.value)}
                        />
                        <Select
                          className="w-44"
                          value={modelProviderFilter}
                          onChange={setModelProviderFilter}
                          options={providerOptionsForModelFilter}
                        />
                        <Select
                          className="w-36"
                          value={modelCapabilityFilter}
                          onChange={setModelCapabilityFilter}
                          options={[
                            { label: t('ai.models.filterCapabilities'), value: 'all' },
                            { label: 'Tools (工具)', value: 'tools' },
                            { label: 'Reasoning (推理)', value: 'reasoning' },
                            { label: 'Vision (视觉)', value: 'vision' },
                          ]}
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
                          <Button size="small" onClick={selectAllFilteredModels}>
                            {t('ai.models.selectAllFiltered')}
                          </Button>
                          <Button size="small" onClick={clearSelectedModels}>
                            {t('ai.models.clearSelection')}
                          </Button>
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
                    </div>

                    {/* 已选统计指示条 */}
                    <div className="border-border-subtle bg-surface-muted/30 flex items-center justify-between rounded-lg border px-3 py-1.5 text-xs">
                      <span className="text-fg-muted">
                        {t('ai.models.selectedCount', {
                          selected: selectedModelKeys.length,
                          total: allModels.length,
                        })}
                      </span>
                      {filteredModels.length !== allModels.length ? (
                        <span className="text-fg-muted/80">
                          筛选结果: {filteredModels.length} / {allModels.length}
                        </span>
                      ) : null}
                    </div>

                    <Table
                      className="guide-table-fill min-h-64"
                      columns={modelColumns}
                      dataSource={filteredModels}
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
                      scroll={{ x: 980, y: '100%' }}
                      size="middle"
                    />
                  </div>
                </section>
              ),
            },
          ]}
        />
      </div>

      {/* Provider 配置抽屉 */}
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
          <div className="space-y-6">
            <Alert
              showIcon
              type={drawerProvider.authStatus === 'error' ? 'error' : 'info'}
              message={t(`ai.authStatus.${drawerProvider.authStatus}`)}
              description={
                <div className="mt-1 space-y-1">
                  {drawerProvider.setupInstructions.map((instruction, idx) => (
                    <p key={idx} className="text-xs leading-relaxed">
                      {instruction}
                    </p>
                  ))}
                </div>
              }
            />

            <Form<ProviderFormValues>
              disabled={!managePermission.allowed}
              form={form}
              layout="vertical"
              initialValues={{ settings: {} }}
              onFinish={(values) => void saveProvider(values)}
              className="space-y-4"
            >
              {drawerProvider.supportedAuthModes.includes('api_key') ? (
                <Form.Item name="apiKey" label={t('ai.providers.apiKey')} className="mb-4">
                  <Input.Password
                    autoComplete="new-password"
                    prefix={<KeyRound className="text-fg-muted size-4" />}
                    placeholder={drawerProvider.credentialMask ?? t('ai.providers.apiKeyPlaceholder')}
                  />
                </Form.Item>
              ) : null}

              {drawerProvider.configFields.map((field) => (
                <Form.Item
                  key={field.key}
                  name={['settings', field.key]}
                  label={field.label}
                  extra={<span className="text-fg-muted text-xs">{field.description}</span>}
                  rules={field.required ? [{ required: true, message: t('ai.providers.fieldRequired') }] : undefined}
                  className="mb-4"
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
              <div className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-t pt-5">
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
      <CustomProviderDrawer open={customDrawerOpen} provider={customDrawerProvider} onClose={closeCustomProvider} />
    </div>
  )
}
