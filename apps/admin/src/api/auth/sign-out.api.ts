import { authClient } from '@admin/api/client'

export class SignOutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignOutError'
  }
}

/**
 * 退出登录
 */
export async function signOut(): Promise<void> {
  const result = await authClient.signOut()

  if (result.error) {
    throw new SignOutError(result.error.message?.trim() || '退出登录失败')
  }
}
