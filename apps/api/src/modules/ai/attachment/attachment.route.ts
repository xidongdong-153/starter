import type { MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { OpenAPIHono, z } from '@hono/zod-openapi'

import type { HonoEnv } from '@api/shared/hono-env.js'
import { uuidSchema, ApiErrorCodes } from '@starter/contracts'
import { toRuntimeAccessContext } from '@api/modules/ai/principal.js'
import { AppError } from '@api/shared/app-error.js'
import { createSuccessResponse } from '@api/shared/response.js'
import { throwValidationError } from '@api/shared/validator.js'
import { uploadAiAttachmentRoute } from './attachment.openapi.js'
import type { AiAttachmentService } from './attachment.service.js'

type AiRouteMiddleware = MiddlewareHandler<HonoEnv>

const attachmentParamsSchema = z.object({ attachmentId: uuidSchema })

export function createAiAttachmentRoute(deps: { service: AiAttachmentService; requireAuth: AiRouteMiddleware }) {
  const { service, requireAuth } = deps
  const access = (c: { var: HonoEnv['Variables'] }) => toRuntimeAccessContext(c.var.principal, c.var.resourceScope)

  return new OpenAPIHono<HonoEnv>()
    .openapi({ ...uploadAiAttachmentRoute, middleware: requireAuth }, async (c) => {
      const form = c.req.valid('form')
      const file = form.file
      if (!(file instanceof File)) {
        throw new AppError(ApiErrorCodes.COMMON_INVALID_REQUEST, '请选择图片', 400)
      }
      const accessContext = access(c)
      const failedBase = {
        event: 'ai.attachment.upload.failed',
        name: file.name,
        size: file.size,
        principalKind: accessContext.principal.kind,
      }
      try {
        const item = await service.upload({
          access: accessContext,
          file,
          sessionId: form.sessionId ?? null,
        })
        c.var.logger.info(
          {
            event: 'ai.attachment.upload.succeeded',
            attachmentId: item.id,
            mimeType: item.mimeType,
            size: item.size,
            sessionId: item.sessionId,
          },
          'AI 附件上传成功',
        )
        return c.json(createSuccessResponse(item, c.var.requestId), 201)
      } catch (error) {
        if (error instanceof AppError) {
          c.var.logger.warn({ ...failedBase, code: error.code, message: error.message }, 'AI 附件上传失败')
        } else {
          c.var.logger.error({ err: error, ...failedBase }, 'AI 附件上传失败')
        }
        throw error
      }
    })
    .get(
      '/api/ai/attachments/:attachmentId/content',
      requireAuth,
      zValidator('param', attachmentParamsSchema, (result) => {
        if (!result.success) throwValidationError(result.error)
      }),
      async (c) => {
        const attachmentId = c.req.valid('param').attachmentId
        try {
          const content = await service.readContent(access(c), attachmentId)
          return new Response(content.bytes, {
            headers: {
              'Content-Type': content.mimeType,
              'Content-Length': String(content.size),
            },
          })
        } catch (error) {
          if (error instanceof AppError && error.code === ApiErrorCodes.AI_ATTACHMENT_NOT_FOUND) {
            c.var.logger.warn(
              {
                event: 'ai.attachment.download.denied',
                attachmentId,
                principalKind: access(c).principal.kind,
              },
              'AI 附件下载被拒绝',
            )
          }
          throw error
        }
      },
    )
}
