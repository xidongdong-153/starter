import {
  agentSessionListQuerySchema,
  agentSessionListSchema,
  agentSessionSchema,
  agentTranscriptQuerySchema,
  agentTranscriptSchema,
  createAgentSessionSchema,
  updateAgentSessionSchema,
  uuidSchema,
} from "@starter/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import {
  apiSuccessResponse,
  conflictResponse,
  invalidRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@api/openapi/responses.js";

const tags = ["AI"];
const security = [{ cookieAuth: [] }];
const sessionParams = z.strictObject({ sessionId: uuidSchema });

export const createAgentSessionRoute = createRoute({
  method: "post",
  path: "/api/ai/sessions",
  tags,
  security,
  request: {
    body: {
      content: {
        "application/json": { schema: createAgentSessionSchema },
      },
    },
  },
  responses: {
    200: apiSuccessResponse(
      agentSessionSchema,
      "创建的 Agent Session",
      "AgentSessionResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

export const listAgentSessionsRoute = createRoute({
  method: "get",
  path: "/api/ai/sessions",
  tags,
  security,
  request: { query: agentSessionListQuerySchema },
  responses: {
    200: apiSuccessResponse(
      agentSessionListSchema,
      "Agent Session 列表",
      "AgentSessionListResponse",
    ),
    401: unauthorizedResponse,
  },
});

export const getAgentSessionRoute = createRoute({
  method: "get",
  path: "/api/ai/sessions/{sessionId}",
  tags,
  security,
  request: { params: sessionParams },
  responses: {
    200: apiSuccessResponse(
      agentSessionSchema,
      "Agent Session 详情",
      "AgentSessionResponse",
    ),
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

export const updateAgentSessionRoute = createRoute({
  method: "patch",
  path: "/api/ai/sessions/{sessionId}",
  tags,
  security,
  request: {
    params: sessionParams,
    body: {
      content: {
        "application/json": { schema: updateAgentSessionSchema },
      },
    },
  },
  responses: {
    200: apiSuccessResponse(
      agentSessionSchema,
      "更新的 Agent Session",
      "AgentSessionResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

export const deleteAgentSessionRoute = createRoute({
  method: "delete",
  path: "/api/ai/sessions/{sessionId}",
  tags,
  security,
  request: { params: sessionParams },
  responses: {
    200: apiSuccessResponse(
      agentSessionSchema,
      "归档后的 Agent Session",
      "AgentSessionResponse",
    ),
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

export const getAgentSessionTranscriptRoute = createRoute({
  method: "get",
  path: "/api/ai/sessions/{sessionId}/transcript",
  tags,
  security,
  request: {
    params: sessionParams,
    query: agentTranscriptQuerySchema,
  },
  responses: {
    200: apiSuccessResponse(
      agentTranscriptSchema,
      "Agent Session transcript",
      "AgentTranscriptResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
  },
});
