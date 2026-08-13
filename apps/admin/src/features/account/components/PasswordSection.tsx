import type { AdminSessionUser, ChangePasswordInput } from '@admin/api/auth'

import { useChangePasswordMutation, useSendVerificationEmailMutation } from '@admin/api/auth'
import { App as AntdApp, Alert, Button, Form, Input, Switch, Tag } from 'antd'
import { KeyRound, MailCheck, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PasswordSectionProps {
  hasCredential: boolean
  user: AdminSessionUser
}

interface PasswordFormValues {
  currentPassword: string
  newPassword: string
  confirmPassword: string
  revokeOtherSessions: boolean
}

/**
 * 账号安全区块：邮箱验证状态 + 修改密码。
 * 只对邮箱密码账号有意义，社交登录账号也显示状态但不强制验证。
 */
export function PasswordSection({ hasCredential, user }: PasswordSectionProps) {
  const { t } = useTranslation()
  const { message } = AntdApp.useApp()
  const [form] = Form.useForm<PasswordFormValues>()
  const changePasswordMutation = useChangePasswordMutation()
  const sendVerificationEmailMutation = useSendVerificationEmailMutation()

  const handleChangePassword = async (values: PasswordFormValues) => {
    try {
      const input: ChangePasswordInput = {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: values.revokeOtherSessions,
      }
      await changePasswordMutation.mutateAsync(input)
      message.success(t('profile.changePasswordSuccess'))
      form.resetFields()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('profile.saveFailed'))
    }
  }

  const handleSendVerificationEmail = async () => {
    try {
      await sendVerificationEmailMutation.mutateAsync(user.email)
      message.success(t('profile.resendVerificationSent'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('profile.resendVerificationFailed'))
    }
  }

  return (
    <section className="border-border-subtle bg-surface rounded-lg border">
      <div className="border-border-subtle border-b px-5 py-4">
        <div className="text-fg text-sm font-medium">{t('profile.securityTitle')}</div>
        <p className="text-fg-muted mt-1 text-sm">{t('profile.securityDescription')}</p>
      </div>

      <div className="divide-border-subtle divide-y">
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <MailCheck className="size-4" />
              <span>{t('profile.emailVerified')}</span>
            </div>
            {user.emailVerified ? (
              <Tag color="success" className="m-0 w-fit">
                {t('profile.emailVerifiedYes')}
              </Tag>
            ) : (
              <Tag className="m-0 w-fit">{t('profile.emailVerifiedNo')}</Tag>
            )}
          </div>

          {!user.emailVerified ? (
            <div className="space-y-3">
              <Alert showIcon type="warning" message={t('profile.emailVerificationWarning')} />
              <Button
                icon={<Send className="size-4" />}
                loading={sendVerificationEmailMutation.isPending}
                onClick={() => void handleSendVerificationEmail()}
              >
                {t('profile.resendVerification')}
              </Button>
            </div>
          ) : null}
        </div>

        {hasCredential ? (
          <div className="px-5 py-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium">
              <KeyRound className="size-4" />
              <span>{t('profile.changePasswordTitle')}</span>
            </div>

            <Form<PasswordFormValues>
              form={form}
              layout="vertical"
              onFinish={handleChangePassword}
              initialValues={{ revokeOtherSessions: true }}
            >
              <Form.Item
                name="currentPassword"
                label={t('profile.currentPassword')}
                rules={[{ message: t('profile.currentPasswordRequired'), required: true }]}
              >
                <Input.Password placeholder={t('profile.currentPasswordPlaceholder')} autoComplete="current-password" />
              </Form.Item>

              <Form.Item
                name="newPassword"
                label={t('profile.newPassword')}
                rules={[
                  { message: t('auth.passwordRequired'), required: true },
                  { message: t('auth.passwordMin'), min: 8 },
                ]}
              >
                <Input.Password placeholder={t('profile.newPasswordPlaceholder')} autoComplete="new-password" />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                label={t('profile.confirmPassword')}
                dependencies={['newPassword']}
                rules={[
                  { message: t('auth.passwordRequired'), required: true },
                  ({ getFieldValue }) => ({
                    validator(_, value: string) {
                      if (!value || getFieldValue('newPassword') === value) {
                        return Promise.resolve()
                      }
                      return Promise.reject(new Error(t('profile.confirmPasswordMismatch')))
                    },
                  }),
                ]}
              >
                <Input.Password placeholder={t('profile.confirmPasswordPlaceholder')} autoComplete="new-password" />
              </Form.Item>

              <Form.Item name="revokeOtherSessions" valuePropName="checked" className="mb-4">
                <Switch /> <span className="text-fg-muted ml-2 text-sm">{t('profile.revokeOtherSessions')}</span>
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                icon={<KeyRound className="size-4" />}
                loading={changePasswordMutation.isPending}
              >
                {t('profile.changePasswordAction')}
              </Button>
            </Form>
          </div>
        ) : (
          <div className="px-5 py-4">
            <Alert showIcon type="info" message={t('profile.passwordNotConfigured')} />
          </div>
        )}
      </div>
    </section>
  )
}
