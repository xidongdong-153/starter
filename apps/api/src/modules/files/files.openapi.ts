import { z } from "@hono/zod-openapi";
import { isoDateTimeSchema } from "@api/openapi/responses.js";

export const fileItemSchema = z
  .object({
    id: z.uuidv7(),
    name: z.string(),
    mimeType: z.string(),
    size: z.number().int().nonnegative(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    contentUrl: z.string(),
  })
  .openapi("FileItem");

export const fileListSchema = z.array(fileItemSchema);
