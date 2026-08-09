import { apiBaseUrl } from '@admin/api/client'
import { useProfileQuery } from '@admin/api/profile'
import { useSystemHealthQuery } from '@admin/api/system'
import { AdminPageHeader, PermissionGuard } from '@admin/components/common'
import { PermissionKeys } from '@starter/contracts'
import { Link } from '@tanstack/react-router'
import { Button, Tag } from 'antd'
import { ArrowRight, Files, RefreshCw, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function Home() {
  const { t } = useTranslation()
  const healthQuery = useSystemHealthQuery()
  const profileQuery = useProfileQuery()

  const statusLabel = healthQuery.isLoading
    ? t('home.api.status.loading')
    : healthQuery.data?.ok
      ? t('home.api.status.connected')
      : t('home.api.status.failed')
  const statusColor = healthQuery.isLoading ? 'processing' : healthQuery.data?.ok ? 'success' : 'error'

  const entries = [
    {
      description: t('home.entries.profileDescription'),
      icon: <UserRound size={18} />,
      to: '/settings/profile' as const,
      title: t('home.entries.profile'),
    },
  ]

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={t('home.title')}
        description={t('home.description')}
        summaryItems={[
          {
            label: t('home.summary.account'),
            value: profileQuery.data?.name ?? '-',
          },
          {
            label: t('home.summary.framework'),
            value: t('home.summary.frameworkValue'),
          },
        ]}
      />

      <section className="border-border-subtle bg-surface rounded-lg border">
        <div className="border-border-subtle border-b px-5 py-4">
          <div className="text-fg text-sm font-medium">{t('home.entries.title')}</div>
        </div>
        <div className="divide-border-subtle grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
          {entries.map((entry) => (
            <Link
              key={entry.to}
              to={entry.to as never}
              className="hover:bg-surface-muted/60 flex items-start justify-between gap-4 px-5 py-4 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-fg flex items-center gap-2 text-sm font-medium">
                  {entry.icon}
                  {entry.title}
                </div>
                <p className="text-fg-muted mt-2 text-sm leading-6">{entry.description}</p>
              </div>
              <ArrowRight className="text-fg-muted mt-1 size-4 shrink-0" />
            </Link>
          ))}
          <PermissionGuard permission={PermissionKeys.FILE_LIST}>
            <Link
              to={'/files' as never}
              className="hover:bg-surface-muted/60 flex items-start justify-between gap-4 px-5 py-4 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-fg flex items-center gap-2 text-sm font-medium">
                  <Files size={18} />
                  {t('home.entries.files')}
                </div>
                <p className="text-fg-muted mt-2 text-sm leading-6">{t('home.entries.filesDescription')}</p>
              </div>
              <ArrowRight className="text-fg-muted mt-1 size-4 shrink-0" />
            </Link>
          </PermissionGuard>
        </div>
      </section>

      <section className="border-border-subtle bg-surface rounded-lg border">
        <div className="border-border-subtle flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-fg text-sm font-medium">{t('home.api.title')}</div>
            <p className="text-fg-muted mt-1 text-sm">{t('home.api.description')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tag color={statusColor}>{statusLabel}</Tag>
            <Button
              icon={<RefreshCw size={15} />}
              loading={healthQuery.isFetching}
              onClick={() => void healthQuery.refetch()}
              size="small"
            >
              {t('common.refresh')}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div>
            <div className="text-fg-muted text-xs">{t('home.api.baseUrl')}</div>
            <div className="text-fg mt-1 text-sm break-all">{apiBaseUrl}</div>
          </div>
          <div>
            <div className="text-fg-muted text-xs">{t('home.api.method')}</div>
            <div className="text-fg mt-1 text-sm">GET /health</div>
          </div>
        </div>
      </section>
    </div>
  )
}
