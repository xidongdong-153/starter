import { authClient } from '@admin/api/client'

import type { SocialProvider } from './sign-in.api'

export interface LinkSocialInput {
  callbackURL: string
  errorCallbackURL: string
  provider: SocialProvider
}

export class LinkSocialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinkSocialError'
  }
}

/**
 * 为当前登录用户绑定第三方账号，OAuth 完成后回到个人资料页。
 */
export async function linkSocial(input: LinkSocialInput): Promise<void> {
  const result = await authClient.linkSocial(input)

  if (result.error) {
    throw new LinkSocialError(resolveLinkSocialErrorMessage(result.error))
  }
}

function resolveLinkSocialErrorMessage(error: { message?: string; status?: number }): string {
  if (error.message && error.message.trim() !== '') {
    return error.message
  }

  if (error.status === 401 || error.status === 403) {
    return '当前登录状态不能绑定第三方账号'
  }

  return '绑定第三方账号失败，稍后再试'
}
