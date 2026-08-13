import { useVerifyEmailMutation } from '@admin/api/auth'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Alert, Button, Spin } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthContainer } from '../components/AuthContainer'

export function VerifyEmail() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const token = new URLSearchParams(location.search).get('token') ?? undefined
  const verifyEmailMutation = useVerifyEmailMutation()
  const [state, setState] = useState<'pending' | 'success' | 'error'>('pending')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    if (!token) {
      setState('error')
      setErrorMessage(t('auth.verifyEmailMissingToken'))
      return
    }

    startedRef.current = true
    verifyEmailMutation.mutate(token, {
      onSuccess: () => setState('success'),
      onError: (error) => {
        setState('error')
        setErrorMessage(error instanceof Error ? error.message : t('auth.verifyEmailFailed'))
      },
    })
  }, [token, t, verifyEmailMutation])

  useEffect(() => {
    if (state !== 'success') return

    const timer = window.setTimeout(() => {
      void navigate({ replace: true, to: '/login' as never })
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [navigate, state])

  return (
    <AuthContainer>
      <div className="mb-8 text-center">
        <h1 className="text-fg mb-2 text-2xl font-semibold">{t('auth.verifyEmailTitle')}</h1>
      </div>

      {state === 'pending' ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <Spin />
          <p className="text-fg-muted text-sm">{t('auth.verifyEmailPending')}</p>
        </div>
      ) : null}

      {state === 'success' ? (
        <Alert
          showIcon
          type="success"
          className="border-border-subtle bg-surface-muted/60 mb-6 rounded-lg"
          message={t('auth.verifyEmailSuccessTitle')}
          description={t('auth.verifyEmailSuccessDescription')}
        />
      ) : null}

      {state === 'error' ? (
        <Alert
          showIcon
          type="error"
          className="border-border-subtle bg-surface-muted/60 mb-6 rounded-lg"
          message={t('auth.verifyEmailErrorTitle')}
          description={errorMessage}
        />
      ) : null}

      {state !== 'pending' ? (
        <Button
          type="primary"
          block
          className="h-11 rounded-lg font-medium"
          onClick={() => void navigate({ replace: true, to: '/login' as never })}
        >
          {t('auth.goSignIn')}
        </Button>
      ) : null}
    </AuthContainer>
  )
}
