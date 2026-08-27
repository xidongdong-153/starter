import type { AppInstance, AppRegistrar } from "./app.types.js";
import { ApiErrorCodes } from "@starter/contracts";
import { HTTPException } from "hono/http-exception";
import { AppError } from "@api/shared/app-error.js";
import { createFailureResponse } from "@api/shared/response.js";
import { StoredJsonError } from "@api/shared/stored-json.js";

export const registerErrorHandler: AppRegistrar = (
  app: AppInstance,
  runtime,
) => {
  app.onError((error, c) => {
    if (error instanceof StoredJsonError) {
      // 数据损坏只记安全字段：列名、原因分类和字段路径，不记被拒绝的值。
      runtime.logger.error(
        {
          column: error.column,
          reason: error.reason,
          issues: error.issues,
          requestId: c.var.requestId,
        },
        "主库 JSON 列数据损坏",
      );
    }

    if (error instanceof AppError) {
      return c.json(
        createFailureResponse(
          { code: error.code, message: error.message, details: error.details },
          c.var.requestId,
        ),
        error.status,
      );
    }

    if (error instanceof HTTPException) {
      const code =
        error.status === 504
          ? ApiErrorCodes.SYSTEM_UPSTREAM_TIMEOUT
          : ApiErrorCodes.COMMON_INVALID_REQUEST;
      return c.json(
        createFailureResponse(
          { code, message: error.message },
          c.var.requestId,
        ),
        error.status,
      );
    }

    runtime.logger.error({ err: error }, "请求处理失败");
    return c.json(
      createFailureResponse(
        {
          code: ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
          message: "服务内部错误",
        },
        c.var.requestId,
      ),
      500,
    );
  });

  app.notFound((c) =>
    c.json(
      createFailureResponse(
        { code: ApiErrorCodes.COMMON_NOT_FOUND, message: "接口不存在" },
        c.var.requestId,
      ),
      404,
    ),
  );
};
