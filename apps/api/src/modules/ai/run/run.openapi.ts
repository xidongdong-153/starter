import {
  activeAgentRunQuerySchema,
  agentRunSchema,
  followUpAgentRunSchema,
  runTimelineQuerySchema,
  runTimelineSchema,
  runTraceSchema,
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
const security: Array<Record<string, string[]>> = [
  { cookieAuth: [] },
  { bearerAuth: [] },
];

const runParams = z.strictObject({
  sessionId: uuidSchema,
  runId: uuidSchema,
});
const sessionParams = z.strictObject({ sessionId: uuidSchema });

const timelineResponse = apiSuccessResponse(
  runTimelineSchema,
  "Run Timeline",
  "RunTimelineResponse",
);
const traceResponse = apiSuccessResponse(
  runTraceSchema,
  "Run Trace",
  "RunTraceResponse",
);
const timelineRequest = {
  params: runParams,
  query: runTimelineQuerySchema,
};

export const getAgentRunTimelineRoute = createRoute({
  method: "get",
  path: "/api/ai/sessions/{sessionId}/runs/{runId}/timeline",
  tags,
  security,
  request: timelineRequest,
  responses: {
    200: timelineResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

export const getAgentRunEventsRoute = createRoute({
  method: "get",
  path: "/api/ai/sessions/{sessionId}/runs/{runId}/events",
  tags,
  security,
  request: timelineRequest,
  responses: {
    200: timelineResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

export const getAgentRunTraceRoute = createRoute({
  method: "get",
  path: "/api/ai/sessions/{sessionId}/runs/{runId}/trace",
  tags,
  security,
  request: { params: runParams },
  responses: {
    200: traceResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

const runResponse = apiSuccessResponse(
  agentRunSchema,
  "Agent Run",
  "AgentRunResponse",
);
const streamResponse = {
  content: { "text/event-stream": { schema: z.string() } },

  description: [
    "Agent Run RunEvent SSE 流。SSE id 对应 eventId，event 对应 type，data 是完整 RunEvent JSON。",
    "sequence 在单个 Run 内严格递增，只有 run.completed、run.failed 或 run.aborted 之一会作为唯一终态事件。",
    "连接断开不会中止 Run；创建流使用 POST，已有 Run 的恢复使用 /events/stream，Run 终态后读取 Timeline 或 Session transcript。",
  ].join(""),
};

const streamRequest = {
  params: sessionParams,
  body: {
    content: {
      "application/json": { schema: startAgentRunSchema },
    },
    required: true,
  },
};

export const startAgentRunRoute = createRoute({
  method: "post",
  path: "/api/ai/sessions/{sessionId}/runs",
  tags,
  security,
  description:
    "启动 Agent Run 并返回 RunEvent SSE。事件写入持久时间线成功后才发送；连接断开不会改变 Run。",
  request: streamRequest,
  responses: {
    200: streamResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

export const getAgentRunEventsStreamRoute = createRoute({
  method: "get",
  path: "/api/ai/sessions/{sessionId}/runs/{runId}/events/stream",
  tags,
  security,
  description:
    "恢复已有 Run 的 RunEvent SSE。支持 afterSequence 和 Last-Event-ID，不会创建新的 Run。",
  request: { params: runParams, query: runTimelineQuerySchema },
  responses: {
    200: streamResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
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

export const getActiveAgentRunRoute = createRoute({
  method: "get",
  path: "/api/ai/sessions/{sessionId}/active-run",
  tags,
  security,
  description:
    "查该 Session 指定 lane 上仍在跑的 Run，用于刷新页面后找回 runId。只返回 starting 和 running 的 Run，没有时 data 为 null。",
  request: { params: sessionParams, query: activeAgentRunQuerySchema },
  responses: {
    200: apiSuccessResponse(
      agentRunSchema.nullable(),
      "Session 进行中的 Agent Run",
      "ActiveAgentRunResponse",
    ),
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
