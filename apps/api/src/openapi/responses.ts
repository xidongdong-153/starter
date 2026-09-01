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

/**
 * 产品薄代理路由（/api/chat、/api/flow）的通用成功响应：data 不展开具体 schema。
 *
 * 原因：AppType（routes/index.ts 推断类型）已接近 TS 声明序列化上限，
 * 产品面再复制一份 AI 响应 schema 会触发 TS7056。响应 data 由同一个
 * service 产出、与对应 /api/ai/* 端点同构，调用方用 contracts schema
 * 运行时校验；请求侧 schema 保持精确，typed client 的入参类型不受影响。
 */
export function genericSuccessResponse(description: string) {
  return apiSuccessResponse(z.unknown(), description, "GenericSuccessResponse");
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
