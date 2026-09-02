import { completionRequestSchema, completionResultSchema } from '@starter/contracts'
import { createRoute, z } from '@hono/zod-openapi'

import {
  apiFailureResponse,
  apiSuccessSchema,
  forbiddenResponse,
  invalidRequestResponse,
  unauthorizedResponse,
} from '@api/openapi/responses.js'

const tags = ['AI Runtime']
const security: Array<Record<string, string[]>> = [{ cookieAuth: [] }, { bearerAuth: [] }]

export const createCompletionRoute = createRoute({
  method: 'post',
  path: '/api/ai/completions',
  tags,
  security,
  description:
    '一次性无状态模型调用：指定白名单内模型加一段输入，同步拿单轮结果。不创建 Agent Session、Run 或历史记录。Accept 为 application/json（且不含 text/event-stream）时返回完整 JSON 结果，其余 Accept 返回 SSE 流（text_delta / done / error 事件）。',
  request: {
    body: {
      content: { 'application/json': { schema: completionRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'JSON 模式返回完整结果；SSE 模式返回 text/event-stream 流',
      content: {
        'application/json': {
          schema: apiSuccessSchema(completionResultSchema, 'AiCompletionResponse'),
        },
        'text/event-stream': { schema: z.string() },
      },
    },
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    503: apiFailureResponse('模型服务暂时不可用'),
    504: apiFailureResponse('模型响应超时'),
  },
})
