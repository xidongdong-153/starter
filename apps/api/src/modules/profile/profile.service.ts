import type { StorageDriver } from '@api/infra/storage/index.js'
import type { AccountProfile, PublicProfile, UpdateProfileInput } from '@starter/contracts'
import type { FilesService } from '@api/modules/files/files.service.js'
import type { ProfileRepository } from './profile.repository.js'
import { ApiErrorCodes } from '@starter/contracts'
import { AppError } from '@api/shared/app-error.js'
import { toAccountProfile, toPublicProfile } from './profile.presenter.js'

export function createProfileService(
  storage: StorageDriver,
  repository: ProfileRepository,
  filesService: FilesService,
) {
  async function getCurrent(userId: string): Promise<AccountProfile> {
    const resource = await getResource(userId)
    const providers = await repository.listProviders(userId)
    return toAccountProfile(
      resource,
      providers.map((item) => item.providerId),
    )
  }

  async function updateCurrent(userId: string, input: UpdateProfileInput): Promise<AccountProfile> {
    repository.update(userId, input)
    return getCurrent(userId)
  }

  async function getPublic(userId: string): Promise<PublicProfile> {
    return toPublicProfile(await getResource(userId))
  }

  async function setAvatar(userId: string, fileId: string) {
    const file = await filesService.findOwned(fileId, userId)
    if (!file.mimeType.startsWith('image/')) {
      throw new AppError(ApiErrorCodes.FILES_UNSUPPORTED_TYPE, '头像必须是图片文件', 422)
    }
    repository.setAvatar(userId, fileId)
    return { fileId }
  }

  function clearAvatar(userId: string): { ok: true } {
    repository.setAvatar(userId, null)
    return { ok: true }
  }

  async function openAvatar(userId: string): Promise<Response> {
    const result = await repository.findAvatarByUserId(userId)
    if (!result) {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, '头像不存在', 404)
    }
    try {
      const data = await storage.read(result.file.storagePath)
      return new Response(data, {
        headers: {
          'Content-Type': result.file.mimeType,
          'Content-Length': String(result.file.size),
          'Cache-Control': 'public, max-age=300',
        },
      })
    } catch {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, '头像不存在', 404)
    }
  }

  async function getResource(userId: string) {
    const row = await repository.findByUserId(userId)
    if (!row) {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, '资料不存在', 404)
    }
    const avatar = row.profile.avatarFileId ? ((await repository.findAvatarByUserId(userId))?.file ?? null) : null
    return { ...row, avatar }
  }

  return {
    clearAvatar,
    getCurrent,
    getPublic,
    openAvatar,
    setAvatar,
    updateCurrent,
  }
}
