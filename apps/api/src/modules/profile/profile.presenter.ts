import type { AccountProfile, PublicProfile } from '@starter/contracts'
import type { ProfileRecord } from './profile.repository.js'
import type { FileRecord } from '@api/modules/files/files.repository.js'

interface ProfilePresenterInput extends ProfileRecord {
  avatar: FileRecord | null
}

export function toPublicProfile(input: ProfilePresenterInput): PublicProfile {
  let socialLinks: string[] = []
  try {
    socialLinks = JSON.parse(input.profile.socialLinks) as string[]
  } catch {
    socialLinks = []
  }

  return {
    userId: input.user.id,
    name: input.user.name,
    bio: input.profile.bio,
    contactEmail: input.profile.contactEmail,
    location: input.profile.location,
    availableForWork: input.profile.availableForWork,
    socialLinks,
    avatarUrl: input.avatar ? `/api/profiles/${input.user.id}/avatar` : null,
    updatedAt: input.profile.updatedAt.toISOString(),
  } satisfies PublicProfile
}

export function toAccountProfile(input: ProfilePresenterInput, providers: string[]): AccountProfile {
  return {
    ...toPublicProfile(input),
    email: input.user.email,
    providers,
  } satisfies AccountProfile
}
