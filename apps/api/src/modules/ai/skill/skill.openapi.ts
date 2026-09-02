import {
  aiSkillSchema,
  aiSkillSummarySchema,
  createAiSkillSchema,
  updateAiSkillSchema,
  uuidSchema,
} from '@starter/contracts'
import { createRoute, z } from '@hono/zod-openapi'

import {
  apiSuccessResponse,
  forbiddenResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from '@api/openapi/responses.js'

const tags = ['AI Control']
const security = [{ cookieAuth: [] }]

const skillParams = z.object({ id: uuidSchema })

export const listAiSkillsRoute = createRoute({
  method: 'get',
  path: '/api/ai/skills',
  tags,
  security,
  responses: {
    200: apiSuccessResponse(z.array(aiSkillSummarySchema), '技能列表（不含内容）', 'AiSkillSummaryListResponse'),
    401: unauthorizedResponse,
  },
})

export const getAiSkillRoute = createRoute({
  method: 'get',
  path: '/api/ai/skills/{id}',
  tags,
  security,
  request: { params: skillParams },
  responses: {
    200: apiSuccessResponse(aiSkillSchema, '技能详情', 'AiSkillResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})

export const createAiSkillRoute = createRoute({
  method: 'post',
  path: '/api/ai/skills',
  tags,
  security,
  request: {
    body: {
      content: { 'application/json': { schema: createAiSkillSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(aiSkillSchema, '创建技能', 'AiSkillResponse'),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
})

export const updateAiSkillRoute = createRoute({
  method: 'put',
  path: '/api/ai/skills/{id}',
  tags,
  security,
  request: {
    params: skillParams,
    body: {
      content: { 'application/json': { schema: updateAiSkillSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(aiSkillSchema, '更新技能', 'AiSkillResponse'),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})

export const deleteAiSkillRoute = createRoute({
  method: 'delete',
  path: '/api/ai/skills/{id}',
  tags,
  security,
  request: { params: skillParams },
  responses: {
    200: apiSuccessResponse(z.object({ deleted: z.boolean() }), '删除技能', 'DeleteResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})
