import { ErrorStatePage } from '@admin/components/ui'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button } from 'antd'
import { ArrowLeft, House, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ForbiddenExample() {
  const navigate = useNavigate()
  const router = useRouter()
  const { t } = useTranslation()

  return (
    <ErrorStatePage
      embedded
      eyebrow={t('example.forbidden.eyebrow')}
      icon={<Lock className="size-5" />}
      title={t('example.forbidden.title')}
      description={t('example.forbidden.description')}
      note={t('example.forbidden.note')}
      actions={
        <>
          <Button type="primary" icon={<House className="size-4" />} onClick={() => void navigate({ to: '/' })}>
            {t('common.home')}
          </Button>
          <Button icon={<ArrowLeft className="size-4" />} onClick={() => router.history.back()}>
            {t('common.back')}
          </Button>
        </>
      }
    />
  )
}
