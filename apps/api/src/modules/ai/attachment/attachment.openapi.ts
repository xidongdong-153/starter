import { aiAttachmentSchema, uuidSchema } from '@starter/contracts'
import { createRoute, z } from '@hono/zod-openapi'

import { nameSchema } from '@api/openapi/name-schema.js'
import {
  apiSuccessResponse,
  invalidRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from '@api/openapi/responses.js'

const tags = ['AI Runtime']
const security: Array<Record<string, string[]>> = [{ cookieAuth: [] }, { bearerAuth: [] }]

const uploadAiAttachmentFormSchema = z.object({
  file: z.any().describe('图片文件；MIME 白名单 image/jpeg、image/png、image/webp、image/gif，单张最大 5MB'),
  sessionId: uuidSchema.optional().describe('可选；附件归属的 Agent Session，须属于当前 principal'),
})

const aiAttachmentItemSchema = nameSchema(aiAttachmentSchema, 'AiAttachment')

export const uploadAiAttachmentRoute = createRoute({
  method: 'post',
  path: '/api/ai/attachments',
  tags,
  security,
  description:
    '上传 AI 图片附件，返回 attachmentId 供 startRun / followUp / steer / completion 的 attachmentIds 引用。starter_user 会话与应用凭证（Bearer product_app）两种 principal 都可上传。',
  request: {
    body: {
      content: {
        'multipart/form-data': { schema: uploadAiAttachmentFormSchema },
      },
      required: true,
    },
  },
  responses: {
    201: apiSuccessResponse(aiAttachmentItemSchema, '上传成功的附件', 'AiAttachmentResponse'),
    400: invalidRequestResponse,
    401: unauthorizedResponse,
    404: notFoundResponse,
  },
})
