import { z } from "@hono/zod-openapi";

export const healthSchema = z.object({ ok: z.literal(true) });

export const serviceInfoSchema = z.object({
  name: z.string(),
  status: z.literal("ok"),
});
