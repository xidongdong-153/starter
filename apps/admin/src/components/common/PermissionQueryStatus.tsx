import type { ReactNode } from 'react'

import { Alert, Button, Spin, Tooltip } from 'antd'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PermissionQueryStatusProps {
  compact?: boolean
  isError: boolean
  isLoading: boolean
  onRetry: () => void
}

export function PermissionQueryStatus({
  compact = false,
  isError,
  isLoading,
  onRetry,
}: PermissionQueryStatusProps): ReactNode {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="flex min-h-12 items-center justify-center px-3 py-2">
        <Spin size="small" />
      </div>
    )
  }

  if (!isError) {
    return null
  }

  const retryButton = (
    <Button
      aria-label={t('authorization.permissions.retry')}
      icon={<RefreshCw className="size-4" />}
      onClick={onRetry}
      size="small"
      type="text"
    >
      {compact ? null : t('common.retry')}
    </Button>
  )

  return compact ? (
    <div className="flex justify-center px-2 py-2">
      <Tooltip title={t('authorization.permissions.loadFailed')}>{retryButton}</Tooltip>
    </div>
  ) : (
    <div className="px-3 py-2">
      <Alert action={retryButton} message={t('authorization.permissions.loadFailed')} showIcon type="error" />
    </div>
  )
}
