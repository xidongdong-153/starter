import type { PublicProfile } from '@starter/contracts'
import { resolveApiUrl } from '@web/lib/env.client'
import { apiRpc, unwrapApiData } from '@web/lib/rpc'

export async function getPublicProfile(userId: string): Promise<PublicProfile> {
  const data = await unwrapApiData<unknown>(
    apiRpc.api.profiles[':userId'].$get(
      { param: { userId: encodeURIComponent(userId) } },
      { init: { cache: 'no-store' } },
    ),
  )

  if (!isPublicProfile(data)) {
    throw new Error('公开资料的数据格式不正确。')
  }

  return data
}

export function getPublicProfileAvatarUrl(avatarPath: string): string {
  return resolveApiUrl(avatarPath)
}

function isPublicProfile(value: unknown): value is PublicProfile {
  if (!isRecord(value)) return false

  return (
    typeof value.userId === 'string' &&
    typeof value.name === 'string' &&
    isNullableString(value.bio) &&
    isNullableString(value.contactEmail) &&
    isNullableString(value.location) &&
    typeof value.availableForWork === 'boolean' &&
    Array.isArray(value.socialLinks) &&
    value.socialLinks.every(isUrl) &&
    isNullableString(value.avatarUrl) &&
    typeof value.updatedAt === 'string'
  )
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUrl(value: unknown): value is string {
  return typeof value === 'string' && URL.canParse(value)
}
