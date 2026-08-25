import type { AiModelCallAudit, AiModelCallAuditDetail, AiModelCallAuditQuery } from '@starter/contracts'
import type { TableProps } from 'antd'
import type { Dayjs } from 'dayjs'

import { Alert, Button, DatePicker, Drawer, Form, Input, Select, Table, Tag, Tooltip, Typography } from 'antd'
import { Eye, RotateCcw, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAiUsageCallQuery, useAiUsageCallsQuery } from '@admin/api/ai'
import { AdminPageHeader, PageToolbar } from '@admin/components/common'

interface FilterValues {
  userId?: string
  providerId?: string
  modelId?: string
  result?: AiModelCallAuditQuery['result']
  requestId?: string
  timeRange?: [Dayjs, Dayjs]
}

const resultColors: Record<AiModelCallAudit['result'], string> = {
  running: 'blue',
  succeeded: 'green',
  auth_failed: 'red',
  upstream_failed: 'red',
  timed_out: 'orange',
  cancelled: 'gold',
  interrupted: 'purple',
}

export function AiUsageAudit() {
  const { t } = useTranslation()
  const [form] = Form.useForm<FilterValues>()
  const [query, setQuery] = useState<AiModelCallAuditQuery>({ page: 1, pageSize: 20 })
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)
  const callsQuery = useAiUsageCallsQuery(query)
  const detailQuery = useAiUsageCallQuery(selectedCallId)

  const applyFilters = (values: FilterValues) => {
    setQuery({
      page: 1,
      pageSize: query.pageSize,
      userId: values.userId?.trim() || undefined,
      providerId: values.providerId?.trim() || undefined,
      modelId: values.modelId?.trim() || undefined,
      result: values.result,
      requestId: values.requestId?.trim() || undefined,
      from: values.timeRange?.[0]?.toISOString(),
      to: values.timeRange?.[1]?.toISOString(),
    })
  }

  const clearFilters = () => {
    form.resetFields()
    setQuery({ page: 1, pageSize: query.pageSize })
  }

  const columns: TableProps<AiModelCallAudit>['columns'] = [
    {
      key: 'startedAt',
      title: t('ai.usage.columns.startedAt'),
      render: (_, item) => (
        <span className="text-fg-muted whitespace-nowrap">{new Date(item.startedAt).toLocaleString()}</span>
      ),
    },
    {
      key: 'model',
      title: t('ai.usage.columns.model'),
      render: (_, item) => (
        <div className="min-w-44">
          <div className="break-all font-medium">{item.modelId}</div>
          <div className="text-fg-muted break-all text-xs">{item.providerId}</div>
        </div>
      ),
    },
    {
      key: 'result',
      title: t('ai.usage.columns.result'),
      render: (_, item) => <Tag color={resultColors[item.result]}>{t(`ai.usage.results.${item.result}`)}</Tag>,
    },
    {
      key: 'usage',
      title: t('ai.usage.columns.tokens'),
      render: (_, item) => item.usage.totalTokens ?? '-',
    },
    {
      key: 'duration',
      title: t('ai.usage.columns.duration'),
      render: (_, item) => (item.durationMs === null ? '-' : `${item.durationMs} ms`),
    },
    {
      key: 'requestId',
      title: t('ai.usage.columns.requestId'),
      render: (_, item) => (
        <Typography.Text copyable ellipsis className="max-w-52 text-xs">
          {item.requestId}
        </Typography.Text>
      ),
    },
    {
      key: 'actions',
      title: t('common.actions'),
      width: 72,
      fixed: 'right',
      render: (_, item) => (
        <Tooltip title={t('ai.usage.viewDetail')}>
          <Button
            type="text"
            size="small"
            aria-label={`${t('ai.usage.viewDetail')}: ${item.requestId}`}
            icon={<Eye className="size-4" />}
            onClick={() => setSelectedCallId(item.id)}
          />
        </Tooltip>
      ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-2">
        <AdminPageHeader title={t('ai.usage.title')} description={t('ai.usage.description')} />
        <PageToolbar
          summaryItems={[{ label: t('ai.usage.summary.total'), value: callsQuery.data?.total ?? 0 }]}
          filters={
            <Form form={form} layout="inline" onFinish={applyFilters} className="flex flex-wrap gap-y-3">
              <Form.Item name="userId" className="m-0 w-full sm:w-auto">
                <Input allowClear className="w-full sm:w-56" placeholder={t('ai.usage.filters.userId')} />
              </Form.Item>
              <Form.Item name="providerId" className="m-0 w-full sm:w-auto">
                <Input allowClear className="w-full sm:w-56" placeholder={t('ai.usage.filters.providerId')} />
              </Form.Item>
              <Form.Item name="modelId" className="m-0 w-full sm:w-auto">
                <Input allowClear className="w-full sm:w-56" placeholder={t('ai.usage.filters.modelId')} />
              </Form.Item>
              <Form.Item name="result" className="m-0 w-full sm:w-auto">
                <Select
                  allowClear
                  className="w-full sm:w-52"
                  placeholder={t('ai.usage.filters.result')}
                  options={Object.keys(resultColors).map((value) => ({ value, label: t(`ai.usage.results.${value}`) }))}
                />
              </Form.Item>
              <Form.Item name="requestId" className="m-0 w-full sm:w-auto">
                <Input allowClear className="w-full sm:w-56" placeholder={t('ai.usage.filters.requestId')} />
              </Form.Item>
              <Form.Item name="timeRange" className="m-0 w-full sm:w-auto">
                <DatePicker.RangePicker showTime className="w-full sm:w-80" />
              </Form.Item>
              <Form.Item className="m-0">
                <Button type="primary" htmlType="submit" icon={<Search className="size-4" />}>
                  {t('ai.usage.filters.apply')}
                </Button>
              </Form.Item>
              <Form.Item className="m-0">
                <Button icon={<RotateCcw className="size-4" />} onClick={clearFilters}>
                  {t('ai.usage.filters.clear')}
                </Button>
              </Form.Item>
            </Form>
          }
        />
      </div>
      {callsQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('ai.usage.loadFailed')}
          action={<Button onClick={() => void callsQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}
      <section className="flex min-h-0 flex-1 flex-col">
        <Table<AiModelCallAudit>
          rowKey="id"
          className="guide-table-fill min-h-64"
          columns={columns}
          dataSource={callsQuery.data?.items ?? []}
          loading={callsQuery.isLoading}
          locale={{ emptyText: t('ai.usage.empty') }}
          scroll={{ x: 'max-content', y: '100%' }}
          onRow={(item) => ({ onClick: () => setSelectedCallId(item.id), className: 'cursor-pointer' })}
          pagination={{
            current: query.page,
            pageSize: query.pageSize,
            total: callsQuery.data?.total ?? 0,
            showSizeChanger: true,
            onChange: (page, pageSize) => setQuery((previous) => ({ ...previous, page, pageSize })),
          }}
        />
      </section>
      <Drawer
        open={selectedCallId !== null}
        onClose={() => setSelectedCallId(null)}
        title={t('ai.usage.detail.title')}
        width={520}
      >
        {detailQuery.isLoading ? <Typography.Text>{t('common.loading')}</Typography.Text> : null}
        {detailQuery.data ? <UsageDetail item={detailQuery.data} /> : null}
        {detailQuery.error ? <Alert type="error" showIcon message={t('ai.usage.loadFailed')} /> : null}
      </Drawer>
    </div>
  )
}

function UsageDetail({ item }: { item: AiModelCallAuditDetail | undefined }) {
  const { t } = useTranslation()
  if (!item) return null
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-fg-muted">{t('ai.usage.columns.requestId')}</dt>
        <dd className="break-all">{item.requestId}</dd>
        <dt className="text-fg-muted">{t('ai.usage.columns.userId')}</dt>
        <dd className="break-all">{item.userId}</dd>
        <dt className="text-fg-muted">{t('ai.usage.columns.tokens')}</dt>
        <dd>{item.usage.totalTokens ?? '-'}</dd>
        <dt className="text-fg-muted">{t('ai.usage.columns.cost')}</dt>
        <dd>{item.cost?.total ?? '-'}</dd>
        <dt className="text-fg-muted">{t('ai.usage.columns.error')}</dt>
        <dd className="break-all">{item.errorCode ?? '-'}</dd>
      </dl>
      <Typography.Title level={5}>{t('ai.usage.detail.tools')}</Typography.Title>
      {item.toolExecutions.length === 0 ? (
        <Typography.Text type="secondary">{t('ai.usage.detail.noTools')}</Typography.Text>
      ) : (
        item.toolExecutions.map((tool) => (
          <div key={tool.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
            <span className="break-all">
              {tool.toolVersion ? `${tool.toolName}@${tool.toolVersion}` : tool.toolName}
            </span>
            <Tag>{tool.status}</Tag>
          </div>
        ))
      )}
    </div>
  )
}
