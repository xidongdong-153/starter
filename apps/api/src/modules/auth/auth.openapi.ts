import type { HonoEnv } from "@api/shared/hono-env.js";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import { isoDateTimeSchema } from "@api/openapi/responses.js";

export const authConfigSchema = z
  .object({
    providers: z.object({
      email: z.literal(true),
      github: z.boolean(),
      google: z.boolean(),
    }),
  })
  .openapi("AuthConfig");

const authUserSchema = z
  .object({
    id: z.uuidv7(),
    name: z.string(),
    email: z.email(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .openapi("AuthUser");

export const currentSessionSchema = z
  .object({
    user: authUserSchema,
    session: z.record(z.string(), z.unknown()),
    providers: z.array(z.string()),
  })
  .openapi("CurrentSession");

export function registerAuthOpenApiComponents(app: OpenAPIHono<HonoEnv>) {
  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description: "Better Auth session cookie",
  });
}
