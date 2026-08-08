import type { TableProps } from 'antd'
import type { ReactNode } from 'react'

import { AdminPageHeader } from '@admin/components/common'
import { Alert, Button, DatePicker, Input, Progress, Select, Slider, Switch, Table, Tabs, Tag } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const { RangePicker } = DatePicker

interface ShowcaseRow {
  key: string
  name: string
  owner: string
  status: 'enabled' | 'paused' | 'pending'
}

interface ShowcasePanelProps {
  children: ReactNode
  description: string
  title: string
}

function ShowcasePanel({ children, description, title }: ShowcasePanelProps) {
  return (
    <section className="border-border-subtle bg-surface-muted/60 rounded-lg border p-5">
      <div className="mb-4">
        <h2 className="text-fg text-base font-semibold">{title}</h2>
        <p className="text-fg-muted mt-1 text-sm leading-6">{description}</p>
      </div>
      {children}
    </section>
  )
}

export function UiShowcase() {
  const { i18n, t } = useTranslation()
  const [sliderValue, setSliderValue] = useState(36)
  const [switchValue, setSwitchValue] = useState(true)

  const columns: TableProps<ShowcaseRow>['columns'] = [
    {
      dataIndex: 'name',
      key: 'name',
      title: t('example.ui.table.name'),
    },
    {
      dataIndex: 'owner',
      key: 'owner',
      title: t('example.ui.table.owner'),
    },
    {
      dataIndex: 'status',
      key: 'status',
      title: t('example.ui.table.status'),
      render: (status: ShowcaseRow['status']) => {
        const config = {
          enabled: { color: 'success', label: t('example.ui.status.enabled') },
          paused: { color: 'error', label: t('example.ui.status.paused') },
          pending: { color: 'warning', label: t('example.ui.status.pending') },
        }[status]

        return <Tag color={config.color}>{config.label}</Tag>
      },
    },
  ]

  const rows: ShowcaseRow[] = [
    { key: '1', name: t('example.ui.table.rowTheme'), owner: t('example.ui.table.ownerDesign'), status: 'enabled' },
    { key: '2', name: t('example.ui.table.rowLayout'), owner: t('example.ui.table.ownerFrontend'), status: 'pending' },
    { key: '3', name: t('example.ui.table.rowError'), owner: t('example.ui.table.ownerOps'), status: 'paused' },
  ]

  const updatedAt = new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-US' : 'zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date())

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t('example.ui.title')}
        description={t('example.ui.description')}
        summaryItems={[
          { label: t('example.ui.summary.status'), value: t('example.ui.summary.ready') },
          { label: t('example.ui.summary.updatedAt'), value: updatedAt },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <ShowcasePanel title={t('example.ui.form.title')} description={t('example.ui.form.description')}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <Input placeholder={t('example.ui.form.searchPlaceholder')} autoComplete="off" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  defaultValue="enabled"
                  options={[
                    { label: t('example.ui.status.enabled'), value: 'enabled' },
                    { label: t('example.ui.status.pending'), value: 'pending' },
                    { label: t('example.ui.status.paused'), value: 'paused' },
                  ]}
                />
                <DatePicker className="w-full" />
              </div>
              <Input.TextArea placeholder={t('example.ui.form.textareaPlaceholder')} rows={3} autoComplete="off" />
              <RangePicker className="w-full" />
            </div>

            <div className="border-border-subtle bg-overlay-0/20 rounded-lg border p-4">
              <div className="flex flex-wrap gap-2">
                <Button type="primary">{t('example.ui.actions.primary')}</Button>
                <Button>{t('example.ui.actions.default')}</Button>
                <Button type="dashed">{t('example.ui.actions.dashed')}</Button>
              </div>
              <div className="mt-5 space-y-4">
                <Slider value={sliderValue} onChange={setSliderValue} />
                <div className="flex items-center gap-3">
                  <Switch checked={switchValue} onChange={setSwitchValue} />
                  <span className="text-fg text-sm">
                    {switchValue ? t('example.ui.actions.enabled') : t('example.ui.actions.disabled')}
                  </span>
                </div>
                <Progress percent={sliderValue} showInfo={false} strokeColor="var(--color-primary)" />
              </div>
            </div>
          </div>
        </ShowcasePanel>

        <ShowcasePanel title={t('example.ui.surface.title')} description={t('example.ui.surface.description')}>
          <div className="grid gap-3">
            {[
              { className: 'bg-surface', label: 'surface' },
              { className: 'bg-surface-muted', label: 'surface-muted' },
              { className: 'bg-surface-subtle', label: 'surface-subtle' },
            ].map((item) => (
              <div key={item.label} className={`${item.className} border-border-subtle rounded-lg border px-4 py-3`}>
                <div className="text-fg text-sm font-medium">{item.label}</div>
                <p className="text-fg-muted mt-1 text-xs">{t('example.ui.surface.itemDescription')}</p>
              </div>
            ))}
          </div>
        </ShowcasePanel>
      </div>

      <ShowcasePanel title={t('example.ui.data.title')} description={t('example.ui.data.description')}>
        <Table columns={columns} dataSource={rows} pagination={false} scroll={{ x: 'max-content' }} />
      </ShowcasePanel>

      <div className="grid gap-6 xl:grid-cols-2">
        <ShowcasePanel title={t('example.ui.tabs.title')} description={t('example.ui.tabs.description')}>
          <Tabs
            defaultActiveKey="layout"
            items={[
              {
                children: (
                  <div className="border-border-subtle bg-overlay-0/20 text-fg-muted rounded-lg border p-4 text-sm">
                    {t('example.ui.tabs.layoutContent')}
                  </div>
                ),
                key: 'layout',
                label: t('example.ui.tabs.layout'),
              },
              {
                children: (
                  <div className="border-border-subtle bg-overlay-0/20 text-fg-muted rounded-lg border p-4 text-sm">
                    {t('example.ui.tabs.copyContent')}
                  </div>
                ),
                key: 'copy',
                label: t('example.ui.tabs.copy'),
              },
            ]}
          />
        </ShowcasePanel>

        <ShowcasePanel title={t('example.ui.feedback.title')} description={t('example.ui.feedback.description')}>
          <div className="space-y-3">
            <Alert type="success" description={t('example.ui.feedback.success')} showIcon />
            <Alert type="info" description={t('example.ui.feedback.info')} showIcon />
            <Alert type="warning" description={t('example.ui.feedback.warning')} showIcon />
            <Alert type="error" description={t('example.ui.feedback.error')} showIcon />
          </div>
        </ShowcasePanel>
      </div>
    </div>
  )
}
