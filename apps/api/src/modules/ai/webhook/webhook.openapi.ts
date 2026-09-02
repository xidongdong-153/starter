import {
  aiWebhookDeliveryListSchema,
  aiWebhookDeliveryQuerySchema,
  aiWebhookEndpointListQuerySchema,
  aiWebhookEndpointParamsSchema,
  aiWebhookEndpointSchema,
  aiWebhookEndpointSecretSchema,
  aiWebhookTestResultSchema,
  createAiWebhookEndpointSchema,
  updateAiWebhookEndpointSchema,
} from '@starter/contracts'
import { createRoute, z } from '@hono/zod-openapi'
import {
  apiSuccessResponse,
  forbiddenResponse,
  internalErrorResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from '@api/openapi/responses.js'

const tags = ['AI Control']
const security = [{ cookieAuth: [] }]

export const listAiWebhookEndpointsRoute = createRoute({
  method: 'get',
  path: '/api/ai/admin/webhook-endpoints',
  tags,
  security,
  description: '列出应用凭据下的 Webhook 端点，不返回 signingSecret。',
  request: { query: aiWebhookEndpointListQuerySchema },
  responses: {
    200: apiSuccessResponse(z.array(aiWebhookEndpointSchema), 'Webhook 端点列表', 'AiWebhookEndpointListResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})

export const createAiWebhookEndpointRoute = createRoute({
  method: 'post',
  path: '/api/ai/admin/webhook-endpoints',
  tags,
  security,
  description: '创建 Webhook 端点。URL 需通过出站安全检查；signingSecret 只在本次成功响应中返回。',
  request: {
    body: {
      content: {
        'application/json': { schema: createAiWebhookEndpointSchema },
      },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(
      aiWebhookEndpointSecretSchema,
      '新建端点及一次性 signingSecret',
      'CreatedAiWebhookEndpointResponse',
    ),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    503: internalErrorResponse,
  },
})

export const updateAiWebhookEndpointRoute = createRoute({
  method: 'patch',
  path: '/api/ai/admin/webhook-endpoints/{endpointId}',
  tags,
  security,
  description: '更新端点 URL 或状态；url 变更需要重新通过出站安全检查。',
  request: {
    params: aiWebhookEndpointParamsSchema,
    body: {
      content: {
        'application/json': { schema: updateAiWebhookEndpointSchema },
      },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(aiWebhookEndpointSchema, '更新后的端点', 'UpdatedAiWebhookEndpointResponse'),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})

export const rotateAiWebhookEndpointRoute = createRoute({
  method: 'post',
  path: '/api/ai/admin/webhook-endpoints/{endpointId}/rotate',
  tags,
  security,
  description: '轮换 signingSecret，旧 secret 立即失效。新 secret 只在本次响应返回。',
  request: { params: aiWebhookEndpointParamsSchema },
  responses: {
    200: apiSuccessResponse(
      aiWebhookEndpointSecretSchema,
      '端点及一次性新 signingSecret',
      'RotatedAiWebhookEndpointResponse',
    ),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
    503: internalErrorResponse,
  },
})

export const deleteAiWebhookEndpointRoute = createRoute({
  method: 'delete',
  path: '/api/ai/admin/webhook-endpoints/{endpointId}',
  tags,
  security,
  description: '删除端点，投递记录级联删除。',
  request: { params: aiWebhookEndpointParamsSchema },
  responses: {
    200: apiSuccessResponse(aiWebhookEndpointSchema, '已删除的端点', 'DeletedAiWebhookEndpointResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})

export const testAiWebhookEndpointRoute = createRoute({
  method: 'post',
  path: '/api/ai/admin/webhook-endpoints/{endpointId}/test',
  tags,
  security,
  description: '向端点同步发送一条 webhook.test 探测请求，不写投递记录。签名规则与正式投递一致。',
  request: { params: aiWebhookEndpointParamsSchema },
  responses: {
    200: apiSuccessResponse(aiWebhookTestResultSchema, '探测结果', 'AiWebhookTestResultResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})

export const listAiWebhookDeliveriesRoute = createRoute({
  method: 'get',
  path: '/api/ai/admin/webhook-deliveries',
  tags,
  security,
  description: '分页查询 Webhook 投递记录。endpointId 与 appId 二选一过滤，同时提供时按 endpointId。',
  request: { query: aiWebhookDeliveryQuerySchema },
  responses: {
    200: apiSuccessResponse(aiWebhookDeliveryListSchema, 'Webhook 投递记录列表', 'AiWebhookDeliveryListResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
})
