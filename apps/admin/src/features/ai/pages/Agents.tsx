import type {
  AgentDefinitionConfig,
  AgentDefinitionDetail,
  AgentDefinitionStatus,
  AgentThinkingLevel,
  AiModelRef,
  AiToolRef,
  AiToolSummary,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
} from '@starter/contracts'
import type { TableProps } from 'antd'

import { PermissionKeys } from '@starter/contracts'
import {
  useAdminAgentDefinitionsQuery,
  useAdminAiToolsQuery,
  useAdminAiModelsQuery,
  useCreateAgentDefinitionMutation,
  useSystemPromptsQuery,
  useSkillsQuery,
  useUpdateAgentDefinitionMutation,
  useUpdateAgentDefinitionStatusMutation,
} from '@admin/api/ai'
import { AdminPageHeader, PageToolbar, PermissionGuard } from '@admin/components/common'
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { Bot, Check, ChevronDown, Pencil, Plus, Power, Save, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDate } from '@admin/utils/dayjs'

interface AgentFormValues {
  name: string
  description: string
  modelKey?: string
  systemPromptId?: string
  skillIds: string[]
  /** Tool ref UI key：name + '\u0000' + version，合法 name/version 不可能包含该分隔符。 */
  toolRefs: string[]
  thinkingLevel: AgentThinkingLevel
  maxTurns: number
}

const DEFAULT_PAGE_SIZE = 20

function refKey(ref: AiModelRef): string {
  return `${ref.providerId}\u0000${ref.modelId}`
}

function toolRefKey(ref: AiToolRef): string {
  return `${ref.name}\u0000${ref.version}`
}

function parseToolRefKey(key: string): AiToolRef {
  const [name, version] = key.split('\u0000')
  if (!name || !version) {
    throw new Error(`无效的工具引用: ${key}`)
  }
  return { name, version }
}

// 结构化输出契约当前只由服务端注册、没有管理界面，编辑时原样带回，避免保存表单把已配置的契约清空。
function toConfig(values: AgentFormValues, current: AgentDefinitionConfig | null): AgentDefinitionConfig {
  const [providerId, modelId] = values.modelKey?.split('\u0000') ?? []
  return {
    schemaVersion: 2,
    model: providerId && modelId ? { providerId, modelId } : null,
    systemPromptId: values.systemPromptId ?? null,
    skillIds: values.skillIds,
    toolRefs: values.toolRefs.map(parseToolRefKey),
    outputContract: current?.outputContract ?? null,
    outputMode: current?.outputMode ?? 'optional',
    thinkingLevel: values.thinkingLevel,
    maxTurns: values.maxTurns,
  }
}

function toFormValues(agent: AgentDefinitionDetail): AgentFormValues {
  return {
    name: agent.name,
    description: agent.description,
    modelKey: agent.config.model ? refKey(agent.config.model) : undefined,
    systemPromptId: agent.config.systemPromptId ?? undefined,
    skillIds: agent.config.skillIds,
    toolRefs: agent.config.toolRefs.map(toolRefKey),
    thinkingLevel: agent.config.thinkingLevel,
    maxTurns: agent.config.maxTurns,
  }
}

function statusColor(status: AgentDefinitionStatus): string | undefined {
  if (status === 'enabled') return 'green'
  if (status === 'disabled') return 'orange'
  return undefined
}

interface ResourcePickerOption {
  value: string
  name: string
  description: string
  meta?: string
  searchText: string
}

interface ResourcePickerProps {
  emptyText: string
  loading?: boolean
  loadingText: string
  onChange?: (value: string[]) => void
  removeLabel: string
  options: ResourcePickerOption[]
  placeholder: string
  searchLabel: string
  selectedLabel: string
  value?: string[]
}

function ResourcePicker({
  emptyText,
  loading = false,
  loadingText,
  onChange,
  removeLabel,
  options,
  placeholder,
  searchLabel,
  selectedLabel,
  value = [],
}: ResourcePickerProps) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const selectedSet = useMemo(() => new Set(value), [value])
  const selectedOptions = value
    .map((selectedValue) => options.find((option) => option.value === selectedValue))
    .filter((option): option is ResourcePickerOption => option !== undefined)
  const filteredOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    if (!normalizedSearch) return options
    return options.filter((option) => option.searchText.toLocaleLowerCase().includes(normalizedSearch))
  }, [options, search])

  const toggleOption = (optionValue: string) => {
    const nextValue = selectedSet.has(optionValue)
      ? value.filter((valueItem) => valueItem !== optionValue)
      : [...value, optionValue]
    onChange?.(nextValue)
  }

  return (
    <div className="space-y-2">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="border-border-subtle min-w-0 rounded-md border">
          <div className="border-border-subtle border-b p-2">
            <Input.Search
              allowClear
              aria-label={searchLabel}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={placeholder}
              value={search}
            />
          </div>
          <div className="max-h-56 min-h-20 overflow-y-auto p-1">
            {loading ? (
              <div className="text-fg-muted flex min-h-20 items-center justify-center text-sm">{loadingText}</div>
            ) : filteredOptions.length === 0 ? (
              <div className="text-fg-muted flex min-h-20 items-center justify-center px-3 text-center text-sm">
                {emptyText}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <label
                  className="hover:bg-fill-tertiary flex min-w-0 cursor-pointer items-start gap-2 rounded px-2 py-2"
                  key={option.value}
                >
                  <Checkbox
                    aria-label={`${option.name}${option.meta ? ` ${option.meta}` : ''}`}
                    checked={selectedSet.has(option.value)}
                    onChange={() => toggleOption(option.value)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-fg block truncate text-sm font-medium">{option.name}</span>
                    {option.meta ? <span className="text-fg-muted block truncate text-xs">{option.meta}</span> : null}
                    <span className="text-fg-muted block truncate text-xs">{option.description}</span>
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
        <div className="border-border-subtle min-w-0 rounded-md border">
          <Button
            block
            className="justify-between"
            icon={<ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
            onClick={() => setExpanded((current) => !current)}
            type="text"
          >
            <span className="flex min-w-0 items-center gap-2 text-left">
              <span className="truncate">{selectedLabel}</span>
              <Tag className="mr-0" color={value.length ? 'blue' : undefined}>
                {value.length}
              </Tag>
            </span>
          </Button>
          {expanded ? (
            <div className="border-border-subtle max-h-56 overflow-y-auto border-t p-2">
              {selectedOptions.length === 0 ? (
                <div className="text-fg-muted py-6 text-center text-sm">{emptyText}</div>
              ) : (
                <div className="space-y-1">
                  {selectedOptions.map((option) => (
                    <div
                      className="bg-fill-tertiary flex min-w-0 items-center gap-2 rounded px-2 py-1.5"
                      key={option.value}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{option.name}</span>
                      {option.meta ? (
                        <span className="text-fg-muted max-w-24 truncate text-xs">{option.meta}</span>
                      ) : null}
                      <Button
                        aria-label={`${removeLabel} ${option.name}`}
                        icon={<X className="size-3.5" />}
                        onClick={() => toggleOption(option.value)}
                        size="small"
                        type="text"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function Agents() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<AgentFormValues>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [editing, setEditing] = useState<AgentDefinitionDetail | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const agentsQuery = useAdminAgentDefinitionsQuery({ page, pageSize })
  const modelsQuery = useAdminAiModelsQuery()
  const promptsQuery = useSystemPromptsQuery()
  const skillsQuery = useSkillsQuery()
  const toolsQuery = useAdminAiToolsQuery()
  const createAgent = useCreateAgentDefinitionMutation()
  const updateAgent = useUpdateAgentDefinitionMutation()
  const updateStatus = useUpdateAgentDefinitionStatusMutation()

  const models = useMemo(() => modelsQuery.data?.items ?? [], [modelsQuery.data])
  const prompts = useMemo(() => promptsQuery.data ?? [], [promptsQuery.data])
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data])
  const tools = useMemo(() => toolsQuery.data ?? [], [toolsQuery.data])

  const modelOptions = useMemo(
    () =>
      models
        .filter((model) => model.available || model.enabled)
        .map((model) => ({
          label: `${model.providerName} / ${model.name}`,
          value: refKey(model),
        })),
    [models],
  )
  const promptOptions = useMemo(
    () =>
      prompts
        .filter((prompt) => prompt.enabled || prompt.id === editing?.config.systemPromptId)
        .map((prompt) => ({ label: prompt.name, value: prompt.id })),
    [editing?.config.systemPromptId, prompts],
  )
  const skillOptions = useMemo(
    () =>
      skills
        .filter((skill) => skill.enabled || editing?.config.skillIds.includes(skill.id))
        .map((skill) => ({
          description: skill.description,
          name: skill.name,
          searchText: `${skill.name} ${skill.description}`,
          value: skill.id,
        })),
    [editing?.config.skillIds, skills],
  )
  const toolOptions = useMemo(
    () =>
      tools.map((tool: AiToolSummary) => ({
        description: tool.description,
        meta: `${tool.name}@${tool.version} · ${tool.scope}`,
        name: tool.name,
        searchText: `${tool.name} ${tool.version} ${tool.description} ${tool.scope}`,
        value: toolRefKey(tool),
      })),
    [tools],
  )

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      description: '',
      maxTurns: 8,
      skillIds: [],
      thinkingLevel: 'off',
      toolRefs: [],
    })
    setDrawerOpen(true)
  }

  const openEdit = (agent: AgentDefinitionDetail) => {
    setEditing(agent)
    form.setFieldsValue(toFormValues(agent))
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setEditing(null)
    form.resetFields()
  }

  const submit = async (values: AgentFormValues) => {
    // 同名不同版本的引用不能共存：Pi 模型调用只携带 Tool name，
    // 服务端仍是最终校验边界，这里只是提前给出可读错误。
    const refs = values.toolRefs.map(parseToolRefKey)
    const seenNames = new Set<string>()
    const hasDuplicateName = refs.some((ref) => {
      if (seenNames.has(ref.name)) return true
      seenNames.add(ref.name)
      return false
    })
    if (hasDuplicateName) {
      message.error(t('ai.agents.toolsVersionConflict'))
      return
    }
    const config = toConfig(values, editing?.config ?? null)
    try {
      if (editing) {
        const input: UpdateAgentDefinitionInput = {
          name: values.name,
          description: values.description,
          config,
        }
        await updateAgent.mutateAsync({ agentId: editing.id, values: input })
        message.success(t('ai.agents.updateSuccess'))
      } else {
        const input: CreateAgentDefinitionInput = {
          name: values.name,
          description: values.description,
          config,
        }
        await createAgent.mutateAsync(input)
        message.success(t('ai.agents.createSuccess'))
      }
      closeDrawer()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.agents.saveFailed'))
    }
  }

  const changeStatus = async (agent: AgentDefinitionDetail) => {
    const nextStatus = agent.status === 'enabled' ? 'disabled' : 'enabled'
    try {
      await updateStatus.mutateAsync({ agentId: agent.id, values: { status: nextStatus } })
      message.success(t(nextStatus === 'enabled' ? 'ai.agents.enableSuccess' : 'ai.agents.disableSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.agents.statusFailed'))
    }
  }

  const resourceError = modelsQuery.error ?? promptsQuery.error ?? skillsQuery.error ?? toolsQuery.error
  const retryResources = () => {
    void Promise.all([modelsQuery.refetch(), promptsQuery.refetch(), skillsQuery.refetch(), toolsQuery.refetch()])
  }

  const columns: TableProps<AgentDefinitionDetail>['columns'] = [
    {
      key: 'agent',
      title: t('ai.agents.columns.agent'),
      render: (_, agent) => (
        <div className="min-w-52">
          <Typography.Text strong className="break-words">
            {agent.name}
          </Typography.Text>
          {agent.description ? <div className="text-fg-muted mt-1 break-words text-sm">{agent.description}</div> : null}
        </div>
      ),
    },
    {
      dataIndex: 'status',
      key: 'status',
      title: t('ai.agents.columns.status'),
      width: 120,
      render: (status: AgentDefinitionStatus) => (
        <Tag color={statusColor(status)}>{t(`ai.agents.status.${status}`)}</Tag>
      ),
    },
    {
      dataIndex: 'revision',
      key: 'revision',
      title: t('ai.agents.columns.revision'),
      width: 100,
    },
    {
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      title: t('ai.agents.columns.updatedAt'),
      width: 190,
      render: (updatedAt: string) => (
        <span className="text-fg-muted whitespace-nowrap text-sm">{formatDate(updatedAt)}</span>
      ),
    },
    {
      key: 'actions',
      title: t('common.actions'),
      fixed: 'right',
      width: 130,
      render: (_, agent) => (
        <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
          <Space size="small">
            <Tooltip title={t('common.edit')}>
              <Button
                aria-label={t('common.edit')}
                icon={<Pencil className="size-3.5" />}
                onClick={() => openEdit(agent)}
              />
            </Tooltip>
            <Tooltip title={t(agent.status === 'enabled' ? 'ai.agents.disable' : 'ai.agents.enable')}>
              <Button
                aria-label={t(agent.status === 'enabled' ? 'ai.agents.disable' : 'ai.agents.enable')}
                icon={agent.status === 'enabled' ? <Power className="size-3.5" /> : <Check className="size-3.5" />}
                loading={updateStatus.isPending && updateStatus.variables?.agentId === agent.id}
                onClick={() => void changeStatus(agent)}
              />
            </Tooltip>
          </Space>
        </PermissionGuard>
      ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-2">
        <AdminPageHeader title={t('ai.agents.title')} description={t('ai.agents.description')} />
        <PageToolbar
          summaryItems={[
            { label: t('ai.agents.summary.total'), value: agentsQuery.data?.total ?? 0 },
            {
              label: t('ai.agents.summary.enabled'),
              value: agentsQuery.data?.items.filter((agent) => agent.status === 'enabled').length ?? 0,
            },
          ]}
          actions={
            <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
              <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                {t('ai.agents.create')}
              </Button>
            </PermissionGuard>
          }
        />
      </div>

      {agentsQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('ai.agents.loadFailed')}
          description={agentsQuery.error instanceof Error ? agentsQuery.error.message : undefined}
          action={<Button onClick={() => void agentsQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

      {resourceError ? (
        <Alert
          showIcon
          type="error"
          message={t('ai.agents.resourcesLoadFailed')}
          description={resourceError instanceof Error ? resourceError.message : undefined}
          action={<Button onClick={retryResources}>{t('common.retry')}</Button>}
        />
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col">
        <Table<AgentDefinitionDetail>
          rowKey="id"
          className="guide-table-fill min-h-64"
          columns={columns}
          dataSource={agentsQuery.data?.items ?? []}
          loading={agentsQuery.isLoading}
          locale={{ emptyText: <Empty description={t('ai.agents.empty')} /> }}
          pagination={{
            current: page,
            pageSize,
            showSizeChanger: true,
            total: agentsQuery.data?.total ?? 0,
            onChange: (nextPage, nextPageSize) => {
              if (nextPageSize !== pageSize) {
                setPageSize(nextPageSize)
                setPage(1)
                return
              }
              setPage(nextPage)
            },
          }}
          scroll={{ x: 'max-content', y: '100%' }}
        />
      </section>

      <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
        <Drawer
          destroyOnHidden
          extra={
            <Button
              type="primary"
              icon={<Save className="size-4" />}
              loading={createAgent.isPending || updateAgent.isPending}
              onClick={() => form.submit()}
            >
              {t('common.save')}
            </Button>
          }
          onClose={closeDrawer}
          open={drawerOpen}
          title={editing ? t('ai.agents.edit') : t('ai.agents.create')}
          width={560}
        >
          <Form<AgentFormValues>
            form={form}
            layout="vertical"
            onFinish={(values) => void submit(values)}
            initialValues={{ description: '', maxTurns: 8, skillIds: [], thinkingLevel: 'off', toolRefs: [] }}
          >
            <Form.Item
              label={t('ai.agents.name')}
              name="name"
              rules={[{ required: true, message: t('ai.agents.nameRequired') }]}
            >
              <Input maxLength={80} showCount />
            </Form.Item>
            <Form.Item label={t('ai.agents.descriptionLabel')} name="description">
              <Input.TextArea maxLength={500} showCount rows={3} />
            </Form.Item>
            <div className="border-border-subtle mb-4 border-t pt-4">
              <div className="text-fg mb-1 flex items-center gap-2 font-medium">
                <Bot className="size-4" />
                {t('ai.agents.executionConfig')}
              </div>
              <p className="text-fg-muted mb-4 text-sm">{t('ai.agents.executionConfigDescription')}</p>
            </div>
            <Form.Item label={t('ai.agents.model')} name="modelKey">
              <Select
                allowClear
                loading={modelsQuery.isLoading}
                options={modelOptions}
                placeholder={t('ai.agents.modelPlaceholder')}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
            <Form.Item label={t('ai.agents.systemPrompt')} name="systemPromptId">
              <Select
                allowClear
                loading={promptsQuery.isLoading}
                options={promptOptions}
                placeholder={t('ai.agents.systemPromptPlaceholder')}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
            <Form.Item label={t('ai.agents.skills')} name="skillIds">
              <ResourcePicker
                emptyText={t('ai.agents.resourcePicker.empty')}
                loading={skillsQuery.isLoading}
                loadingText={t('ai.agents.resourcePicker.loading')}
                placeholder={t('ai.agents.skillsPlaceholder')}
                removeLabel={t('ai.agents.resourcePicker.remove')}
                options={skillOptions}
                searchLabel={t('ai.agents.resourcePicker.searchSkills')}
                selectedLabel={t('ai.agents.resourcePicker.selectedSkills')}
              />
            </Form.Item>
            <Form.Item label={t('ai.agents.tools')} name="toolRefs">
              <ResourcePicker
                emptyText={t('ai.agents.resourcePicker.empty')}
                loading={toolsQuery.isLoading}
                loadingText={t('ai.agents.resourcePicker.loading')}
                placeholder={t('ai.agents.toolsPlaceholder')}
                removeLabel={t('ai.agents.resourcePicker.remove')}
                options={toolOptions}
                searchLabel={t('ai.agents.resourcePicker.searchTools')}
                selectedLabel={t('ai.agents.resourcePicker.selectedTools')}
              />
            </Form.Item>
            <div className="grid gap-4 sm:grid-cols-2">
              <Form.Item label={t('ai.agents.thinkingLevel')} name="thinkingLevel">
                <Select
                  options={['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => ({
                    label: t(`ai.agents.thinking.${level}`),
                    value: level,
                  }))}
                />
              </Form.Item>
              <Form.Item
                label={t('ai.agents.maxTurns')}
                name="maxTurns"
                rules={[{ required: true, message: t('ai.agents.maxTurnsRequired') }]}
              >
                <InputNumber className="w-full" max={32} min={1} precision={0} />
              </Form.Item>
            </div>
          </Form>
        </Drawer>
      </PermissionGuard>
    </div>
  )
}
