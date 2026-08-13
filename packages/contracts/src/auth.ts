import { z } from 'zod'

import { isoDateTimeSchema, userStatusSchema } from './common.js'

export const authConfigSchema = z.object({
  providers: z.object({
    email: z.literal(true),
    github: z.boolean(),
    google: z.boolean(),
  }),
})

export type AuthConfig = z.infer<typeof authConfigSchema>

export const authUserSchema = z.object({
  id: z.uuidv7(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  status: userStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export type AuthUser = z.infer<typeof authUserSchema>

export const currentSessionSchema = z.object({
  user: authUserSchema,
  session: z.record(z.string(), z.unknown()),
  providers: z.array(z.string()),
})

export type CurrentSession = z.infer<typeof currentSessionSchema>
