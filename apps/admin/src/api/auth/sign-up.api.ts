import { authClient } from '@admin/api/client'

export interface SignUpEmailInput {
  email: string
  name: string
  password: string
}

export class SignUpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignUpError'
  }
}

/**
 * 邮箱密码注册，注册成功后直接是登录状态
 */
export async function signUpEmail(input: SignUpEmailInput): Promise<void> {
  const result = await authClient.signUp.email(input)

  if (result.error) {
    throw new SignUpError(result.error.message?.trim() || '注册失败，稍后再试')
  }
}
