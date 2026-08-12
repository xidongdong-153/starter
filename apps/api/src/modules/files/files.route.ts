import type { AppRuntime } from "@api/bootstrap/create-runtime.js";
import type { HonoEnv } from "@api/shared/hono-env.js";
import { zValidator } from "@hono/zod-validator";
import {
  ApiErrorCodes,
  PermissionKeys,
  renameFileSchema,
  uuidSchema,
} from "@starter/contracts";
import {
  apiSuccessResponse,
  forbiddenResponse,
  invalidRequestResponse,
  notFoundResponse,
  okSchema,
  unauthorizedResponse,
} from "@api/openapi/responses.js";
import { fileItemSchema, fileListSchema } from "./files.openapi.js";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createRequireAuth } from "@api/modules/auth/index.js";
import { createRequirePermission } from "@api/modules/authorization/index.js";
import { AppError } from "@api/shared/app-error.js";
import { createSuccessResponse } from "@api/shared/response.js";
import { throwValidationError } from "@api/shared/validator.js";
import { createFilesRepository } from "./files.repository.js";
import { createFilesService } from "./files.service.js";

const fileParamsSchema = z.object({ fileId: uuidSchema });
const uploadFileSchema = z.object({ file: z.any() });

const listFilesRoute = createRoute({
  method: "get",
  path: "/api/files",
  tags: ["Files"],
  security: [{ cookieAuth: [] }],
  responses: {
    200: apiSuccessResponse(
      fileListSchema,
      "当前用户的文件列表",
      "FileListResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

const uploadFileRoute = createRoute({
  method: "post",
  path: "/api/files",
  tags: ["Files"],
  security: [{ cookieAuth: [] }],
  request: {
    body: {
      content: {
        "multipart/form-data": { schema: uploadFileSchema },
      },
      required: true,
    },
  },
  responses: {
    201: apiSuccessResponse(
      fileItemSchema,
      "上传后的文件",
      "UploadedFileResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    413: invalidRequestResponse,
  },
});

const renameFileRoute = createRoute({
  method: "patch",
  path: "/api/files/{fileId}",
  tags: ["Files"],
  security: [{ cookieAuth: [] }],
  request: {
    params: fileParamsSchema,
    body: {
      content: {
        "application/json": { schema: renameFileSchema },
      },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      fileItemSchema,
      "重命名后的文件",
      "RenamedFileResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
});

const removeFileRoute = createRoute({
  method: "delete",
  path: "/api/files/{fileId}",
  tags: ["Files"],
  security: [{ cookieAuth: [] }],
  request: { params: fileParamsSchema },
  responses: {
    200: apiSuccessResponse(okSchema, "删除文件结果", "RemoveFileResponse"),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
});

export function createFilesRoute(runtime: AppRuntime) {
  const requireAuth = createRequireAuth(runtime.auth);
  const requireFileList = createRequirePermission(
    runtime.db,
    PermissionKeys.FILE_LIST,
  );
  const requireFileRead = createRequirePermission(
    runtime.db,
    PermissionKeys.FILE_READ,
  );
  const requireFileUpload = createRequirePermission(
    runtime.db,
    PermissionKeys.FILE_UPLOAD,
  );
  const requireFileRename = createRequirePermission(
    runtime.db,
    PermissionKeys.FILE_RENAME,
  );
  const requireFileDelete = createRequirePermission(
    runtime.db,
    PermissionKeys.FILE_DELETE,
  );
  const service = createFilesService(
    runtime.storage,
    createFilesRepository(runtime.db),
  );
  const app = new OpenAPIHono<HonoEnv>();

  app.openapi(
    { ...listFilesRoute, middleware: [requireAuth, requireFileList] },
    async (c) =>
      c.json(
        createSuccessResponse(
          await service.list(c.var.currentUserId),
          c.var.requestId,
        ),
        200,
      ),
  );

  app.openapi(
    { ...uploadFileRoute, middleware: [requireAuth, requireFileUpload] },
    async (c) => {
      const form = c.req.valid("form");
      const file = form.file;
      if (!(file instanceof File)) {
        throw new AppError(
          ApiErrorCodes.COMMON_INVALID_REQUEST,
          "请选择文件",
          400,
        );
      }
      const ownerId = c.var.currentUserId;
      const failedBase = {
        event: "files.upload.failed",
        name: file.name,
        ownerId,
        size: file.size,
      };
      try {
        const item = await service.upload(ownerId, file);
        c.var.logger.info(
          {
            event: "files.upload.succeeded",
            fileId: item.id,
            mimeType: item.mimeType,
            name: item.name,
            ownerId,
            size: item.size,
          },
          "文件上传成功",
        );
        return c.json(createSuccessResponse(item, c.var.requestId), 201);
      } catch (error) {
        if (error instanceof AppError) {
          c.var.logger.warn(
            { ...failedBase, code: error.code, message: error.message },
            "文件上传失败",
          );
        } else {
          c.var.logger.error({ err: error, ...failedBase }, "文件上传失败");
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/files/:fileId/content",
    requireAuth,
    requireFileRead,
    zValidator("param", fileParamsSchema, (result) => {
      if (!result.success) throwValidationError(result.error);
    }),
    (c) => service.open(c.req.valid("param").fileId, c.var.currentUserId),
  );

  app.openapi(
    { ...renameFileRoute, middleware: [requireAuth, requireFileRename] },
    async (c) =>
      c.json(
        createSuccessResponse(
          await service.rename(
            c.req.valid("param").fileId,
            c.var.currentUserId,
            c.req.valid("json").name,
          ),
          c.var.requestId,
        ),
        200,
      ),
  );

  app.openapi(
    { ...removeFileRoute, middleware: [requireAuth, requireFileDelete] },
    async (c) =>
      c.json(
        createSuccessResponse(
          await service.remove(
            c.req.valid("param").fileId,
            c.var.currentUserId,
          ),
          c.var.requestId,
        ),
        200,
      ),
  );

  return app;
}
