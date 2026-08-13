import { authClient } from '@admin/api/client'

export interface RequestPasswordResetInput {
  email: string
}

export class ForgotPasswordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForgotPasswordError'
  }
}

/**
 * 请求发送重置密码邮件。接口不区分邮箱是否存在，统一返回成功提示，避免泄露账号信息。
 */
export async function requestPasswordReset(input: RequestPasswordResetInput): Promise<void> {
  const result = await authClient.requestPasswordReset(input)

  if (result.error) {
    throw new ForgotPasswordError(result.error.message ?? '重置邮件发送失败，稍后再试')
  }
}
