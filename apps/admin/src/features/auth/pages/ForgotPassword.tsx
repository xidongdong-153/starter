import type { RequestPasswordResetInput } from '@admin/api/auth'

import { useRequestPasswordResetMutation } from '@admin/api/auth'
import { Link } from '@tanstack/react-router'
import { Alert, Button, Form, Input } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthContainer } from '../components/AuthContainer'

export function ForgotPassword() {
  const { t } = useTranslation()
  const requestResetMutation = useRequestPasswordResetMutation()
  const [submitted, setSubmitted] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (values: RequestPasswordResetInput) => {
    setErrorMessage(null)

    try {
      await requestResetMutation.mutateAsync(values)
      setSubmitted(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('auth.forgotPasswordFailed'))
    }
  }

  return (
    <AuthContainer>
      <div className="mb-8 text-center">
        <h1 className="text-fg mb-2 text-2xl font-semibold">{t('auth.forgotPasswordTitle')}</h1>
        <p className="text-fg-muted text-sm">{t('auth.forgotPasswordDescription')}</p>
      </div>

      {submitted ? (
        <Alert
          showIcon
          type="success"
          className="border-border-subtle bg-surface-muted/60 mb-6 rounded-lg"
          message={t('auth.forgotPasswordSentTitle')}
          description={t('auth.forgotPasswordSentDescription')}
        />
      ) : null}

      {!submitted && errorMessage ? (
        <Alert
          showIcon
          type="error"
          className="border-border-subtle bg-surface-muted/60 mb-6 rounded-lg"
          message={t('auth.forgotPasswordErrorTitle')}
          description={errorMessage}
        />
      ) : null}

      {!submitted ? (
        <Form<RequestPasswordResetInput> name="forgot-password" layout="vertical" size="large" onFinish={handleSubmit}>
          <Form.Item
            label={t('auth.email')}
            name="email"
            rules={[
              { message: t('auth.emailRequired'), required: true },
              { message: t('auth.emailInvalid'), type: 'email' },
            ]}
          >
            <Input placeholder={t('auth.emailPlaceholder')} autoComplete="email" className="rounded-lg" />
          </Form.Item>

          <Form.Item className="mb-0 pt-2">
            <Button
              type="primary"
              htmlType="submit"
              loading={requestResetMutation.isPending}
              className="h-11 w-full rounded-lg font-medium"
            >
              {t('auth.forgotPasswordAction')}
            </Button>
          </Form.Item>
        </Form>
      ) : null}

      <p className="text-fg-muted mt-6 text-center text-sm">
        <Link to={'/login' as never} className="hover:text-primary transition-colors">
          {t('auth.goSignIn')}
        </Link>
      </p>
    </AuthContainer>
  )
}
