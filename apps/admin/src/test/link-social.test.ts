import { authClient } from '@admin/api/client'
import { LinkSocialError, linkSocial } from '@admin/api/auth/link-social.api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@admin/api/client', () => ({
  authClient: {
    linkSocial: vi.fn(),
  },
}))

describe('linkSocial', () => {
  beforeEach(() => {
    vi.mocked(authClient.linkSocial).mockReset()
  })

  it('oauth 跳转成功时不抛出错误', async () => {
    vi.mocked(authClient.linkSocial).mockResolvedValue({ error: null })

    await expect(
      linkSocial({
        callbackURL: 'http://localhost:2333/settings/profile',
        errorCallbackURL: 'http://localhost:2333/settings/profile',
        provider: 'github',
      }),
    ).resolves.toBeUndefined()
  })

  it('返回错误消息时抛出可读错误', async () => {
    vi.mocked(authClient.linkSocial).mockResolvedValue({
      error: { message: 'account_already_linked_to_different_user' },
    })

    await expect(
      linkSocial({
        callbackURL: 'http://localhost:2333/settings/profile',
        errorCallbackURL: 'http://localhost:2333/settings/profile',
        provider: 'google',
      }),
    ).rejects.toEqual(new LinkSocialError('account_already_linked_to_different_user'))
  })

  it('没有错误消息时按状态码返回登录状态提示', async () => {
    vi.mocked(authClient.linkSocial).mockResolvedValue({ error: { status: 401 } })

    await expect(
      linkSocial({
        callbackURL: 'http://localhost:2333/settings/profile',
        errorCallbackURL: 'http://localhost:2333/settings/profile',
        provider: 'github',
      }),
    ).rejects.toEqual(new LinkSocialError('当前登录状态不能绑定第三方账号'))
  })
})
