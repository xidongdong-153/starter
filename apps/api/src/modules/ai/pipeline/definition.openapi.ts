import {
  createPipelineDefinitionSchema,
  pipelineDefinitionDetailSchema,
  pipelineDefinitionListQuerySchema,
  pipelineDefinitionStatusSchema,
  pipelineDefinitionSummaryListSchema,
  updatePipelineDefinitionSchema,
  updatePipelineDefinitionStatusSchema,
  uuidSchema,
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

const tags = ["AI Control"];
const security = [{ cookieAuth: [] }];
const pipelineParams = z.strictObject({ pipelineId: uuidSchema });
const pipelineQuery = pipelineDefinitionListQuerySchema;

export const listAdminPipelinesRoute = createRoute({
  method: "get",
  path: "/api/ai/admin/pipelines",
  tags,
  security,
  request: { query: pipelineQuery },
  responses: {
    200: apiSuccessResponse(
      pipelineDefinitionSummaryListSchema,
      "Pipeline 配置列表",
      "AdminPipelineDefinitionSummaryListResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    500: internalErrorResponse,
  },
});

export const createAdminPipelineRoute = createRoute({
  method: "post",
  path: "/api/ai/admin/pipelines",
  tags,
  security,
  request: {
    body: {
      content: {
        "application/json": { schema: createPipelineDefinitionSchema },
      },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      pipelineDefinitionDetailSchema,
      "创建 Pipeline 配置",
      "CreatedPipelineDefinitionResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

export const getAdminPipelineRoute = createRoute({
  method: "get",
  path: "/api/ai/admin/pipelines/{pipelineId}",
  tags,
  security,
  request: { params: pipelineParams },
  responses: {
    200: apiSuccessResponse(
      pipelineDefinitionDetailSchema,
      "Pipeline 配置详情",
      "AdminPipelineDefinitionDetailResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
  },
});

export const updateAdminPipelineRoute = createRoute({
  method: "patch",
  path: "/api/ai/admin/pipelines/{pipelineId}",
  tags,
  security,
  request: {
    params: pipelineParams,
    body: {
      content: {
        "application/json": { schema: updatePipelineDefinitionSchema },
      },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      pipelineDefinitionDetailSchema,
      "更新 Pipeline 配置",
      "UpdatedPipelineDefinitionResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

export const updateAdminPipelineStatusRoute = createRoute({
  method: "patch",
  path: "/api/ai/admin/pipelines/{pipelineId}/status",
  tags,
  security,
  request: {
    params: pipelineParams,
    body: {
      content: {
        "application/json": { schema: updatePipelineDefinitionStatusSchema },
      },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      pipelineDefinitionDetailSchema,
      "更新 Pipeline 状态",
      "UpdatedPipelineDefinitionStatusResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

export { pipelineDefinitionStatusSchema };
