import type { SignInEmailInput } from '@admin/api/auth'

import { useSignInEmailMutation } from '@admin/api/auth'
import { Link, useNavigate } from '@tanstack/react-router'
import { Alert, App as AntdApp, Button, Form, Input } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthContainer } from '../components/AuthContainer'
import { SocialSignInButtons } from '../components/SocialSignInButtons'

export function Login() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const signInMutation = useSignInEmailMutation()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleLogin = async (values: SignInEmailInput) => {
    setErrorMessage(null)

    try {
      await signInMutation.mutateAsync(values)
      message.success(t('auth.loginSuccess'))
      await navigate({ replace: true, to: '/' })
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : t('auth.loginFailed')
      setErrorMessage(nextErrorMessage)
      message.error(nextErrorMessage)
    }
  }

  return (
    <AuthContainer>
      <div className="mb-8 text-center">
        <h1 className="text-fg mb-2 text-2xl font-semibold">{t('auth.loginTitle')}</h1>
        <p className="text-fg-muted text-sm">{t('auth.loginDescription')}</p>
      </div>

      {errorMessage ? (
        <Alert
          showIcon
          type="error"
          className="border-border-subtle bg-surface-muted/60 mb-6 rounded-lg"
          message={t('auth.loginErrorTitle')}
          description={errorMessage}
        />
      ) : null}

      <Form<SignInEmailInput> name="login" layout="vertical" size="large" onFinish={handleLogin}>
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

        <Form.Item
          label={t('auth.password')}
          name="password"
          rules={[{ message: t('auth.passwordRequired'), required: true }]}
        >
          <Input.Password
            placeholder={t('auth.passwordPlaceholder')}
            autoComplete="current-password"
            className="rounded-lg"
          />
        </Form.Item>

        <Form.Item className="mb-0 pt-2">
          <Button
            type="primary"
            htmlType="submit"
            loading={signInMutation.isPending}
            className="h-11 w-full rounded-lg font-medium"
          >
            {t('auth.loginAction')}
          </Button>
        </Form.Item>
      </Form>

      <div className="text-fg-muted mt-3 text-center text-sm">
        <Link to={'/forgot-password' as never} className="hover:text-primary transition-colors">
          {t('auth.forgotPasswordLink')}
        </Link>
      </div>

      <SocialSignInButtons onError={setErrorMessage} />

      <p className="text-fg-muted mt-6 text-center text-sm">
        <Link to={'/register' as never} className="hover:text-primary transition-colors">
          {t('auth.goRegister')}
        </Link>
      </p>
    </AuthContainer>
  )
}
