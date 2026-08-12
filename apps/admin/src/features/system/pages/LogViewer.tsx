import type { SystemLogEntry, SystemLogLevel } from '@starter/contracts'
import type { TableProps } from 'antd'

import { useSystemLogsByRequestIdQuery, useSystemLogsQuery } from '@admin/api/system'
import { AdminPageHeader } from '@admin/components/common'

import { Alert, Button, Drawer, Form, Input, Select, Table, Tag, Typography } from 'antd'
import { GitBranch, RotateCcw, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface LogFilterValues {
  requestId?: string
  level?: SystemLogLevel
  query?: string
}

const LEVEL_NUMBERS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
}

function resolveLevel(value: unknown): string | undefined {
  if (typeof value === 'number') return LEVEL_NUMBERS[value]
  if (typeof value === 'string') return value
  return undefined
}

function levelColor(level: string | undefined): string | undefined {
  if (level === 'error' || level === 'fatal') return 'red'
  if (level === 'warn') return 'orange'
  if (level === 'info') return 'blue'
  return undefined
}

function formatTime(value: unknown): string {
  return typeof value === 'number' ? new Date(value).toLocaleString() : '-'
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '-'
}

function durationText(value: unknown): string {
  return typeof value === 'number' ? `${value} ms` : '-'
}

function RequestChainDrawer({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const chainQuery = useSystemLogsByRequestIdQuery(requestId)

  return (
    <Drawer title={t('systemLogs.drawer.title')} width={720} onClose={onClose} open>
      <div className="mb-3">
        <Typography.Text copyable className="break-all text-sm">
          {requestId}
        </Typography.Text>
      </div>
      {chainQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('systemLogs.loadFailed')}
          description={chainQuery.error instanceof Error ? chainQuery.error.message : undefined}
          action={<Button onClick={() => void chainQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}
      <div className="space-y-2">
        {(chainQuery.data?.items ?? []).map((entry, index) => (
          <div key={index} className="border-border-subtle bg-surface-muted rounded-lg border p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-fg-muted">{formatTime(entry.time)}</span>
              <Tag className="m-0" color={levelColor(resolveLevel(entry.level))}>
                {resolveLevel(entry.level) ?? '-'}
              </Tag>
              {typeof entry.event === 'string' ? <span className="break-all">{entry.event}</span> : null}
            </div>
            <div className="text-fg-muted mb-1 break-all text-sm">{textOf(entry.msg)}</div>
            <pre className="text-fg-muted max-h-48 overflow-auto rounded bg-black/10 p-2 text-xs">
              {JSON.stringify(entry, null, 2)}
            </pre>
          </div>
        ))}
        {!chainQuery.isLoading && chainQuery.data?.items.length === 0 ? (
          <div className="text-fg-muted text-sm">{t('systemLogs.empty')}</div>
        ) : null}
      </div>
    </Drawer>
  )
}

export function LogViewer() {
  const { t } = useTranslation()
  const [filterForm] = Form.useForm<LogFilterValues>()
  const [filters, setFilters] = useState<Omit<LogFilterValues, 'level'> & { level?: SystemLogLevel }>({})
  const [chainRequestId, setChainRequestId] = useState<string | null>(null)
  const logsQuery = useSystemLogsQuery(filters)

  const applyFilters = (values: LogFilterValues) => {
    setFilters({
      requestId: values.requestId?.trim() || undefined,
      level: values.level,
      query: values.query?.trim() || undefined,
    })
  }

  const clearFilters = () => {
    filterForm.resetFields()
    setFilters({})
  }

  const items = logsQuery.data?.pages.flatMap((page) => page.items) ?? []

  const columns: TableProps<SystemLogEntry>['columns'] = [
    {
      key: 'time',
      title: t('systemLogs.columns.time'),
      render: (_, entry) => (
        <span className="text-fg-muted min-w-40 whitespace-nowrap text-sm">{formatTime(entry.time)}</span>
      ),
    },
    {
      key: 'level',
      title: t('systemLogs.columns.level'),
      width: 90,
      render: (_, entry) => {
        const level = resolveLevel(entry.level)
        return (
          <Tag className="m-0" color={levelColor(level)}>
            {level ?? '-'}
          </Tag>
        )
      },
    },
    {
      key: 'event',
      title: t('systemLogs.columns.event'),
      render: (_, entry) => (
        <span className="text-sm break-all">{typeof entry.event === 'string' ? entry.event : '-'}</span>
      ),
    },
    {
      key: 'message',
      title: t('systemLogs.columns.message'),
      render: (_, entry) => <span className="text-fg-muted text-sm break-all">{textOf(entry.msg)}</span>,
    },
    {
      key: 'requestId',
      title: t('systemLogs.columns.requestId'),
      render: (_, entry) =>
        typeof entry.requestId === 'string' ? (
          <Typography.Text copyable ellipsis className="max-w-56 text-sm">
            {entry.requestId}
          </Typography.Text>
        ) : (
          <span className="text-fg-muted text-sm">-</span>
        ),
    },
    {
      key: 'userId',
      title: t('systemLogs.columns.userId'),
      render: (_, entry) =>
        typeof entry.userId === 'string' ? (
          <Typography.Text copyable ellipsis className="max-w-40 text-sm">
            {entry.userId}
          </Typography.Text>
        ) : (
          <span className="text-fg-muted text-sm">-</span>
        ),
    },
    {
      key: 'duration',
      title: t('systemLogs.columns.duration'),
      width: 110,
      render: (_, entry) => <span className="text-fg-muted text-sm">{durationText(entry.durationMs)}</span>,
    },
    {
      key: 'actions',
      title: t('systemLogs.columns.actions'),
      width: 100,
      render: (_, entry) =>
        typeof entry.requestId === 'string' ? (
          <Button
            size="small"
            type="link"
            icon={<GitBranch className="size-4" />}
            onClick={() => setChainRequestId(entry.requestId as string)}
          >
            {t('systemLogs.link')}
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t('systemLogs.title')}
        description={t('systemLogs.description')}
        summaryItems={[{ label: t('systemLogs.summary.loaded'), value: items.length }]}
      />

      {logsQuery.error ? (
        <Alert
          showIcon
          type="error"
          message={t('systemLogs.loadFailed')}
          description={logsQuery.error instanceof Error ? logsQuery.error.message : undefined}
          action={<Button onClick={() => void logsQuery.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}

      <Form form={filterForm} layout="inline" onFinish={applyFilters} className="flex flex-wrap gap-y-3">
        <Form.Item name="requestId" className="m-0 w-full sm:w-auto">
          <Input allowClear className="w-full sm:w-56" placeholder={t('systemLogs.filters.requestId')} />
        </Form.Item>
        <Form.Item name="level" className="m-0 w-full sm:w-auto">
          <Select
            allowClear
            className="w-full sm:w-36"
            placeholder={t('systemLogs.filters.level')}
            options={[
              { label: 'info', value: 'info' },
              { label: 'warn', value: 'warn' },
              { label: 'error', value: 'error' },
            ]}
          />
        </Form.Item>
        <Form.Item name="query" className="m-0 w-full sm:w-auto">
          <Input allowClear className="w-full sm:w-56" placeholder={t('systemLogs.filters.query')} />
        </Form.Item>
        <Form.Item className="m-0">
          <Button type="primary" htmlType="submit" icon={<Search className="size-4" />}>
            {t('systemLogs.filters.apply')}
          </Button>
        </Form.Item>
        <Form.Item className="m-0">
          <Button icon={<RotateCcw className="size-4" />} onClick={clearFilters}>
            {t('systemLogs.filters.clear')}
          </Button>
        </Form.Item>
      </Form>

      <section className="min-w-0">
        <Table<SystemLogEntry>
          rowKey={(entry, index) =>
            `${String(entry.time ?? 0)}-${String(entry.requestId ?? '')}-${String(entry.msg ?? '')}-${index ?? 0}`
          }
          columns={columns}
          dataSource={items}
          loading={logsQuery.isLoading}
          locale={{ emptyText: t('systemLogs.empty') }}
          scroll={{ x: 'max-content' }}
          pagination={false}
          expandable={{
            expandedRowRender: (entry) => (
              <pre className="text-fg-muted max-h-80 overflow-auto rounded bg-black/10 p-3 text-xs">
                {JSON.stringify(entry, null, 2)}
              </pre>
            ),
          }}
        />
        <div className="mt-4 flex justify-center">
          <Button
            onClick={() => void logsQuery.fetchNextPage()}
            disabled={!logsQuery.hasNextPage || logsQuery.isFetchingNextPage}
          >
            {logsQuery.isFetchingNextPage ? t('systemLogs.loading') : t('systemLogs.loadMore')}
          </Button>
        </div>
      </section>

      {chainRequestId ? (
        <RequestChainDrawer requestId={chainRequestId} onClose={() => setChainRequestId(null)} />
      ) : null}
    </div>
  )
}
