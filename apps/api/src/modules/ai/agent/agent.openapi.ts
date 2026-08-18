import {
  agentDefinitionConfigSchema,
  agentDefinitionDetailListSchema,
  aiToolSummarySchema,
  agentDefinitionDetailSchema,
  agentDefinitionListQuerySchema,
  agentDefinitionStatusSchema,
  agentDefinitionSummaryListSchema,
  agentDefinitionSummarySchema,
  createAgentDefinitionSchema,
  updateAgentDefinitionSchema,
  updateAgentDefinitionStatusSchema,
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

const tags = ["AI"];
const security = [{ cookieAuth: [] }];
const agentParams = z.strictObject({ agentId: uuidSchema });
const agentQuery = agentDefinitionListQuerySchema;

export const listPublicAgentDefinitionsRoute = createRoute({
  method: "get",
  path: "/api/ai/agents",
  tags,
  security,
  request: { query: agentQuery },
  responses: {
    200: apiSuccessResponse(
      agentDefinitionSummaryListSchema,
      "已启用的 Agent 列表",
      "AgentDefinitionSummaryListResponse",
    ),
    401: unauthorizedResponse,
  },
});

export const getPublicAgentDefinitionRoute = createRoute({
  method: "get",
  path: "/api/ai/agents/{agentId}",
  tags,
  security,
  request: { params: agentParams },
  responses: {
    200: apiSuccessResponse(
      agentDefinitionSummarySchema,
      "已启用的 Agent",
      "AgentDefinitionSummaryResponse",
    ),
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

export const listAdminAgentDefinitionsRoute = createRoute({
  method: "get",
  path: "/api/ai/admin/agents",
  tags,
  security,
  request: { query: agentQuery },
  responses: {
    200: apiSuccessResponse(
      agentDefinitionDetailListSchema,
      "Agent 配置列表",
      "AdminAgentDefinitionDetailListResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    500: internalErrorResponse,
  },
});

export const listAdminAiToolsRoute = createRoute({
  method: "get",
  path: "/api/ai/admin/tools",
  tags,
  security,
  responses: {
    200: apiSuccessResponse(
      z.array(aiToolSummarySchema),
      "工具注册表列表",
      "AiToolSummaryListResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
});

export const getAdminAgentDefinitionRoute = createRoute({
  method: "get",
  path: "/api/ai/admin/agents/{agentId}",
  tags,
  security,
  request: { params: agentParams },
  responses: {
    200: apiSuccessResponse(
      agentDefinitionDetailSchema,
      "Agent 配置详情",
      "AdminAgentDefinitionDetailResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
  },
});

export const createAdminAgentDefinitionRoute = createRoute({
  method: "post",
  path: "/api/ai/admin/agents",
  tags,
  security,
  request: {
    body: {
      content: { "application/json": { schema: createAgentDefinitionSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      agentDefinitionDetailSchema,
      "创建 Agent 配置",
      "CreatedAgentDefinitionResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

export const updateAdminAgentDefinitionRoute = createRoute({
  method: "patch",
  path: "/api/ai/admin/agents/{agentId}",
  tags,
  security,
  request: {
    params: agentParams,
    body: {
      content: { "application/json": { schema: updateAgentDefinitionSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      agentDefinitionDetailSchema,
      "更新 Agent 配置",
      "UpdatedAgentDefinitionResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

export const updateAdminAgentDefinitionStatusRoute = createRoute({
  method: "patch",
  path: "/api/ai/admin/agents/{agentId}/status",
  tags,
  security,
  request: {
    params: agentParams,
    body: {
      content: {
        "application/json": { schema: updateAgentDefinitionStatusSchema },
      },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      agentDefinitionDetailSchema,
      "更新 Agent 状态",
      "UpdatedAgentDefinitionStatusResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

export { agentDefinitionConfigSchema, agentDefinitionStatusSchema };
