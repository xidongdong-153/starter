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
  description: [
    "读取指定 lane 的 transcript。`items` 始终是时间正序。",
    "`direction=backward`（默认）取比 `cursor` 更早的一页，省略 `cursor` 时取最新一页，",
    "`nextCursor` 是本页最早一条 entry 的 sequence，用它继续往更早翻。",
    "`direction=forward` 取比 `cursor` 更新的一页，`nextCursor` 是本页最后一条 entry 的 sequence。",
    "两个方向都在确实还有下一页时才返回 `nextCursor`，否则为 null。",
  ].join(""),
  request: {
    params: sessionParams,
    query: agentTranscriptQuerySchema,
  },
  responses: {
    200: apiSuccessResponse(
      agentTranscriptSchema,
      "Agent Session transcript，items 为时间正序，nextCursor 语义随 direction 变化",
      "AgentTranscriptResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
  },
});
