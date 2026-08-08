import type { SignUpEmailInput } from '@admin/api/auth'

import { useSignUpEmailMutation } from '@admin/api/auth'
import { Link, useNavigate } from '@tanstack/react-router'
import { Alert, App as AntdApp, Button, Form, Input } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthContainer } from '../components/AuthContainer'

export function Register() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const signUpMutation = useSignUpEmailMutation()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleRegister = async (values: SignUpEmailInput) => {
    setErrorMessage(null)

    try {
      await signUpMutation.mutateAsync(values)
      message.success(t('auth.registerSuccess'))
      await navigate({ replace: true, to: '/' })
    } catch (error) {
      const nextErrorMessage = error instanceof Error ? error.message : t('auth.registerFailed')
      setErrorMessage(nextErrorMessage)
      message.error(nextErrorMessage)
    }
  }

  return (
    <AuthContainer>
      <div className="mb-8 text-center">
        <h1 className="text-fg mb-2 text-2xl font-semibold">{t('auth.registerTitle')}</h1>
        <p className="text-fg-muted text-sm">{t('auth.registerDescription')}</p>
      </div>

      {errorMessage ? (
        <Alert
          showIcon
          type="error"
          className="border-border-subtle bg-surface-muted/60 mb-6 rounded-lg"
          message={t('auth.registerErrorTitle')}
          description={errorMessage}
        />
      ) : null}

      <Form<SignUpEmailInput> name="register" layout="vertical" size="large" onFinish={handleRegister}>
        <Form.Item
          label={t('auth.displayName')}
          name="name"
          rules={[{ message: t('auth.displayNameRequired'), required: true }]}
        >
          <Input placeholder={t('auth.displayNamePlaceholder')} autoComplete="name" className="rounded-lg" />
        </Form.Item>

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
          rules={[
            { message: t('auth.passwordRequired'), required: true },
            { message: t('auth.passwordMin'), min: 8 },
          ]}
        >
          <Input.Password
            placeholder={t('auth.passwordPlaceholder')}
            autoComplete="new-password"
            className="rounded-lg"
          />
        </Form.Item>

        <Form.Item className="mb-0 pt-2">
          <Button
            type="primary"
            htmlType="submit"
            loading={signUpMutation.isPending}
            className="h-11 w-full rounded-lg font-medium"
          >
            {t('auth.registerAction')}
          </Button>
        </Form.Item>
      </Form>

      <p className="text-fg-muted mt-6 text-center text-sm">
        <Link to={'/login' as never} className="hover:text-primary transition-colors">
          {t('auth.goSignIn')}
        </Link>
      </p>
    </AuthContainer>
  )
}
