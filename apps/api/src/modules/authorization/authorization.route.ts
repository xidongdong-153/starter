import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import {
  PermissionKeys,
  createRoleSchema,
  replaceRolePermissionsSchema,
  replaceUserRolesSchema,
  updateRoleSchema,
} from "@starter/contracts";
import {
  apiSuccessResponse,
  conflictResponse,
  forbiddenResponse,
  internalErrorResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@api/openapi/responses.js";
import { createRequireAuth } from "@api/modules/auth/index.js";
import { createSuccessResponse } from "@api/shared/response.js";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createRequirePermission } from "./authorization.guard.js";
import {
  authorizationAuditEventPageSchema,
  authorizationAuditQuerySchema,
  authorizationPermissionImpactSchema,
  authorizationPermissionParamsSchema,
  authorizationRoleCatalogQuerySchema,
  authorizationRoleCatalogSchema,
  authorizationRoleImpactSchema,
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
    409: conflictResponse,
  },
});

const listAuthorizationRolesRoute = createRoute({
  method: "get",
  path: "/api/authorization/roles",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  request: {
    query: authorizationRoleCatalogQuerySchema,
  },
  responses: {
    200: apiSuccessResponse(
      authorizationRoleCatalogSchema,
      "角色和权限目录，默认返回活动角色",
      "AuthorizationRoleCatalogResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    500: internalErrorResponse,
  },
});

const createRoleRoute = createRoute({
  method: "post",
  path: "/api/authorization/roles",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createRoleSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      authorizationRoleSchema,
      "创建的自定义角色",
      "CreateRoleResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

const updateRoleRoute = createRoute({
  method: "patch",
  path: "/api/authorization/roles/{roleKey}",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  request: {
    params: authorizationRoleParamsSchema,
    body: {
      content: { "application/json": { schema: updateRoleSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      authorizationRoleSchema,
      "更新后的角色",
      "UpdateRoleResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
  },
});

const archiveRoleRoute = createRoute({
  method: "post",
  path: "/api/authorization/roles/{roleKey}/archive",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  request: {
    params: authorizationRoleParamsSchema,
  },
  responses: {
    200: apiSuccessResponse(
      authorizationRoleSchema,
      "归档后的角色",
      "ArchiveRoleResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

const restoreRoleRoute = createRoute({
  method: "post",
  path: "/api/authorization/roles/{roleKey}/restore",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  request: {
    params: authorizationRoleParamsSchema,
  },
  responses: {
    200: apiSuccessResponse(
      authorizationRoleSchema,
      "恢复后的角色",
      "RestoreRoleResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
  },
});

const roleImpactRoute = createRoute({
  method: "get",
  path: "/api/authorization/roles/{roleKey}/impact",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  request: {
    params: authorizationRoleParamsSchema,
  },
  responses: {
    200: apiSuccessResponse(
      authorizationRoleImpactSchema,
      "角色当前分配用户数",
      "AuthorizationRoleImpactResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
  },
});

const permissionImpactRoute = createRoute({
  method: "get",
  path: "/api/authorization/permissions/{permissionKey}/impact",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  request: {
    params: authorizationPermissionParamsSchema,
  },
  responses: {
    200: apiSuccessResponse(
      authorizationPermissionImpactSchema,
      "permission 的有效角色和受影响用户数",
      "AuthorizationPermissionImpactResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
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

const listAuditEventsRoute = createRoute({
  method: "get",
  path: "/api/authorization/audit-events",
  tags: ["Authorization"],
  security: [{ cookieAuth: [] }],
  request: {
    query: authorizationAuditQuerySchema,
  },
  responses: {
    200: apiSuccessResponse(
      authorizationAuditEventPageSchema,
      "分页授权审计事件",
      "AuthorizationAuditEventPageResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    500: internalErrorResponse,
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
  const requireAuditRead = createRequirePermission(
    runtime.db,
    PermissionKeys.AUTHORIZATION_AUDIT_READ,
  );
  const service = createAuthorizationService(
    createAuthorizationRepository(runtime.db),
  );
  const app = new OpenAPIHono<HonoEnv>()

    .openapi(
      { ...currentPermissionsRoute, middleware: requireAuth },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.getCurrent(c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )

    .openapi(
      {
        ...listAuthorizationUsersRoute,
        middleware: [requireAuth, requireAuthorizationRead],
      },
      async (c) =>
        c.json(
          createSuccessResponse(await service.listUsers(), c.var.requestId),
          200,
        ),
    )

    .openapi(
      {
        ...replaceUserRolesRoute,
        middleware: [requireAuth, requireAuthorizationManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.replaceUserRoles(
              {
                actorType: "user",
                actorId: c.var.currentUserId,
                requestId: c.var.requestId,
              },
              c.req.valid("param").userId,
              c.req.valid("json"),
            ),
            c.var.requestId,
          ),
          200,
        ),
    )

    .openapi(
      {
        ...listAuthorizationRolesRoute,
        middleware: [requireAuth, requireAuthorizationRead],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.listRoles(c.req.valid("query").status),
            c.var.requestId,
          ),
          200,
        ),
    )

    .openapi(
      {
        ...createRoleRoute,
        middleware: [requireAuth, requireAuthorizationManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.createRole(
              {
                actorType: "user",
                actorId: c.var.currentUserId,
                requestId: c.var.requestId,
              },
              c.req.valid("json"),
            ),
            c.var.requestId,
          ),
          200,
        ),
    )

    .openapi(
      {
        ...updateRoleRoute,
        middleware: [requireAuth, requireAuthorizationManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.updateRole(
              {
                actorType: "user",
                actorId: c.var.currentUserId,
                requestId: c.var.requestId,
              },
              c.req.valid("param").roleKey,
              c.req.valid("json"),
            ),
            c.var.requestId,
          ),
          200,
        ),
    )

    .openapi(
      {
        ...archiveRoleRoute,
        middleware: [requireAuth, requireAuthorizationManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.archiveRole(
              {
                actorType: "user",
                actorId: c.var.currentUserId,
                requestId: c.var.requestId,
              },
              c.req.valid("param").roleKey,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )

    .openapi(
      {
        ...restoreRoleRoute,
        middleware: [requireAuth, requireAuthorizationManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.restoreRole(
              {
                actorType: "user",
                actorId: c.var.currentUserId,
                requestId: c.var.requestId,
              },
              c.req.valid("param").roleKey,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )

    .openapi(
      {
        ...roleImpactRoute,
        middleware: [requireAuth, requireAuthorizationRead],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.getRoleImpact(c.req.valid("param").roleKey),
            c.var.requestId,
          ),
          200,
        ),
    )

    .openapi(
      {
        ...permissionImpactRoute,
        middleware: [requireAuth, requireAuthorizationRead],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.getPermissionImpact(
              c.req.valid("param").permissionKey,
            ),
            c.var.requestId,
          ),
          200,
        ),
    )

    .openapi(
      {
        ...replaceRolePermissionsRoute,
        middleware: [requireAuth, requireAuthorizationManage],
      },
      (c) =>
        c.json(
          createSuccessResponse(
            service.replaceRolePermissions(
              {
                actorType: "user",
                actorId: c.var.currentUserId,
                requestId: c.var.requestId,
              },
              c.req.valid("param").roleKey,
              c.req.valid("json"),
            ),
            c.var.requestId,
          ),
          200,
        ),
    )

    .openapi(
      {
        ...listAuditEventsRoute,
        middleware: [requireAuth, requireAuditRead],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.listAuditEvents(c.req.valid("query")),
            c.var.requestId,
          ),
          200,
        ),
    );

  return app;
}
