import {
  adminAiModelSchema,
  adminAiModelsResponseSchema,
  adminAiProviderSchema,
  aiModelRefSchema,
  aiProviderParamsSchema,
  aiTestInputSchema,
  aiUserModelSchema,
  aiUserPreferenceSchema,
  replaceAiEnabledModelsSchema,
  updateAiDefaultModelSchema,
  updateAiPreferenceSchema,
  updateAiProviderConfigSchema,
  updateAiProviderStateSchema,
} from "@starter/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import {
  apiSuccessResponse,
  conflictResponse,
  forbiddenResponse,
  internalErrorResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@api/openapi/responses.js";

const controlTags = ["AI Control"];
const compatibilityTags = ["AI Compatibility"];
const tags = controlTags;
const security = [{ cookieAuth: [] }];
const providerResponse = apiSuccessResponse(
  adminAiProviderSchema,
  "AI Provider 配置",
  "AdminAiProviderResponse",
);
const adminModelsResponse = apiSuccessResponse(
  adminAiModelsResponseSchema,
  "管理员模型目录",
  "AdminAiModelsResponse",
);

export const listAiProvidersRoute = createRoute({
  method: "get",
  path: "/api/ai/admin/providers",
  tags,
  security,
  responses: {
    200: apiSuccessResponse(
      z.array(adminAiProviderSchema),
      "AI Provider 列表",
      "AdminAiProvidersResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    500: internalErrorResponse,
  },
});

export const updateAiProviderConfigRoute = createRoute({
  method: "put",
  path: "/api/ai/admin/providers/{providerId}/config",
  tags,
  security,
  request: {
    params: aiProviderParamsSchema,
    body: {
      content: { "application/json": { schema: updateAiProviderConfigSchema } },
      required: true,
    },
  },
  responses: {
    200: providerResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
    503: internalErrorResponse,
  },
});

export const clearAiProviderCredentialRoute = createRoute({
  method: "delete",
  path: "/api/ai/admin/providers/{providerId}/credential",
  tags,
  security,
  request: { params: aiProviderParamsSchema },
  responses: {
    200: providerResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
    503: internalErrorResponse,
  },
});

export const checkAiProviderRoute = createRoute({
  method: "post",
  path: "/api/ai/admin/providers/{providerId}/check",
  tags,
  security,
  request: { params: aiProviderParamsSchema },
  responses: {
    200: providerResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
    503: internalErrorResponse,
  },
});

export const updateAiProviderStateRoute = createRoute({
  method: "put",
  path: "/api/ai/admin/providers/{providerId}/state",
  tags,
  security,
  request: {
    params: aiProviderParamsSchema,
    body: {
      content: { "application/json": { schema: updateAiProviderStateSchema } },
      required: true,
    },
  },
  responses: {
    200: providerResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
  },
});

export const refreshAiProviderRoute = createRoute({
  method: "post",
  path: "/api/ai/admin/providers/{providerId}/refresh",
  tags,
  security,
  request: { params: aiProviderParamsSchema },
  responses: {
    200: adminModelsResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    503: internalErrorResponse,
  },
});

export const listAdminAiModelsRoute = createRoute({
  method: "get",
  path: "/api/ai/admin/models",
  tags,
  security,
  responses: {
    200: adminModelsResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

export const replaceAdminAiModelsRoute = createRoute({
  method: "put",
  path: "/api/ai/admin/models",
  tags,
  security,
  request: {
    body: {
      content: { "application/json": { schema: replaceAiEnabledModelsSchema } },
      required: true,
    },
  },
  responses: {
    200: adminModelsResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
  },
});

export const updateAdminAiDefaultRoute = createRoute({
  method: "put",
  path: "/api/ai/admin/default-model",
  tags,
  security,
  request: {
    body: {
      content: { "application/json": { schema: updateAiDefaultModelSchema } },
      required: true,
    },
  },
  responses: {
    200: adminModelsResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

export const listUserAiModelsRoute = createRoute({
  method: "get",
  path: "/api/ai/models",
  tags: compatibilityTags,
  security,
  responses: {
    200: apiSuccessResponse(
      z.array(aiUserModelSchema),
      "当前用户可用的模型",
      "AiUserModelsResponse",
    ),
    401: unauthorizedResponse,
  },
});

export const getAiPreferenceRoute = createRoute({
  method: "get",
  path: "/api/ai/preferences",
  tags: compatibilityTags,
  security,
  responses: {
    200: apiSuccessResponse(
      aiUserPreferenceSchema,
      "当前用户 AI 偏好",
      "AiUserPreferenceResponse",
    ),
    401: unauthorizedResponse,
  },
});

export const updateAiPreferenceRoute = createRoute({
  method: "put",
  path: "/api/ai/preferences",
  tags: compatibilityTags,
  security,
  request: {
    body: {
      content: { "application/json": { schema: updateAiPreferenceSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      aiUserPreferenceSchema,
      "更新后的 AI 偏好",
      "UpdatedAiUserPreferenceResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

export const testAiModelRoute = createRoute({
  method: "post",
  path: "/api/ai/test",
  tags,
  security,
  request: {
    body: {
      content: { "application/json": { schema: aiTestInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "text/event-stream": { schema: z.string() } },
      description: "模型测试 SSE 流",
    },
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    503: internalErrorResponse,
  },
});

export { adminAiModelSchema, aiModelRefSchema };
