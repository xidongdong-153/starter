import { z } from "@hono/zod-openapi";
import { isoDateTimeSchema } from "@api/openapi/responses.js";

export const publicProfileSchema = z
  .object({
    userId: z.uuidv7(),
    name: z.string(),
    bio: z.string().nullable(),
    contactEmail: z.email().nullable(),
    location: z.string().nullable(),
    availableForWork: z.boolean(),
    socialLinks: z.array(z.url()).max(8),
    avatarUrl: z.url().nullable(),
    updatedAt: isoDateTimeSchema,
  })
  .openapi("PublicProfile");

export const accountProfileSchema = publicProfileSchema
  .extend({
    email: z.email(),
    providers: z.array(z.string()),
  })
  .openapi("AccountProfile");

export const fileIdSchema = z.object({ fileId: z.uuidv7() });
