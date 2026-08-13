import {
  authConfigSchema as authConfigSchemaBase,
  authUserSchema as authUserSchemaBase,
  currentSessionSchema as currentSessionSchemaBase,
} from "@starter/contracts";
import { nameSchema } from "@api/openapi/name-schema.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import type { OpenAPIHono } from "@hono/zod-openapi";

export const authConfigSchema = nameSchema(authConfigSchemaBase, "AuthConfig");
export const authUserSchema = nameSchema(authUserSchemaBase, "AuthUser");
export const currentSessionSchema = nameSchema(
  currentSessionSchemaBase,
  "CurrentSession",
);

export function registerAuthOpenApiComponents(app: OpenAPIHono<HonoEnv>) {
  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description: "Better Auth session cookie",
  });
}
