import {
  aiModelCallAuditDetailSchema,
  aiModelCallAuditListSchema,
  aiModelCallAuditQuerySchema,
  uuidSchema,
} from '@starter/contracts'
import { createRoute, z } from '@hono/zod-openapi'

import {
  apiSuccessResponse,
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
} from '@api/openapi/responses.js'

const tags = ['AI Control']
const security = [{ cookieAuth: [] }]

export const listAiUsageAuditRoute = createRoute({
  method: 'get',
  path: '/api/ai/usage/calls',
  tags,
  security,
  request: { query: aiModelCallAuditQuerySchema },
  responses: {
    200: apiSuccessResponse(aiModelCallAuditListSchema, 'AI 模型调用审计列表', 'AiModelCallAuditListResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
})

export const getAiUsageAuditRoute = createRoute({
  method: 'get',
  path: '/api/ai/usage/calls/{callId}',
  tags,
  security,
  request: { params: z.object({ callId: uuidSchema }) },
  responses: {
    200: apiSuccessResponse(aiModelCallAuditDetailSchema, 'AI 模型调用审计详情', 'AiModelCallAuditDetailResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})
