import { z } from "@hono/zod-openapi";
import type { ZodType } from "zod";

export const isoDateTimeSchema = z.iso.datetime();

export const apiMetaSchema = z
  .object({
    requestId: z.string(),
    timestamp: isoDateTimeSchema,
  })
  .openapi("ApiMeta");

export const apiErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  })
  .openapi("ApiError");

export const apiFailureSchema = z
  .object({
    ok: z.literal(false),
    error: apiErrorSchema,
    meta: apiMetaSchema,
  })
  .openapi("ApiFailure");

export function apiSuccessSchema(dataSchema: ZodType, name: string) {
  return z
    .object({
      ok: z.literal(true),
      data: dataSchema,
      meta: apiMetaSchema,
    })
    .openapi(name);
}

export function apiSuccessResponse(
  dataSchema: ZodType,
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

export const okSchema = z.object({ ok: z.literal(true) });

export const invalidRequestResponse = apiFailureResponse("请求参数不正确");
export const unauthorizedResponse = apiFailureResponse("未登录");
export const forbiddenResponse = apiFailureResponse("没有权限");
export const notFoundResponse = apiFailureResponse("资源不存在");
export const internalErrorResponse = apiFailureResponse("服务内部错误");
