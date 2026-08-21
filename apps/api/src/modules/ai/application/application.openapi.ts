import {
  aiApplicationParamsSchema,
  aiApplicationSchema,
  aiApplicationSecretSchema,
  createAiApplicationSchema,
} from "@starter/contracts";
import { createRoute, z } from "@hono/zod-openapi";
import {
  apiSuccessResponse,
  conflictResponse,
  forbiddenResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@api/openapi/responses.js";

const tags = ["AI Control"];
const security = [{ cookieAuth: [] }];

export const listAiApplicationsRoute = createRoute({
  method: "get",
  path: "/api/ai/admin/applications",
  tags,
  security,
  responses: {
    200: apiSuccessResponse(
      z.array(aiApplicationSchema),
      "AI 产品应用列表",
      "AiApplicationListResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

export const createAiApplicationRoute = createRoute({
  method: "post",
  path: "/api/ai/admin/applications",
  tags,
  security,
  description: "创建产品应用凭据。secret 只在本次成功响应中返回。",
  request: {
    body: {
      content: { "application/json": { schema: createAiApplicationSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      aiApplicationSecretSchema,
      "新建应用及一次性 secret",
      "CreatedAiApplicationResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    409: conflictResponse,
  },
});

export const rotateAiApplicationRoute = createRoute({
  method: "post",
  path: "/api/ai/admin/applications/{appId}/rotate",
  tags,
  security,
  description:
    "轮换 secret，不改变 tenantId/projectId。secret 只在本次响应返回。",
  request: { params: aiApplicationParamsSchema },
  responses: {
    200: apiSuccessResponse(
      aiApplicationSecretSchema,
      "应用及一次性新 secret",
      "RotatedAiApplicationResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
  },
});

export const revokeAiApplicationRoute = createRoute({
  method: "post",
  path: "/api/ai/admin/applications/{appId}/revoke",
  tags,
  security,
  request: { params: aiApplicationParamsSchema },
  responses: {
    200: apiSuccessResponse(
      aiApplicationSchema,
      "已撤销应用",
      "RevokedAiApplicationResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
  },
});
