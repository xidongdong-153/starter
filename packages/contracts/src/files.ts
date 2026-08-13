import { z } from 'zod'

import { isoDateTimeSchema, uuidSchema } from './common.js'

export const renameFileSchema = z.object({
  name: z.string().trim().min(1).max(255),
})

export type RenameFileInput = z.infer<typeof renameFileSchema>

export const fileItemSchema = z.object({
  id: z.uuidv7(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  contentUrl: z.string(),
})

export type FileItem = z.infer<typeof fileItemSchema>

export const fileListSchema = z.array(fileItemSchema)

/** 文件 ID 路径参数 */
export const fileIdParamsSchema = z.object({ fileId: uuidSchema })
