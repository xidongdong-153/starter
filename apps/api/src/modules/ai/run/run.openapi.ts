import {
  agentRunSchema,
  followUpAgentRunSchema,
  startAgentRunSchema,
  steerAgentRunSchema,
  uuidSchema,
} from "@starter/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import {
  apiSuccessResponse,
  conflictResponse,
  internalErrorResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@api/openapi/responses.js";

const tags = ["AI"];
const security = [{ cookieAuth: [] }];

const runParams = z.strictObject({
  sessionId: uuidSchema,
  runId: uuidSchema,
});
const sessionParams = z.strictObject({ sessionId: uuidSchema });

const runResponse = apiSuccessResponse(
  agentRunSchema,
  "Agent Run",
  "AgentRunResponse",
);
const streamResponse = {
  content: { "text/event-stream": { schema: z.string() } },
  description: "Agent Run SSE 流",
};

export const startAgentRunRoute = createRoute({
  method: "post",
  path: "/api/ai/sessions/{sessionId}/runs",
  tags,
  security,
  request: {
    params: sessionParams,
    body: {
      content: {
        "application/json": { schema: startAgentRunSchema },
      },
      required: true,
    },
  },
  responses: {
    200: streamResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

export const getAgentRunRoute = createRoute({
  method: "get",
  path: "/api/ai/sessions/{sessionId}/runs/{runId}",
  tags,
  security,
  request: { params: runParams },
  responses: {
    200: runResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

export const abortAgentRunRoute = createRoute({
  method: "post",
  path: "/api/ai/sessions/{sessionId}/runs/{runId}/abort",
  tags,
  security,
  request: { params: runParams },
  responses: {
    200: runResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
  },
});

export const steerAgentRunRoute = createRoute({
  method: "post",
  path: "/api/ai/sessions/{sessionId}/runs/{runId}/steer",
  tags,
  security,
  request: {
    params: runParams,
    body: {
      content: {
        "application/json": { schema: steerAgentRunSchema },
      },
      required: true,
    },
  },
  responses: {
    200: runResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
  },
});

export const followUpAgentRunRoute = createRoute({
  method: "post",
  path: "/api/ai/sessions/{sessionId}/runs/{runId}/follow-ups",
  tags,
  security,
  request: {
    params: runParams,
    body: {
      content: {
        "application/json": { schema: followUpAgentRunSchema },
      },
      required: true,
    },
  },
  responses: {
    200: runResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
  },
});
