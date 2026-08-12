import { z } from "@hono/zod-openapi";

export const healthSchema = z.object({ ok: z.literal(true) });

export const serviceInfoSchema = z.object({
  name: z.string(),
  status: z.literal("ok"),
});

export const systemLogLevelSchema = z.enum(["info", "warn", "error"]);

export const systemLogsQuerySchema = z.object({
  requestId: z.string().trim().min(1).max(128).optional(),
  level: systemLogLevelSchema.optional(),
  query: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.coerce.number().int().positive().optional(),
});

export const systemLogEntrySchema = z.record(z.string(), z.unknown());

export const systemLogsResponseSchema = z.object({
  items: z.array(systemLogEntrySchema),
});
