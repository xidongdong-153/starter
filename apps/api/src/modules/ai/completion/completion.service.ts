import type {
  AiModelRef,
  AiUsage,
  CompletionRequest,
  CompletionResult,
  CompletionStreamEvent,
} from '@starter/contracts'
import { ApiErrorCodes } from '@starter/contracts'
import type { Logger } from 'pino'

import type { AiGatewayInput } from '@api/infra/ai/index.js'
import type { AiModelImageBlock, AiModelTextBlock } from '@api/infra/ai/ai-gateway.types.js'
import { AiGatewayError } from '@api/infra/ai/index.js'
import { AppError } from '@api/shared/app-error.js'

import type { RuntimeAccessContext } from '../principal.js'
import type { AiAttachmentResolver, ResolvedAiImageAttachment } from '../attachment/index.js'
import type { AiInvocationRunner, AiModelCallAuditContext } from '../usage-audit/usage-audit.service.js'

export interface AiCompletionServiceDeps {
  invocationRunner: AiInvocationRunner
  /** 白名单校验：不在 ai_enabled_models 或 Provider 不可用时抛 AI.MODEL_NOT_ALLOWED。 */
  requireAllowedModel: (model: AiModelRef) => Promise<AiModelRef>
  /** 附件解析：归属校验 + 读字节转 base64；带附件的输入必需。 */
  resolveAttachments: (
    input: Parameters<AiAttachmentResolver['resolveForRequest']>[0],
  ) => Promise<ResolvedAiImageAttachment[]>
  /** 模型能力查询：目标模型是否支持图片输入，统一查 runtime 模型表。 */
  supportsImageInput: (model: AiModelRef) => boolean
  requestTimeoutMs: number
  logger: Logger
}

export type AiCompletionService = ReturnType<typeof createAiCompletionService>

export function createAiCompletionService(deps: AiCompletionServiceDeps) {
  const { invocationRunner, requireAllowedModel, resolveAttachments, supportsImageInput, requestTimeoutMs, logger } =
    deps

  function toAuditContext(access: RuntimeAccessContext, requestId: string): AiModelCallAuditContext {
    const { principal } = access
    return {
      requestId,
      userId: principal.externalUserId ?? principal.principalId,
      appId: principal.appId,
      principalKind: principal.kind,
      externalUserId: principal.externalUserId,
      scope: access.scope,
      scenario: 'completion',
      timeoutMs: requestTimeoutMs,
    }
  }

  function toGatewayInput(
    model: AiModelRef,
    request: CompletionRequest,
    images: readonly ResolvedAiImageAttachment[] | undefined,
    signal: AbortSignal | undefined,
  ): AiGatewayInput {
    const content: (AiModelTextBlock | AiModelImageBlock)[] = [
      {
        type: 'text',
        text: request.input,
        turnIndex: 0,
        contentIndex: 0,
        blockId: '0:0',
      },
    ]
    for (const [index, image] of (images ?? []).entries()) {
      content.push({
        type: 'image',
        data: image.data,
        mimeType: image.mimeType,
        turnIndex: 0,
        contentIndex: index + 1,
        blockId: `0:${index + 1}`,
      })
    }
    return {
      model,
      ...(request.systemPrompt === undefined ? {} : { systemPrompt: request.systemPrompt }),
      messages: [{ role: 'user', content }],
      turnIndex: 0,
      timeoutMs: requestTimeoutMs,
      signal,
    }
  }

  /**
   * 附件解析与能力硬校验：无 attachmentIds 时返回 undefined，纯文本路径不变；
   * 模型不支持图片时抛 AI_IMAGE_NOT_SUPPORTED，不静默丢图。
   */
  async function resolveCompletionImages(
    access: RuntimeAccessContext,
    request: CompletionRequest,
    model: AiModelRef,
  ): Promise<ResolvedAiImageAttachment[] | undefined> {
    if (!request.attachmentIds || request.attachmentIds.length === 0) {
      return undefined
    }
    const attachments = await resolveAttachments({
      access,
      sessionId: null,
      attachmentIds: request.attachmentIds,
    })
    if (!supportsImageInput(model)) {
      throw new AppError(ApiErrorCodes.AI_IMAGE_NOT_SUPPORTED, '当前模型不支持图片输入', 400)
    }
    return attachments
  }

  async function* stream(
    access: RuntimeAccessContext,
    request: CompletionRequest,
    requestId: string,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<CompletionStreamEvent> {
    const model = await requireAllowedModel(request.model)
    const images = await resolveCompletionImages(access, request, model)
    const events = invocationRunner.stream(
      toAuditContext(access, requestId),
      toGatewayInput(model, request, images, signal),
    )
    for await (const event of events) {
      if (event.type === 'text_delta') {
        yield { type: 'text_delta', text: event.text }
      } else if (event.type === 'completed') {
        // 无状态调用不传 tools，tool_use 属于上游异常，按上游失败处理。
        if (event.stopReason === 'tool_use') {
          throw new AiGatewayError('upstream', {
            usage: event.usage,
            cost: event.cost,
            stopReason: event.stopReason,
          })
        }
        yield {
          type: 'done',
          stopReason: event.stopReason === 'length' ? 'length' : 'stop',
          ...toCompletionUsage(event.usage),
        }
      }
    }
  }

  async function complete(
    access: RuntimeAccessContext,
    request: CompletionRequest,
    requestId: string,
    signal: AbortSignal | undefined,
  ): Promise<CompletionResult> {
    let content = ''
    try {
      for await (const event of stream(access, request, requestId, signal)) {
        if (event.type === 'text_delta') {
          content += event.text
        } else if (event.type === 'done') {
          return {
            content,
            stopReason: event.stopReason,
            ...('usage' in event ? { usage: event.usage } : {}),
          }
        }
      }
    } catch (error) {
      throw toAppError(error)
    }
    logger.warn({ event: 'ai.completion.unterminated', requestId }, '模型流在没有 completed 事件的情况下结束')
    return { content, stopReason: 'aborted' }
  }

  function toStreamError(error: unknown, requestId: string): CompletionStreamEvent {
    const appError = toAppError(error)
    return {
      type: 'error',
      code: appError.code,
      message: appError.message,
      retryable: appError.status >= 500,
      requestId,
    }
  }

  return { complete, stream, toStreamError }
}

/**
 * usage 读不到（关键字段全为 null）时整体省略；读到的 null 保留，真实的 0 不动。
 */
function toCompletionUsage(usage: AiUsage): { usage?: AiUsage } {
  if (usage.inputTokens === null && usage.outputTokens === null && usage.totalTokens === null) {
    return {}
  }
  return { usage }
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  const gatewayError = error instanceof AiGatewayError ? error : new AiGatewayError('upstream')
  if (gatewayError.kind === 'timeout') {
    return new AppError(ApiErrorCodes.AI_UPSTREAM_TIMEOUT, '模型响应超时，可以重试', 504)
  }
  if (gatewayError.kind === 'aborted') {
    return new AppError(ApiErrorCodes.AI_REQUEST_ABORTED, '生成已停止', 503)
  }
  if (gatewayError.kind === 'auth') {
    return new AppError(ApiErrorCodes.AI_PROVIDER_AUTH_FAILED, 'Provider 认证失败，请检查配置后重试', 503)
  }
  return new AppError(ApiErrorCodes.AI_UPSTREAM_ERROR, '模型服务暂时不可用，可以稍后重试', 503)
}
