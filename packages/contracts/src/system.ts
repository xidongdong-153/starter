import { z } from 'zod'

export const healthSchema = z.object({ ok: z.literal(true) })

export const serviceInfoSchema = z.object({
  name: z.string(),
  status: z.literal('ok'),
})

export const systemLogLevelSchema = z.enum(['info', 'warn', 'error'])

export type SystemLogLevel = z.infer<typeof systemLogLevelSchema>

export const systemLogEntrySchema = z.record(z.string(), z.unknown())

export type SystemLogEntry = z.infer<typeof systemLogEntrySchema>

export const systemLogsQuerySchema = z.object({
  requestId: z.string().trim().min(1).max(128).optional(),
  level: systemLogLevelSchema.optional(),
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export type SystemLogsQuery = z.infer<typeof systemLogsQuerySchema>

export const systemLogsResponseSchema = z.object({
  items: z.array(systemLogEntrySchema),
  total: z.number().int().min(0),
})

export type SystemLogsResponse = z.infer<typeof systemLogsResponseSchema>
