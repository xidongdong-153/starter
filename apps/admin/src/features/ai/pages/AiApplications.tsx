import type {
  AiApplication,
  AiApplicationPolicy,
  AiApplicationSecret,
  CreateAiApplicationInput,
  ExecutableControl,
} from '@starter/contracts'
import type { TableProps } from 'antd'

import { PermissionKeys, aiScopeIdSchema } from '@starter/contracts'
import {
  Alert,
  App,
  Button,
  Checkbox,
  Collapse,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { Copy, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useAgentDefinitionsQuery,
  useAiApplicationsQuery,
  useCreateAiApplicationMutation,
  useRevokeAiApplicationMutation,
  useRotateAiApplicationSecretMutation,
} from '@admin/api/ai'
import { AdminPageHeader, PageToolbar, PermissionGuard } from '@admin/components/common'
import { formatDate } from '@admin/utils/dayjs'

interface ApplicationFormValues {
  name: string
  tenantId: string
  projectId: string
  executableIds: string[]
  controls: ExecutableControl[]
  maxSideEffect: AiApplicationPolicy['maxSideEffect']
}

/** 生成满足 aiScopeIdSchema 的随机 scope id：前缀 + 32 位 hex。 */
function generateScopeId(prefix: 'ten' | 'prj'): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export function AiApplications() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const applicationsQuery = useAiApplicationsQuery()
  // 策略里的 executables 只能选启用中的 Agent，用公开列表（启用状态）而不是 admin 全量列表。
  const agentsQuery = useAgentDefinitionsQuery({ page: 1, pageSize: 100 })
  const agents = agentsQuery.data?.items ?? []
  const createApplication = useCreateAiApplicationMutation()
  const rotateSecret = useRotateAiApplicationSecretMutation()
  const revokeApplication = useRevokeAiApplicationMutation()

  const [createOpen, setCreateOpen] = useState(false)
  // 每次打开弹窗重新生成，随 destroyOnHidden 重建表单时作为 initialValues 生效。
  const [generatedScopes, setGeneratedScopes] = useState({ tenantId: '', projectId: '' })
  const [form] = Form.useForm<ApplicationFormValues>()
  // secret 只留在组件 state：不进 query cache、不进 URL、不写 localStorage。
  const [issuedSecret, setIssuedSecret] = useState<AiApplicationSecret | null>(null)

  const applications = applicationsQuery.data ?? []

  const openCreate = () => {
    setGeneratedScopes({
      tenantId: generateScopeId('ten'),
      projectId: generateScopeId('prj'),
    })
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    let values: ApplicationFormValues
    // 校验失败由 Form 自己标红字段，这里直接返回，不让 rejection 流到 Modal onOk 外面。
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    const input: CreateAiApplicationInput = {
      name: values.name.trim(),
      tenantId: values.tenantId.trim(),
      projectId: values.projectId.trim(),
      policy: {
        schemaVersion: 1,
        // version 用创建时看到的 revision；列表里找不到的 id 直接丢弃，不猜测版本号。
        executables: values.executableIds.flatMap((id) => {
          const agent = agents.find((candidate) => candidate.id === id)
          return agent ? [{ id, version: agent.revision }] : []
        }),
        controls: values.controls,
        maxSideEffect: values.maxSideEffect,
      },
    }
    try {
      const created = await createApplication.mutateAsync(input)
      setCreateOpen(false)
      setIssuedSecret(created)
      message.success(t('ai.applications.createSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.applications.saveFailed'))
    }
  }

  const rotate = async (application: AiApplication) => {
    try {
      const rotated = await rotateSecret.mutateAsync(application.appId)
      setIssuedSecret(rotated)
      message.success(t('ai.applications.rotateSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.applications.rotateFailed'))
    }
  }

  const revoke = async (application: AiApplication) => {
    try {
      await revokeApplication.mutateAsync(application.appId)
      message.success(t('ai.applications.revokeSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('ai.applications.revokeFailed'))
    }
  }

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret)
      message.success(t('ai.applications.secret.copySuccess'))
    } catch {
      message.error(t('ai.applications.secret.copyFailed'))
    }
  }

  // 关闭弹窗时同时 reset mutation，避免 secret 留在 MutationCache 里。
  const closeSecret = () => {
    setIssuedSecret(null)
    createApplication.reset()
    rotateSecret.reset()
  }

  const scopeRules = (requiredMessage: string) => [
    { required: true, message: requiredMessage },
    {
      validator: (_: unknown, value: string) =>
        !value || aiScopeIdSchema.safeParse(value.trim()).success
          ? Promise.resolve()
          : Promise.reject(new Error(t('ai.applications.scopeInvalid'))),
    },
  ]

  const columns: TableProps<AiApplication>['columns'] = [
    {
      dataIndex: 'name',
      key: 'name',
      title: t('ai.applications.columns.name'),
      render: (name: string) => (
        <Typography.Text strong className="break-words">
          {name}
        </Typography.Text>
      ),
    },
    {
      dataIndex: 'tenantId',
      key: 'tenantId',
      title: t('ai.applications.columns.tenantId'),
      width: 160,
      render: (tenantId: string) => <Typography.Text className="break-all">{tenantId}</Typography.Text>,
    },
    {
      dataIndex: 'projectId',
      key: 'projectId',
      title: t('ai.applications.columns.projectId'),
      width: 160,
      render: (projectId: string) => <Typography.Text className="break-all">{projectId}</Typography.Text>,
    },
    {
      dataIndex: 'status',
      key: 'status',
      title: t('ai.applications.columns.status'),
      width: 110,
      render: (status: AiApplication['status']) => (
        <Tag color={status === 'active' ? 'green' : 'default'}>{t(`ai.applications.status.${status}`)}</Tag>
      ),
    },
    {
      dataIndex: 'secretPrefix',
      key: 'secretPrefix',
      title: t('ai.applications.columns.secretPrefix'),
      width: 160,
      render: (secretPrefix: string) => <Typography.Text code>{secretPrefix}</Typography.Text>,
    },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      title: t('ai.applications.columns.createdAt'),
      width: 190,
      render: (createdAt: string) => (
        <span className="text-fg-muted whitespace-nowrap text-sm">{formatDate(createdAt)}</span>
      ),
    },
    {
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      title: t('ai.applications.columns.lastUsedAt'),
      width: 190,
      render: (lastUsedAt: string | null) => (
        <span className="text-fg-muted whitespace-nowrap text-sm">
          {lastUsedAt ? formatDate(lastUsedAt) : t('ai.applications.neverUsed')}
        </span>
      ),
    },
    {
      key: 'actions',
      title: t('common.actions'),
      fixed: 'right',
      width: 120,
      render: (_, application) =>
        application.status === 'revoked' ? null : (
          <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
            <Space size="small">
              <Popconfirm
                title={t('ai.applications.rotateConfirm')}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                onConfirm={() => rotate(application)}
              >
                <Tooltip title={t('ai.applications.rotate')}>
                  <Button
                    aria-label={t('ai.applications.rotate')}
                    icon={<RefreshCw className="size-3.5" />}
                    loading={rotateSecret.isPending && rotateSecret.variables === application.appId}
                  />
                </Tooltip>
              </Popconfirm>
              <Popconfirm
                title={t('ai.applications.revokeConfirm')}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                onConfirm={() => revoke(application)}
              >
                <Tooltip title={t('ai.applications.revoke')}>
                  <Button
                    danger
                    aria-label={t('ai.applications.revoke')}
                    icon={<Trash2 className="size-3.5" />}
                    loading={revokeApplication.isPending && revokeApplication.variables === application.appId}
                  />
                </Tooltip>
              </Popconfirm>
            </Space>
          </PermissionGuard>
        ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-2">
        <AdminPageHeader title={t('ai.applications.title')} description={t('ai.applications.description')} />
        <PageToolbar
          summaryItems={[
            { label: t('ai.applications.summary.total'), value: applications.length },
            {
              label: t('ai.applications.summary.active'),
              value: applications.filter((application) => application.status === 'active').length,
            },
          ]}
          actions={
            <PermissionGuard permission={PermissionKeys.AI_CONFIG_MANAGE}>
              <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                {t('ai.applications.create')}
              </Button>
            </PermissionGuard>
          }
        />
      </div>

      {applicationsQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('ai.applications.loadFailed')}
          description={applicationsQuery.error instanceof Error ? applicationsQuery.error.message : undefined}
          action={<Button onClick={() => void applicationsQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col">
        <Table<AiApplication>
          rowKey="appId"
          className="guide-table-fill min-h-64"
          columns={columns}
          dataSource={applications}
          loading={applicationsQuery.isLoading}
          locale={{ emptyText: t('ai.applications.empty') }}
          pagination={false}
          scroll={{ x: 'max-content', y: '100%' }}
        />
      </section>

      <Modal
        title={t('ai.applications.create')}
        open={createOpen}
        onOk={submitCreate}
        onCancel={() => setCreateOpen(false)}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={createApplication.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            ...generatedScopes,
            executableIds: [],
            controls: ['abort', 'steer', 'follow_up'],
            maxSideEffect: 'read_only',
          }}
        >
          <Form.Item
            name="name"
            label={t('ai.applications.name')}
            rules={[{ required: true, whitespace: true, message: t('ai.applications.nameRequired') }]}
          >
            <Input maxLength={120} placeholder={t('ai.applications.namePlaceholder')} />
          </Form.Item>
          <Form.Item name="maxSideEffect" label={t('ai.applications.policy.maxSideEffect')}>
            <Select
              options={(
                [
                  ['read_only', 'maxSideEffectReadOnly'],
                  ['idempotent_write', 'maxSideEffectIdempotentWrite'],
                  ['non_idempotent_write', 'maxSideEffectNonIdempotentWrite'],
                ] as const
              ).map(([value, labelKey]) => ({
                value,
                label: t(`ai.applications.policy.${labelKey}`),
              }))}
            />
          </Form.Item>
          <Form.Item name="controls" label={t('ai.applications.policy.controls')}>
            <Checkbox.Group
              options={(
                [
                  ['abort', 'controlsAbort'],
                  ['steer', 'controlsSteer'],
                  ['follow_up', 'controlsFollowUp'],
                ] as const
              ).map(([value, labelKey]) => ({
                value,
                label: t(`ai.applications.policy.${labelKey}`),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="executableIds"
            label={t('ai.applications.policy.executables')}
            extra={t('ai.applications.policy.hint')}
          >
            <Select
              mode="multiple"
              loading={agentsQuery.isLoading}
              options={agents.map((agent) => ({
                value: agent.id,
                label: `${agent.name} · v${agent.revision}`,
              }))}
              placeholder={t('ai.applications.policy.executablesPlaceholder')}
            />
          </Form.Item>
          <Collapse
            ghost
            items={[
              {
                key: 'advanced',
                label: t('ai.applications.advanced'),
                // 收起时也要保持字段挂载，否则值不进入表单 store，提交时拿不到。
                forceRender: true,
                children: (
                  <>
                    <Form.Item
                      name="tenantId"
                      label={t('ai.applications.tenantId')}
                      rules={scopeRules(t('ai.applications.tenantIdRequired'))}
                    >
                      <Input maxLength={120} />
                    </Form.Item>
                    <Form.Item
                      name="projectId"
                      label={t('ai.applications.projectId')}
                      rules={scopeRules(t('ai.applications.projectIdRequired'))}
                      extra={t('ai.applications.scopeHint')}
                    >
                      <Input maxLength={120} />
                    </Form.Item>
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      <Modal
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {t('ai.applications.secret.title')}
          </span>
        }
        open={issuedSecret !== null}
        onCancel={closeSecret}
        onOk={closeSecret}
        okText={t('ai.applications.secret.close')}
        cancelButtonProps={{ style: { display: 'none' } }}
        destroyOnHidden
      >
        <Alert showIcon type="warning" message={t('ai.applications.secret.warning')} className="mb-4" />
        <p className="text-fg-muted mb-2 text-sm">
          {t('ai.applications.secret.owner', { name: issuedSecret?.application.name ?? '' })}
        </p>
        <div className="flex items-start gap-2">
          <Typography.Text code copyable={false} className="break-all">
            {issuedSecret?.secret}
          </Typography.Text>
          <Tooltip title={t('ai.applications.secret.copy')}>
            <Button
              aria-label={t('ai.applications.secret.copy')}
              icon={<Copy className="size-3.5" />}
              onClick={() => void copySecret(issuedSecret?.secret ?? '')}
            />
          </Tooltip>
        </div>
      </Modal>
    </div>
  )
}
