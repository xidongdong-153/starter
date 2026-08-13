import { authClient } from '@admin/api/client'

export interface ResetPasswordInput {
  newPassword: string
  token: string
}

export class ResetPasswordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResetPasswordError'
  }
}

/**
 * 用邮件链接里的 token 设置新密码。
 */
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const result = await authClient.resetPassword(input)

  if (result.error) {
    throw new ResetPasswordError(result.error.message ?? '密码重置失败，稍后再试')
  }
}
