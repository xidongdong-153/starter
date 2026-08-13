import { authClient } from '@admin/api/client'

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
  revokeOtherSessions: boolean
}

export class ChangePasswordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChangePasswordError'
  }
}

/**
 * 修改当前账号密码。revokeOtherSessions 为 true 时吊销其他设备会话，只保留当前会话。
 */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const result = await authClient.changePassword(input)

  if (result.error) {
    throw new ChangePasswordError(result.error.message ?? '密码修改失败，稍后再试')
  }
}
