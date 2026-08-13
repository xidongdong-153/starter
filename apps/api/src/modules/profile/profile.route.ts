import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { zValidator } from "@hono/zod-validator";
import {
  apiSuccessResponse,
  invalidRequestResponse,
  notFoundResponse,
  okSchema,
  unauthorizedResponse,
} from "@api/openapi/responses.js";
import {
  accountProfileSchema,
  fileIdSchema,
  publicProfileSchema,
} from "./profile.openapi.js";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  setAvatarSchema,
  updateProfileSchema,
  uuidSchema,
} from "@starter/contracts";
import { z } from "zod";
import { createRequireAuth } from "@api/modules/auth/index.js";
import {
  createFilesRepository,
  createFilesService,
} from "@api/modules/files/index.js";
import { createSuccessResponse } from "@api/shared/response.js";
import { throwValidationError } from "@api/shared/validator.js";
import { createProfileRepository } from "./profile.repository.js";
import { createProfileService } from "./profile.service.js";

const userParamsSchema = z.object({ userId: uuidSchema });

const getCurrentProfileRoute = createRoute({
  method: "get",
  path: "/api/profile",
  tags: ["Profile"],
  security: [{ cookieAuth: [] }],
  responses: {
    200: apiSuccessResponse(
      accountProfileSchema,
      "当前用户资料",
      "AccountProfileResponse",
    ),
    401: unauthorizedResponse,
  },
});

const updateProfileRoute = createRoute({
  method: "patch",
  path: "/api/profile",
  tags: ["Profile"],
  security: [{ cookieAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: updateProfileSchema },
      },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      accountProfileSchema,
      "更新后的当前用户资料",
      "UpdatedAccountProfileResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
  },
});

const setAvatarRoute = createRoute({
  method: "put",
  path: "/api/profile/avatar",
  tags: ["Profile"],
  security: [{ cookieAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: setAvatarSchema },
      },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      fileIdSchema,
      "设置头像后的文件 ID",
      "AvatarResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

const clearAvatarRoute = createRoute({
  method: "delete",
  path: "/api/profile/avatar",
  tags: ["Profile"],
  security: [{ cookieAuth: [] }],
  responses: {
    200: apiSuccessResponse(okSchema, "清除头像结果", "ClearAvatarResponse"),
    401: unauthorizedResponse,
  },
});

const getPublicProfileRoute = createRoute({
  method: "get",
  path: "/api/profiles/{userId}",
  tags: ["Profile"],
  request: { params: userParamsSchema },
  responses: {
    200: apiSuccessResponse(
      publicProfileSchema,
      "公开用户资料",
      "PublicProfileResponse",
    ),
    400: invalidRequestResponse,
    404: notFoundResponse,
  },
});

export function createProfileRoute(runtime: AppRuntime) {
  const requireAuth = createRequireAuth(runtime.auth);
  const filesService = createFilesService(
    runtime.storage,
    createFilesRepository(runtime.db),
  );
  const service = createProfileService(
    runtime.storage,
    createProfileRepository(runtime.db),
    filesService,
  );
  const app = new OpenAPIHono<HonoEnv>()
    .openapi(
      { ...getCurrentProfileRoute, middleware: requireAuth },
      async (c) =>
        c.json(
          createSuccessResponse(
            await service.getCurrent(c.var.currentUserId),
            c.var.requestId,
          ),
          200,
        ),
    )
    .openapi({ ...updateProfileRoute, middleware: requireAuth }, async (c) =>
      c.json(
        createSuccessResponse(
          await service.updateCurrent(c.var.currentUserId, c.req.valid("json")),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...setAvatarRoute, middleware: requireAuth }, async (c) =>
      c.json(
        createSuccessResponse(
          await service.setAvatar(
            c.var.currentUserId,
            c.req.valid("json").fileId,
          ),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi({ ...clearAvatarRoute, middleware: requireAuth }, (c) =>
      c.json(
        createSuccessResponse(
          service.clearAvatar(c.var.currentUserId),
          c.var.requestId,
        ),
        200,
      ),
    )
    .openapi(getPublicProfileRoute, async (c) =>
      c.json(
        createSuccessResponse(
          await service.getPublic(c.req.valid("param").userId),
          c.var.requestId,
        ),
        200,
      ),
    );

  app.get(
    "/api/profiles/:userId/avatar",
    zValidator("param", userParamsSchema, (result) => {
      if (!result.success) throwValidationError(result.error);
    }),
    (c) => service.openAvatar(c.req.valid("param").userId),
  );

  return app;
}
