import {
  apiFailureSchema,
  apiMetaSchema,
  isoDateTimeSchema,
  okSchema,
} from "@starter/contracts";
import { z } from "@hono/zod-openapi";
import type { ZodType } from "zod";

export { isoDateTimeSchema, okSchema };

export function apiSuccessSchema<TDataSchema extends ZodType>(
  dataSchema: TDataSchema,
  name: string,
) {
  return z
    .object({
      ok: z.literal(true),
      data: dataSchema,
      meta: apiMetaSchema,
    })
    .openapi(name);
}

export function apiSuccessResponse<TDataSchema extends ZodType>(
  dataSchema: TDataSchema,
  description: string,
  name: string,
) {
  return {
    content: {
      "application/json": { schema: apiSuccessSchema(dataSchema, name) },
    },
    description,
  };
}

export function apiFailureResponse(description: string) {
  return {
    content: {
      "application/json": { schema: apiFailureSchema },
    },
    description,
  };
}

export const invalidRequestResponse = apiFailureResponse("请求参数不正确");
export const unauthorizedResponse = apiFailureResponse("未登录");
export const forbiddenResponse = apiFailureResponse("没有权限");
export const notFoundResponse = apiFailureResponse("资源不存在");
export const conflictResponse = apiFailureResponse("状态冲突");
export const payloadTooLargeResponse = apiFailureResponse("请求内容超过限制");
export const internalErrorResponse = apiFailureResponse("服务内部错误");
