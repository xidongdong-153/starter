import {
  agentDefinitionListQuerySchema,
  agentTranscriptQuerySchema,
  createAgentSessionSchema,
  startAgentRunJsonSchema,
  startAgentRunSchema,
  uuidSchema,
} from "@starter/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import {
  apiSuccessSchema,
  conflictResponse,
  genericSuccessResponse,
  internalErrorResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@api/openapi/responses.js";

/**
 * Flow 产品模块的 OpenAPI 路由定义。
 *
 * 薄代理：路径挂在 /api/flow/* 下，请求 schema 复用 `@starter/contracts`
 * 的 AI Runtime 契约；响应 data 用通用成功信封（AppType 类型体积预算，
 * 见 responses.ts 的 genericSuccessResponse 注释），结构由 service 层
 * 与对应 /api/ai/* 端点同源保证。
 */
const tags = ["Flow"];
const security: Array<Record<string, string[]>> = [{ cookieAuth: [] }];

const sessionParams = z.strictObject({ sessionId: uuidSchema });
const runParams = z.strictObject({
  sessionId: uuidSchema,
  runId: uuidSchema,
});

export const listFlowAgentsRoute = createRoute({
  method: "get",
  path: "/api/flow/agents",
  tags,
  security,
  request: { query: agentDefinitionListQuerySchema },
  responses: {
    200: genericSuccessResponse(
      "已启用的 Agent 列表；data 与 GET /api/ai/agents 同构",
    ),
    401: unauthorizedResponse,
  },
});

export const createFlowSessionRoute = createRoute({
  method: "post",
  path: "/api/flow/sessions",
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
    200: genericSuccessResponse(
      "创建的 Agent Session；data 与 POST /api/ai/sessions 同构",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});

export const getFlowSessionTranscriptRoute = createRoute({
  method: "get",
  path: "/api/flow/sessions/{sessionId}/transcript",
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
    200: genericSuccessResponse(
      "Agent Session transcript；data 与 GET /api/ai/sessions/{sessionId}/transcript 同构，items 为时间正序，nextCursor 语义随 direction 变化",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
  },
});

export const getFlowRunRoute = createRoute({
  method: "get",
  path: "/api/flow/sessions/{sessionId}/runs/{runId}",
  tags,
  security,
  description:
    "读取 Run 持久状态和可选 live snapshot。live 只在当前 API 进程仍持有 starting/running Run 时存在，不是历史记录；终态历史从 Session transcript 读取。",
  request: { params: runParams },
  responses: {
    200: genericSuccessResponse(
      "Agent Run；data 与 GET /api/ai/sessions/{sessionId}/runs/{runId} 同构",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

export const abortFlowRunRoute = createRoute({
  method: "post",
  path: "/api/flow/sessions/{sessionId}/runs/{runId}/abort",
  tags,
  security,
  request: { params: runParams },
  responses: {
    200: genericSuccessResponse(
      "Agent Run；data 与 POST /api/ai/sessions/{sessionId}/runs/{runId}/abort 同构",
    ),
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
  },
});

export const getFlowRunStructuredOutputsRoute = createRoute({
  method: "get",
  path: "/api/flow/sessions/{sessionId}/runs/{runId}/structured-outputs",
  tags,
  security,
  description:
    "读取 Run 的结构化输出列表。contract 已从代码注册表移除的记录不返回；value 按 contract 可见性打码：admin 可见性对运行面主体为 null。",
  request: { params: runParams },
  responses: {
    200: genericSuccessResponse(
      "Structured Output List；data 与 GET /api/ai/sessions/{sessionId}/runs/{runId}/structured-outputs 同构",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

export const startFlowRunRoute = createRoute({
  method: "post",
  path: "/api/flow/sessions/{sessionId}/runs",
  tags,
  security,
  description: [
    "启动 Agent Run，按 Accept 分流返回 RunEvent SSE 或 JSON（只含 runId）。事件写入持久时间线成功后才发送；连接断开不会改变 Run。",
    "body 可选 idempotencyKey：同一调用方 scope 内相同 key 的重复启动返回既有 Run（SSE 模式从 sequence 0 回放该 Run 事件），不新建 Run；",
    "同 key 已绑定其他 session 时返回 409 AI.IDEMPOTENCY_KEY_CONFLICT；不同调用方（不同应用或用户）使用相同 key 互不相关。",
    "key 只在 Run 行创建成功后被消费：lane 占用（AI.SESSION_BUSY）、参数校验失败、Session 或 Agent 不存在等启动前失败不消费 key，之后同 key 重试会创建新 Run。",
    "Run 已终态（含 failed）后同 key 重试返回那个 Run，不重新执行；需要重跑请换新 key。",
  ].join(""),
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
    200: {
      content: {
        "text/event-stream": { schema: z.string() },
        "application/json": {
          schema: apiSuccessSchema(
            startAgentRunJsonSchema,
            "AgentRunStartJsonResponse",
          ),
        },
      },
      description: [
        "Agent Run RunEvent SSE 流。SSE id 对应 eventId，event 对应 type，data 是完整 RunEvent JSON。",
        "sequence 在单个 Run 内严格递增，只有 run.completed、run.failed 或 run.aborted 之一会作为唯一终态事件。",
        "连接断开不会中止 Run；创建流使用 POST，已有 Run 的恢复使用 /events/stream，Run 终态后读取 Timeline 或 Session transcript。",
        "Accept 含 application/json 且不含 text/event-stream 时返回 JSON（只含 runId，Run 在后台照常执行，用 GET /runs/{runId} 轮询）。",
      ].join(""),
    },
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});
