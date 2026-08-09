import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import {
  PermissionKeys,
  replaceRolePermissionsSchema,
  replaceUserRolesSchema,
} from "@starter/contracts";
import {
  apiSuccessResponse,
  forbiddenResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@api/openapi/responses.js";
import { createRequireAuth } from "@api/modules/auth/index.js";
import { createSuccessResponse } from "@api/shared/response.js";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createRequirePermission } from "./authorization.guard.js";
import {
  authorizationRoleCatalogSchema,
  authorizationRoleParamsSchema,
  authorizationRoleSchema,
  authorizationUserParamsSchema,
  authorizationUsersSchema,
  currentPermissionsSchema,
} from "./authorization.openapi.js";
import { createAuthorizationRepository } from "./authorization.repository.js";
import { createAuthorizationService } from "./authorization.service.js";

const currentPermissionsRoute = createRoute({
  method: "get",
  path: "/api/me/permissions",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  responses: {
    200: apiSuccessResponse(
      currentPermissionsSchema,
      "当前用户的活动角色和权限",
      "CurrentPermissionsResponse",
    ),
    401: unauthorizedResponse,
  },
});

const listAuthorizationUsersRoute = createRoute({
  method: "get",
  path: "/api/authorization/users",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  responses: {
    200: apiSuccessResponse(
      authorizationUsersSchema,
      "用户及其活动角色",
      "AuthorizationUsersResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const replaceUserRolesRoute = createRoute({
  method: "put",
  path: "/api/authorization/users/{userId}/roles",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  request: {
    params: authorizationUserParamsSchema,
    body: {
      content: { "application/json": { schema: replaceUserRolesSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      authorizationUsersSchema.element,
      "更新后的用户角色",
      "AuthorizationUserResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
});

const listAuthorizationRolesRoute = createRoute({
  method: "get",
  path: "/api/authorization/roles",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  responses: {
    200: apiSuccessResponse(
      authorizationRoleCatalogSchema,
      "活动角色和权限目录",
      "AuthorizationRoleCatalogResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const replaceRolePermissionsRoute = createRoute({
  method: "put",
  path: "/api/authorization/roles/{roleKey}/permissions",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  request: {
    params: authorizationRoleParamsSchema,
    body: {
      content: {
        "application/json": { schema: replaceRolePermissionsSchema },
      },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      authorizationRoleSchema,
      "更新后的角色权限",
      "AuthorizationRoleResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
});

export function createAuthorizationRoute(runtime: AppRuntime) {
  const requireAuth = createRequireAuth(runtime.auth);
  const requireAuthorizationRead = createRequirePermission(
    runtime.db,
    PermissionKeys.AUTHORIZATION_READ,
  );
  const requireAuthorizationManage = createRequirePermission(
    runtime.db,
    PermissionKeys.AUTHORIZATION_MANAGE,
  );
  const service = createAuthorizationService(
    createAuthorizationRepository(runtime.db),
  );
  const app = new OpenAPIHono<HonoEnv>();

  app.openapi(
    { ...currentPermissionsRoute, middleware: requireAuth },
    async (c) =>
      c.json(
        createSuccessResponse(
          await service.getCurrent(c.var.currentUserId),
          c.var.requestId,
        ),
        200,
      ),
  );

  app.openapi(
    {
      ...listAuthorizationUsersRoute,
      middleware: [requireAuth, requireAuthorizationRead],
    },
    async (c) =>
      c.json(
        createSuccessResponse(await service.listUsers(), c.var.requestId),
        200,
      ),
  );

  app.openapi(
    {
      ...replaceUserRolesRoute,
      middleware: [requireAuth, requireAuthorizationManage],
    },
    (c) =>
      c.json(
        createSuccessResponse(
          service.replaceUserRoles(
            c.var.currentUserId,
            c.req.valid("param").userId,
            c.req.valid("json"),
          ),
          c.var.requestId,
        ),
        200,
      ),
  );

  app.openapi(
    {
      ...listAuthorizationRolesRoute,
      middleware: [requireAuth, requireAuthorizationRead],
    },
    async (c) =>
      c.json(
        createSuccessResponse(await service.listRoles(), c.var.requestId),
        200,
      ),
  );

  app.openapi(
    {
      ...replaceRolePermissionsRoute,
      middleware: [requireAuth, requireAuthorizationManage],
    },
    (c) =>
      c.json(
        createSuccessResponse(
          service.replaceRolePermissions(
            c.var.currentUserId,
            c.req.valid("param").roleKey,
            c.req.valid("json"),
          ),
          c.var.requestId,
        ),
        200,
      ),
  );

  return app;
}
