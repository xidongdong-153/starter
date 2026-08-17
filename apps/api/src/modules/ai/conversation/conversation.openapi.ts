import {
  aiConversationDetailSchema,
  aiConversationGenerationParamsSchema,
  aiConversationGenerationSchema,
  aiConversationListQuerySchema,
  aiConversationListSchema,
  aiConversationParamsSchema,
  aiConversationStartEventSchema,
  aiConversationSummarySchema,
  createAiConversationSchema,
  retryAiConversationGenerationSchema,
  sendAiConversationMessageSchema,
} from "@starter/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import {
  apiSuccessResponse,
  conflictResponse,
  forbiddenResponse,
  internalErrorResponse,
  invalidRequestResponse,
  notFoundResponse,
  payloadTooLargeResponse,
  unauthorizedResponse,
} from "@api/openapi/responses.js";

const tags = ["AI"];
const security = [{ cookieAuth: [] }];
const conversationResponse = apiSuccessResponse(
  aiConversationSummarySchema,
  "AI 会话",
  "AiConversationResponse",
);
const conversationDetailResponse = apiSuccessResponse(
  aiConversationDetailSchema,
  "AI 会话详情",
  "AiConversationDetailResponse",
);
const streamResponse = {
  content: { "text/event-stream": { schema: z.string() } },
  description: "AI 会话 SSE 流",
};

export const createAiConversationRoute = createRoute({
  method: "post",
  path: "/api/ai/conversations",
  tags,
  security,
  request: {
    body: {
      content: { "application/json": { schema: createAiConversationSchema } },
      required: true,
    },
  },
  responses: {
    200: conversationResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
  },
});

export const listAiConversationsRoute = createRoute({
  method: "get",
  path: "/api/ai/conversations",
  tags,
  security,
  request: { query: aiConversationListQuerySchema },
  responses: {
    200: apiSuccessResponse(
      aiConversationListSchema,
      "AI 会话列表",
      "AiConversationListResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
  },
});

export const getAiConversationRoute = createRoute({
  method: "get",
  path: "/api/ai/conversations/{conversationId}",
  tags,
  security,
  request: { params: aiConversationParamsSchema },
  responses: {
    200: conversationDetailResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
    500: internalErrorResponse,
  },
});

export const deleteAiConversationRoute = createRoute({
  method: "delete",
  path: "/api/ai/conversations/{conversationId}",
  tags,
  security,
  request: { params: aiConversationParamsSchema },
  responses: {
    200: apiSuccessResponse(
      z.object({ deleted: z.literal(true) }),
      "AI 会话已删除",
      "DeletedAiConversationResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

export const sendAiConversationMessageRoute = createRoute({
  method: "post",
  path: "/api/ai/conversations/{conversationId}/messages",
  tags,
  security,
  request: {
    params: aiConversationParamsSchema,
    body: {
      content: {
        "application/json": { schema: sendAiConversationMessageSchema },
      },
      required: true,
    },
  },
  responses: {
    200: streamResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
    413: payloadTooLargeResponse,
    503: internalErrorResponse,
  },
});

export const retryAiConversationRoute = createRoute({
  method: "post",
  path: "/api/ai/conversations/{conversationId}/retry",
  tags,
  security,
  request: {
    params: aiConversationParamsSchema,
    body: {
      content: {
        "application/json": { schema: retryAiConversationGenerationSchema },
      },
      required: true,
    },
  },
  responses: {
    200: streamResponse,
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    409: conflictResponse,
    413: payloadTooLargeResponse,
    503: internalErrorResponse,
  },
});

export const stopAiConversationGenerationRoute = createRoute({
  method: "post",
  path: "/api/ai/conversations/{conversationId}/generations/{generationId}/stop",
  tags,
  security,
  request: { params: aiConversationGenerationParamsSchema },
  responses: {
    200: apiSuccessResponse(
      aiConversationGenerationSchema,
      "AI generation 已停止",
      "StoppedAiGenerationResponse",
    ),
    202: apiSuccessResponse(
      aiConversationGenerationSchema,
      "AI generation 停止请求已接受",
      "StoppingAiGenerationResponse",
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
});

export { aiConversationStartEventSchema };
