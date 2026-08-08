import { authClient } from '@admin/api/client'

export interface SignInEmailInput {
  email: string
  password: string
}

export type SocialProvider = 'github' | 'google'

export interface SignInSocialInput {
  callbackURL: string
  provider: SocialProvider
}

export class SignInError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignInError'
  }
}

/**
 * 邮箱密码登录
 */
export async function signInEmail(input: SignInEmailInput): Promise<void> {
  const result = await authClient.signIn.email(input)

  if (result.error) {
    throw new SignInError(resolveSignInErrorMessage(result.error))
  }
}

/**
 * 第三方登录，成功后浏览器会跳到 callbackURL
 */
export async function signInSocial(input: SignInSocialInput): Promise<void> {
  const result = await authClient.signIn.social(input)

  if (result.error) {
    throw new SignInError(resolveSignInErrorMessage(result.error))
  }
}

function resolveSignInErrorMessage(error: { message?: string; status?: number }): string {
  if (error.message && error.message.trim() !== '') {
    return error.message
  }

  if (error.status === 401 || error.status === 403) {
    return '邮箱或密码不正确'
  }

  if (error.status === 429) {
    return '登录请求太频繁，稍后再试'
  }

  return '登录失败，稍后再试'
}
