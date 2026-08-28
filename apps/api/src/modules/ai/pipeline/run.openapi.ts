import {
  pipelineRunAbortSchema,
  pipelineRunSchema,
  startPipelineRunJsonSchema,
  startPipelineRunSchema,
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

const tags = ["AI Runtime"];
const security: Array<Record<string, string[]>> = [
  { cookieAuth: [] },
  { bearerAuth: [] },
];

export const startPipelineRunRoute = createRoute({
  method: "post",
  path: "/api/ai/pipelines/{pipelineId}/runs",
  tags,
  security,
  description:
    "启动一条流水线：服务端创建专用 Agent Session 并顺序执行每个步骤的 Agent Run，异步推进到终态。返回 pipeline runId，调用方轮询 GET /api/ai/pipeline-runs/{runId}。",
  request: {
    params: z.strictObject({ pipelineId: uuidSchema }),
    body: {
      content: { "application/json": { schema: startPipelineRunSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      startPipelineRunJsonSchema,
      "启动 Pipeline Run",
      "StartPipelineRunResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
  },
});

export const getPipelineRunRoute = createRoute({
  method: "get",
  path: "/api/ai/pipeline-runs/{runId}",
  tags,
  security,
  description:
    "查询 Pipeline Run：状态、步骤明细（每步 agentId、agentRevision、runId、状态、产出摘要——截断到 1000 字符）、最终产出与专用 sessionId。步骤 runId 可独立查询 transcript。",
  request: {
    params: z.strictObject({ runId: uuidSchema }),
  },
  responses: {
    200: apiSuccessResponse(
      pipelineRunSchema,
      "Pipeline Run 详情",
      "PipelineRunResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
  },
});

export const abortPipelineRunRoute = createRoute({
  method: "post",
  path: "/api/ai/pipeline-runs/{runId}/abort",
  tags,
  security,
  description:
    "取消进行中的 Pipeline Run：abort 当前正在执行的步骤 Run，后续步骤不启动。终态切换异步生效，调用方继续轮询查询端点。",
  request: {
    params: z.strictObject({ runId: uuidSchema }),
  },
  responses: {
    200: apiSuccessResponse(
      pipelineRunAbortSchema,
      "取消 Pipeline Run",
      "AbortPipelineRunResponse",
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
    500: internalErrorResponse,
  },
});
