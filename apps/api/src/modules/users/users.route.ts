import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { PermissionKeys } from "@starter/contracts";
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
import { createRequirePermission } from "@api/modules/authorization/authorization.guard.js";
import { createUsersRepository } from "./users.repository.js";
import { createUsersService } from "./users.service.js";
import {
  updateUserStatusBodySchema,
  updateUserStatusResponseSchema,
  userIdParamsSchema,
  userManagementQuerySchema,
  userManagementUserDetailSchema,
  userManagementUserPageSchema,
} from "./users.openapi.js";

const listUsersRoute = createRoute({
  method: "get",
  path: "/api/users",
  tags: ["Users"],
  security: [{ cookieAuth: [] }],
  request: {
    query: userManagementQuerySchema,
  },
  responses: {
    200: apiSuccessResponse(
      userManagementUserPageSchema,
      "分页用户列表",
      "UserManagementUserPageResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const getUserDetailRoute = createRoute({
  method: "get",
  path: "/api/users/{userId}",
  tags: ["Users"],
  security: [{ cookieAuth: [] }],
  request: {
    params: userIdParamsSchema,
  },
  responses: {
    200: apiSuccessResponse(
      userManagementUserDetailSchema,
      "用户详情",
      "UserManagementUserDetailResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
});

const updateUserStatusRoute = createRoute({
  method: "patch",
  path: "/api/users/{userId}/status",
  tags: ["Users"],
  security: [{ cookieAuth: [] }],
  request: {
    params: userIdParamsSchema,
    body: {
      content: { "application/json": { schema: updateUserStatusBodySchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      updateUserStatusResponseSchema,
      "更新后的用户状态",
      "UpdateUserStatusResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
});

export function createUsersRoute(runtime: AppRuntime) {
  const requireAuth = createRequireAuth(runtime.auth);
  const requireUsersRead = createRequirePermission(
    runtime.db,
    PermissionKeys.AUTHORIZATION_READ,
  );
  const requireUsersManage = createRequirePermission(
    runtime.db,
    PermissionKeys.AUTHORIZATION_MANAGE,
  );
  const service = createUsersService(createUsersRepository(runtime.db));
  const app = new OpenAPIHono<HonoEnv>()
    .openapi(
      {
        ...listUsersRoute,
        middleware: [requireAuth, requireUsersRead],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.listUsers(c.req.valid("query")),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...getUserDetailRoute,
        middleware: [requireAuth, requireUsersRead],
      },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.getUserDetail(c.req.valid("param").userId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi(
      {
        ...updateUserStatusRoute,
        middleware: [requireAuth, requireUsersManage],
      },
      async (c) => {
        const { userId } = c.req.valid("param");
        const { status } = c.req.valid("json");
        const data = await service.updateUserStatus(
          c.var.currentUserId,
          userId,
          status,
          c.var.requestId,
        );
        c.var.logger.info(
          {
            actorId: c.var.currentUserId,
            event: "users.status.changed",
            from: data.from,
            targetUserId: userId,
            to: data.status,
          },
          "用户状态变更",
        );
        return c.json(createSuccessResponse(data, c.var.requestId), 200);
      },
    );

  return app;
}
