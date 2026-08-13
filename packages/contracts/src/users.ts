import { z } from 'zod'

import { isoDateTimeSchema, userStatusSchema, uuidSchema } from './common.js'

export const updateUserStatusSchema = z.object({
  status: userStatusSchema,
})

export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>

/** PATCH /api/users/:userId/status 成功响应的 data，from 表示变更前状态 */
export const updateUserStatusResponseSchema = z.object({
  from: userStatusSchema,
  id: uuidSchema,
  status: userStatusSchema,
})

export const userManagementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  roleKey: z.string().trim().min(1).max(64).optional(),
})

export type UserManagementQuery = z.infer<typeof userManagementQuerySchema>

export const userManagementProfileSchema = z.object({
  bio: z.string().nullable(),
  contactEmail: z.email().nullable(),
  location: z.string().nullable(),
  availableForWork: z.boolean(),
  socialLinks: z.array(z.url()),
  avatarUrl: z.string().nullable(),
  updatedAt: isoDateTimeSchema.nullable(),
})

export type UserManagementProfile = z.infer<typeof userManagementProfileSchema>

export const userManagementUserSchema = z.object({
  id: z.uuidv7(),
  name: z.string(),
  email: z.email(),
  image: z.string().nullable(),
  emailVerified: z.boolean(),
  status: userStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  roleKeys: z.array(z.string()),
})

export type UserManagementUser = z.infer<typeof userManagementUserSchema>

export const userManagementUserPageSchema = z.object({
  items: z.array(userManagementUserSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
})

export type UserManagementUserPage = z.infer<typeof userManagementUserPageSchema>

export const userManagementUserDetailSchema = userManagementUserSchema.extend({
  providers: z.array(z.string()),
  profile: userManagementProfileSchema.nullable(),
})

export type UserManagementUserDetail = z.infer<typeof userManagementUserDetailSchema>
