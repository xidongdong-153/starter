import { ErrorStatePage } from '@admin/components/ui'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button } from 'antd'
import { ArrowLeft, House, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * 404 页面
 */
export function NotFound() {
  const navigate = useNavigate()
  const router = useRouter()
  const { t } = useTranslation()

  return (
    <ErrorStatePage
      eyebrow={t('example.notFound.eyebrow')}
      icon={<Search className="size-5" />}
      title={t('example.notFound.title')}
      description={t('example.notFound.description')}
      note={t('example.notFound.note')}
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
      patternDuration={8}
    />
  )
}
