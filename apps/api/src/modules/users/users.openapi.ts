import { z } from "@hono/zod-openapi";
import { isoDateTimeSchema } from "@api/openapi/responses.js";

export const userManagementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  roleKey: z.string().trim().min(1).max(64).optional(),
});

const userManagementProfileSchema = z.object({
  bio: z.string().nullable(),
  contactEmail: z.string().email().nullable(),
  location: z.string().nullable(),
  availableForWork: z.boolean(),
  socialLinks: z.array(z.string().url()),
  avatarUrl: z.string().url().nullable(),
  updatedAt: isoDateTimeSchema,
});

export const userManagementUserSchema = z.object({
  id: z.uuidv7(),
  name: z.string(),
  email: z.string().email(),
  image: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  roleKeys: z.array(z.string()),
});

export const userManagementUserPageSchema = z.object({
  items: z.array(userManagementUserSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});

export const userManagementUserDetailSchema = userManagementUserSchema.extend({
  providers: z.array(z.string()),
  profile: userManagementProfileSchema.nullable(),
});

export const userIdParamsSchema = z.object({
  userId: z.uuidv7(),
});
