import type { ResetPasswordInput } from '@admin/api/auth'

import { useResetPasswordMutation } from '@admin/api/auth'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { Alert, App as AntdApp, Button, Form, Input } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthContainer } from '../components/AuthContainer'

export function ResetPassword() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { message } = AntdApp.useApp()
  const token = new URLSearchParams(location.search).get('token') ?? undefined
  const resetPasswordMutation = useResetPasswordMutation()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleReset = async (values: { newPassword: string }) => {
    if (!token) {
      setErrorMessage(t('auth.resetPasswordMissingToken'))
      return
    }

    setErrorMessage(null)

    try {
      const input: ResetPasswordInput = { newPassword: values.newPassword, token }
      await resetPasswordMutation.mutateAsync(input)
      message.success(t('auth.resetPasswordSuccess'))
      await navigate({ replace: true, to: '/login' as never })
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : t('auth.resetPasswordFailed')
      setErrorMessage(nextErrorMessage)
      message.error(nextErrorMessage)
    }
  }

  return (
    <AuthContainer>
      <div className="mb-8 text-center">
        <h1 className="text-fg mb-2 text-2xl font-semibold">{t('auth.resetPasswordTitle')}</h1>
        <p className="text-fg-muted text-sm">{t('auth.resetPasswordDescription')}</p>
      </div>

      {!token ? (
        <Alert
          showIcon
          type="error"
          className="border-border-subtle bg-surface-muted/60 mb-6 rounded-lg"
          message={t('auth.resetPasswordMissingToken')}
        />
      ) : null}

      {errorMessage ? (
        <Alert
          showIcon
          type="error"
          className="border-border-subtle bg-surface-muted/60 mb-6 rounded-lg"
          message={t('auth.resetPasswordErrorTitle')}
          description={errorMessage}
        />
      ) : null}

      {token ? (
        <Form<{ newPassword: string }> name="reset-password" layout="vertical" size="large" onFinish={handleReset}>
          <Form.Item
            label={t('auth.newPassword')}
            name="newPassword"
            rules={[
              { message: t('auth.passwordRequired'), required: true },
              { message: t('auth.passwordMin'), min: 8 },
            ]}
          >
            <Input.Password
              placeholder={t('auth.newPasswordPlaceholder')}
              autoComplete="new-password"
              className="rounded-lg"
            />
          </Form.Item>

          <Form.Item
            label={t('auth.confirmPassword')}
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              { message: t('auth.passwordRequired'), required: true },
              ({ getFieldValue }) => ({
                validator(_, value: string) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error(t('auth.confirmPasswordMismatch')))
                },
              }),
            ]}
          >
            <Input.Password
              placeholder={t('auth.confirmPasswordPlaceholder')}
              autoComplete="new-password"
              className="rounded-lg"
            />
          </Form.Item>

          <Form.Item className="mb-0 pt-2">
            <Button
              type="primary"
              htmlType="submit"
              loading={resetPasswordMutation.isPending}
              className="h-11 w-full rounded-lg font-medium"
            >
              {t('auth.resetPasswordAction')}
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
