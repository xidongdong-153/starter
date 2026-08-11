import type { AuditAction, AuthorizationAuditEvent, AuthorizationAuditQuery } from '@starter/contracts'
import type { TableProps } from 'antd'
import type { Dayjs } from 'dayjs'

import { AuditActions } from '@starter/contracts'

import { useAuthorizationAuditEventsQuery } from '@admin/api/authorization'
import { AdminPageHeader } from '@admin/components/common'
import { projectAuditPayload } from '@admin/features/authorization/audit-presentation'

import { Alert, Button, DatePicker, Form, Input, Select, Table, Tag, Typography } from 'antd'
import { RotateCcw, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface AuditFilterValues {
  action?: AuditAction
  actorId?: string
  targetId?: string
  timeRange?: [Dayjs, Dayjs]
}

const actionOptions = Object.values(AuditActions).map((action) => ({ label: action, value: action }))

const copyableText = 'max-w-56 break-all'

/** 组件只消费 contracts 的判别联合，不读取数据库 JSON。 */
function AuditPayloadCell({ event, side }: { event: AuthorizationAuditEvent; side: 'before' | 'after' }) {
  const { t } = useTranslation()
  const payload = projectAuditPayload(event, side)

  switch (payload.kind) {
    case 'empty':
      return <span className="text-fg-muted text-sm">-</span>
    case 'role-created':
      return (
        <div className="min-w-40 space-y-1 text-sm">
          <div className="text-fg break-words">{payload.name}</div>
          {payload.description ? <div className="text-fg-muted break-words">{payload.description}</div> : null}
          <KeyTags keys={payload.permissionKeys} removed={[]} added={payload.permissionKeys} />
        </div>
      )
    case 'role-metadata':
      return (
        <div className="min-w-40 space-y-1 text-sm">
          <div className="text-fg break-words">{payload.name}</div>
          <div className="text-fg-muted break-words">{payload.description ?? '-'}</div>
        </div>
      )
    case 'role-status':
      return (
        <Tag className="m-0" color={payload.archived ? 'orange' : 'green'}>
          {payload.archived ? t('audit.roleArchived') : t('audit.roleActive')}
        </Tag>
      )
    case 'keys':
      return <KeyTags keys={payload.keys} removed={payload.removed} added={payload.added} />
  }
}

function KeyTags({ keys, removed, added }: { keys: string[]; removed: string[]; added: string[] }) {
  const { t } = useTranslation()

  if (keys.length === 0) {
    return <span className="text-fg-muted text-sm">{t('audit.emptySet')}</span>
  }

  return (
    <div className="flex max-w-md flex-wrap gap-1">
      {keys.map((key) => (
        <Tag
          key={key}
          className="m-0 max-w-full break-all"
          color={removed.includes(key) ? 'red' : added.includes(key) ? 'green' : undefined}
          style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}
        >
          {key}
        </Tag>
      ))}
    </div>
  )
}

export function AuthorizationAudit() {
  const { t } = useTranslation()
  const [filterForm] = Form.useForm<AuditFilterValues>()
  const [query, setQuery] = useState<AuthorizationAuditQuery>({ page: 1, pageSize: 20 })
  const auditQuery = useAuthorizationAuditEventsQuery(query)

  const applyFilters = (values: AuditFilterValues) => {
    setQuery((previous) => ({
      page: 1,
      pageSize: previous.pageSize,
      action: values.action,
      actorId: values.actorId?.trim() || undefined,
      targetId: values.targetId?.trim() || undefined,
      from: values.timeRange?.[0]?.toISOString(),
      to: values.timeRange?.[1]?.toISOString(),
    }))
  }

  const clearFilters = () => {
    filterForm.resetFields()
    setQuery((previous) => ({ page: 1, pageSize: previous.pageSize }))
  }

  const columns: TableProps<AuthorizationAuditEvent>['columns'] = [
    {
      key: 'createdAt',
      title: t('audit.columns.createdAt'),
      render: (_, event) => (
        <span className="text-fg-muted min-w-40 text-sm">{new Date(event.createdAt).toLocaleString()}</span>
      ),
    },
    {
      key: 'action',
      title: t('audit.columns.action'),
      render: (_, event) => <Tag className="m-0">{event.action}</Tag>,
    },
    {
      key: 'actor',
      title: t('audit.columns.actor'),
      render: (_, event) => (
        <div className="min-w-40">
          <Tag className="m-0">{event.actorType}</Tag>
          <Typography.Text copyable ellipsis className={`${copyableText} mt-1 block text-sm`}>
            {event.actorId}
          </Typography.Text>
        </div>
      ),
    },
    {
      key: 'target',
      title: t('audit.columns.target'),
      render: (_, event) => (
        <div className="min-w-40">
          <Tag className="m-0">{event.targetType}</Tag>
          <Typography.Text copyable ellipsis className={`${copyableText} mt-1 block text-sm`}>
            {event.targetId}
          </Typography.Text>
        </div>
      ),
    },
    {
      key: 'before',
      title: t('audit.columns.before'),
      render: (_, event) => <AuditPayloadCell event={event} side="before" />,
    },
    {
      key: 'after',
      title: t('audit.columns.after'),
      render: (_, event) => <AuditPayloadCell event={event} side="after" />,
    },
    {
      key: 'requestId',
      title: t('audit.columns.requestId'),
      render: (_, event) =>
        event.requestId ? (
          <Typography.Text copyable ellipsis className={`${copyableText} text-sm`}>
            {event.requestId}
          </Typography.Text>
        ) : (
          <span className="text-fg-muted text-sm">-</span>
        ),
    },
  ]

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t('audit.title')}
        description={t('audit.description')}
        summaryItems={[{ label: t('audit.summary.total'), value: auditQuery.data?.total ?? 0 }]}
      />

      {auditQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('audit.loadFailed')}
          description={auditQuery.error instanceof Error ? auditQuery.error.message : undefined}
          action={<Button onClick={() => void auditQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

      <Form form={filterForm} layout="inline" onFinish={applyFilters} className="flex flex-wrap gap-y-3">
        <Form.Item name="action" className="m-0 w-full sm:w-auto">
          <Select
            allowClear
            className="w-full sm:w-64"
            placeholder={t('audit.filters.action')}
            options={actionOptions}
          />
        </Form.Item>
        <Form.Item name="actorId" className="m-0 w-full sm:w-auto">
          <Input allowClear className="w-full sm:w-64" placeholder={t('audit.filters.actorId')} />
        </Form.Item>
        <Form.Item name="targetId" className="m-0 w-full sm:w-auto">
          <Input allowClear className="w-full sm:w-64" placeholder={t('audit.filters.targetId')} />
        </Form.Item>
        <Form.Item name="timeRange" className="m-0 w-full sm:w-auto">
          <DatePicker.RangePicker
            showTime
            className="w-full sm:w-80"
            placeholder={[t('audit.filters.from'), t('audit.filters.to')]}
          />
        </Form.Item>
        <Form.Item className="m-0">
          <Button type="primary" htmlType="submit" icon={<Search className="size-4" />}>
            {t('audit.filters.apply')}
          </Button>
        </Form.Item>
        <Form.Item className="m-0">
          <Button icon={<RotateCcw className="size-4" />} onClick={clearFilters}>
            {t('audit.filters.clear')}
          </Button>
        </Form.Item>
      </Form>

      <section className="min-w-0">
        <Table<AuthorizationAuditEvent>
          rowKey="id"
          columns={columns}
          dataSource={auditQuery.data?.items ?? []}
          loading={auditQuery.isLoading}
          locale={{ emptyText: t('audit.empty') }}
          scroll={{ x: 'max-content' }}
          pagination={{
            current: query.page,
            pageSize: query.pageSize,
            total: auditQuery.data?.total ?? 0,
            showSizeChanger: true,
            onChange: (page, pageSize) => setQuery((prev) => ({ ...prev, page, pageSize })),
          }}
        />
      </section>
    </div>
  )
}
