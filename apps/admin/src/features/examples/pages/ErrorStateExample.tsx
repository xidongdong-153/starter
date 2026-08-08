import { ErrorStatePage } from '@admin/components/ui'
import { useNavigate } from '@tanstack/react-router'
import { Button } from 'antd'
import { AlertTriangle, House, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function ErrorStateExample() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [retryCount, setRetryCount] = useState(1)

  return (
    <ErrorStatePage
      embedded
      eyebrow={t('example.errorState.eyebrow')}
      icon={<AlertTriangle className="size-5" />}
      title={t('example.errorState.title')}
      description={t('example.errorState.description')}
      note={t('example.errorState.note', { count: retryCount })}
      actions={
        <>
          <Button
            type="primary"
            icon={<RefreshCw className="size-4" />}
            onClick={() => setRetryCount((count) => count + 1)}
          >
            {t('common.retry')}
          </Button>
          <Button icon={<House className="size-4" />} onClick={() => void navigate({ to: '/' })}>
            {t('common.home')}
          </Button>
        </>
      }
      detailDescription={t('example.errorState.detailDescription')}
      detailItems={[
        { content: 'ApplicationError', label: t('example.errorState.detailName') },
        { content: t('example.errorState.mockMessage'), label: t('example.errorState.detailMessage') },
        {
          content: (
            <pre className="text-fg-muted max-h-48 overflow-auto text-xs leading-6 whitespace-pre-wrap break-words">
              {`at ErrorStateExample (/features/examples/pages/ErrorStateExample.tsx)
at RouteComponent (/app/router/routes.tsx)
at RootLayout (/layout/RootLayout.tsx)`}
            </pre>
          ),
          label: t('example.errorState.detailStack'),
        },
      ]}
    />
  )
}
