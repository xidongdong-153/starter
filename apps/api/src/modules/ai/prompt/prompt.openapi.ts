import {
  createPromptTemplateSchema,
  createSystemPromptSchema,
  promptTemplateSchema,
  systemPromptSchema,
  updateGlobalSystemPromptSchema,
  updatePromptTemplateSchema,
  updateSystemPromptSchema,
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

const systemPromptParams = z.object({ id: uuidSchema })
const templateParams = z.object({ id: uuidSchema })

export const listSystemPromptsRoute = createRoute({
  method: 'get',
  path: '/api/ai/system-prompts',
  tags,
  security,
  responses: {
    200: apiSuccessResponse(z.array(systemPromptSchema), '系统提示词列表', 'SystemPromptListResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
})

export const createSystemPromptRoute = createRoute({
  method: 'post',
  path: '/api/ai/system-prompts',
  tags,
  security,
  request: {
    body: {
      content: { 'application/json': { schema: createSystemPromptSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(systemPromptSchema, '创建系统提示词', 'SystemPromptResponse'),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
})

export const updateSystemPromptRoute = createRoute({
  method: 'put',
  path: '/api/ai/system-prompts/{id}',
  tags,
  security,
  request: {
    params: systemPromptParams,
    body: {
      content: { 'application/json': { schema: updateSystemPromptSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(systemPromptSchema, '更新系统提示词', 'SystemPromptResponse'),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})

export const deleteSystemPromptRoute = createRoute({
  method: 'delete',
  path: '/api/ai/system-prompts/{id}',
  tags,
  security,
  request: { params: systemPromptParams },
  responses: {
    200: apiSuccessResponse(z.object({ deleted: z.boolean() }), '删除系统提示词', 'DeleteResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})

export const getGlobalSystemPromptRoute = createRoute({
  method: 'get',
  path: '/api/ai/settings/system-prompt',
  tags,
  security,
  responses: {
    200: apiSuccessResponse(updateGlobalSystemPromptSchema, '当前全局默认系统提示词', 'GlobalSystemPromptResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
})

export const updateGlobalSystemPromptRoute = createRoute({
  method: 'put',
  path: '/api/ai/settings/system-prompt',
  tags,
  security,
  request: {
    body: {
      content: {
        'application/json': { schema: updateGlobalSystemPromptSchema },
      },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(updateGlobalSystemPromptSchema, '设置全局默认系统提示词', 'GlobalSystemPromptResponse'),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})

export const listPromptTemplatesRoute = createRoute({
  method: 'get',
  path: '/api/ai/prompt-templates',
  tags,
  security,
  responses: {
    200: apiSuccessResponse(z.array(promptTemplateSchema), 'Prompt 模板列表', 'PromptTemplateListResponse'),
    401: unauthorizedResponse,
  },
})

export const createPromptTemplateRoute = createRoute({
  method: 'post',
  path: '/api/ai/prompt-templates',
  tags,
  security,
  request: {
    body: {
      content: { 'application/json': { schema: createPromptTemplateSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(promptTemplateSchema, '创建 Prompt 模板', 'PromptTemplateResponse'),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
})

export const updatePromptTemplateRoute = createRoute({
  method: 'put',
  path: '/api/ai/prompt-templates/{id}',
  tags,
  security,
  request: {
    params: templateParams,
    body: {
      content: { 'application/json': { schema: updatePromptTemplateSchema } },
      required: true,
    },
  },
  responses: {
    200: apiSuccessResponse(promptTemplateSchema, '更新 Prompt 模板', 'PromptTemplateResponse'),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})

export const deletePromptTemplateRoute = createRoute({
  method: 'delete',
  path: '/api/ai/prompt-templates/{id}',
  tags,
  security,
  request: { params: templateParams },
  responses: {
    200: apiSuccessResponse(z.object({ deleted: z.boolean() }), '删除 Prompt 模板', 'DeleteResponse'),
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: notFoundResponse,
  },
})
