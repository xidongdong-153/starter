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

const tags = ["AI Runtime"];
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
  description: [
    "Agent Run HarnessEvent SSE 流。SSE id 对应 eventId，event 对应 type，data 是完整 HarnessEvent JSON。",
    "sequence 在单个 Run 内严格递增，只有 run.completed、run.failed 或 run.aborted 之一会作为唯一终态事件。",
    "连接断开不会中止 Run；重连后先查询 Run live snapshot，Run 终态后读取 Session transcript。",
  ].join(""),
};

export const startAgentRunRoute = createRoute({
  method: "post",
  path: "/api/ai/sessions/{sessionId}/runs",
  tags,
  security,
  description:
    "启动 Agent Run 并返回 HarnessEvent SSE。当前接口使用 Starter Cookie 兼容认证；后续产品应用认证不会改变事件协议。",
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
  description:
    "读取 Run 持久状态和可选 live snapshot。live 只在当前 API 进程仍持有 starting/running Run 时存在，不是历史记录；终态历史从 Session transcript 读取。",
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
