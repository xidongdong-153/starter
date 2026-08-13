import { authClient } from '@admin/api/client'

export class VerifyEmailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerifyEmailError'
  }
}

export class SendVerificationEmailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SendVerificationEmailError'
  }
}

/**
 * 用邮件链接里的 token 完成邮箱验证。
 */
export async function verifyEmail(token: string): Promise<void> {
  const result = await authClient.verifyEmail({ query: { token } })

  if (result.error) {
    throw new VerifyEmailError(result.error.message ?? '邮箱验证失败，链接可能已过期')
  }
}

/**
 * 给当前登录账号重新发送验证邮件。
 */
export async function sendVerificationEmail(email: string): Promise<void> {
  const result = await authClient.sendVerificationEmail({ email })

  if (result.error) {
    throw new SendVerificationEmailError(result.error.message ?? '验证邮件发送失败，稍后再试')
  }
}
