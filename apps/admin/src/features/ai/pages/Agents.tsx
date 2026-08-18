import type {
  AgentDefinitionConfig,
  AgentDefinitionDetail,
  AgentDefinitionStatus,
  AgentThinkingLevel,
  AiModelRef,
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
import { AdminPageHeader, PermissionGuard } from '@admin/components/common'
import {
  Alert,
  App,
  Button,
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
import { Bot, Check, Pencil, Plus, Power, Save } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface AgentFormValues {
  name: string
  description: string
  modelKey?: string
  systemPromptId?: string
  skillIds: string[]
  toolNames: string[]
  thinkingLevel: AgentThinkingLevel
  maxTurns: number
}

const DEFAULT_PAGE_SIZE = 20

function refKey(ref: AiModelRef): string {
  return `${ref.providerId}\u0000${ref.modelId}`
}

function toConfig(values: AgentFormValues): AgentDefinitionConfig {
  const [providerId, modelId] = values.modelKey?.split('\u0000') ?? []
  return {
    schemaVersion: 1,
    model: providerId && modelId ? { providerId, modelId } : null,
    systemPromptId: values.systemPromptId ?? null,
    skillIds: values.skillIds,
    toolNames: values.toolNames,
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
    toolNames: agent.config.toolNames,
    thinkingLevel: agent.config.thinkingLevel,
    maxTurns: agent.config.maxTurns,
  }
}

function statusColor(status: AgentDefinitionStatus): string | undefined {
  if (status === 'enabled') return 'green'
  if (status === 'disabled') return 'orange'
  return undefined
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
        .map((skill) => ({ label: `${skill.name} — ${skill.description}`, value: skill.id })),
    [editing?.config.skillIds, skills],
  )
  const toolOptions = useMemo(() => tools.map((tool) => ({ label: tool.name, value: tool.name })), [tools])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      description: '',
      maxTurns: 8,
      skillIds: [],
      thinkingLevel: 'off',
      toolNames: [],
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
    const config = toConfig(values)
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
      width: 210,
    },
    {
      key: 'actions',
      title: t('common.actions'),
      fixed: 'right',
      width: 190,
      render: (_, agent) => (
        <Space size="small">
          <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
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
          </PermissionGuard>
        </Space>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t('ai.agents.title')}
        description={t('ai.agents.description')}
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

      <section className="min-w-0">
        <Table<AgentDefinitionDetail>
          rowKey="id"
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
          scroll={{ x: 'max-content' }}
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
            initialValues={{ description: '', maxTurns: 8, skillIds: [], thinkingLevel: 'off', toolNames: [] }}
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
              <Select
                loading={skillsQuery.isLoading}
                mode="multiple"
                options={skillOptions}
                placeholder={t('ai.agents.skillsPlaceholder')}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
            <Form.Item label={t('ai.agents.tools')} name="toolNames">
              <Select
                loading={toolsQuery.isLoading}
                mode="multiple"
                options={toolOptions}
                placeholder={t('ai.agents.toolsPlaceholder')}
                showSearch
                optionFilterProp="label"
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
