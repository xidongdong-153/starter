import { z } from 'zod'

import { isoDateTimeSchema, socialLinksSchema, uuidSchema } from './common.js'

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(500).nullable(),
  contactEmail: z.email().nullable(),
  location: z.string().trim().max(120).nullable(),
  availableForWork: z.boolean(),
  socialLinks: socialLinksSchema,
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

export const setAvatarSchema = z.object({ fileId: uuidSchema })

/** PUT /api/profile/avatar 成功响应的 data */
export const fileIdSchema = z.object({ fileId: uuidSchema })

/** 头像和资料 URL 是相对路径（/api/profiles/:userId/avatar），不是绝对 URL */
export const publicProfileSchema = z.object({
  userId: z.uuidv7(),
  name: z.string(),
  bio: z.string().nullable(),
  contactEmail: z.email().nullable(),
  location: z.string().nullable(),
  availableForWork: z.boolean(),
  socialLinks: socialLinksSchema,
  avatarUrl: z.string().nullable(),
  updatedAt: isoDateTimeSchema,
})

export type PublicProfile = z.infer<typeof publicProfileSchema>

export const accountProfileSchema = publicProfileSchema.extend({
  email: z.email(),
  providers: z.array(z.string()),
})

export type AccountProfile = z.infer<typeof accountProfileSchema>
