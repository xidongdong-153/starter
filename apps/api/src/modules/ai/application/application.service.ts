import type { AiApplication, AiApplicationSecret, CreateAiApplicationInput } from '@starter/contracts'
import { ApiErrorCodes } from '@starter/contracts'
import type { Logger } from 'pino'
import { AppError } from '@api/shared/app-error.js'
import { generateId } from '@api/shared/id.js'
import { createAppSecret, verifyAppSecret } from './application.crypto.js'
import type { AiAppCredentialRecord } from './application.repository.js'

function toApplication(record: AiAppCredentialRecord): AiApplication {
  return {
    appId: record.id,
    name: record.name,
    tenantId: record.tenantId,
    projectId: record.projectId,
    status: record.status as AiApplication['status'],
    secretPrefix: record.secretPrefix,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
  }
}

function notFound(): AppError {
  return new AppError(ApiErrorCodes.AI_APP_CREDENTIAL_NOT_FOUND, '应用凭据不存在', 404)
}

export function createAiApplicationService(input: {
  repository: ReturnType<typeof import('./application.repository.js').createAiApplicationRepository>
  logger: Logger
}) {
  const { repository, logger } = input

  function create(data: CreateAiApplicationInput, actorId: string, requestId: string): AiApplicationSecret {
    const now = new Date()
    const id = generateId()
    const generated = createAppSecret()
    const record = repository.createWithAudit(
      {
        id,
        name: data.name,
        tenantId: data.tenantId,
        projectId: data.projectId,
        secretHash: generated.hash,
        secretPrefix: generated.prefix,
        status: 'active',
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
        revokedAt: null,
      },
      requestId,
    )
    logger.info({ appId: id, requestId }, 'AI 应用凭据已创建')
    return { application: toApplication(record), secret: generated.secret }
  }

  function list(): AiApplication[] {
    return repository.list().map(toApplication)
  }

  function rotate(appId: string, actorId: string, requestId: string): AiApplicationSecret {
    const current = repository.findById(appId)
    if (!current) throw notFound()
    if (current.status !== 'active') {
      throw new AppError(ApiErrorCodes.AI_APP_CREDENTIAL_REVOKED, '应用凭据已撤销', 409)
    }
    const generated = createAppSecret()
    const now = new Date()
    const record = repository.replaceSecret(appId, actorId, generated.hash, generated.prefix, now, requestId)
    if (!record) throw notFound()
    logger.info({ appId, requestId }, 'AI 应用凭据已轮换')
    return { application: toApplication(record), secret: generated.secret }
  }

  function revoke(appId: string, actorId: string, requestId: string): AiApplication {
    const record = repository.revoke(appId, actorId, new Date(), requestId)
    if (!record) {
      const current = repository.findById(appId)
      if (!current) throw notFound()
      throw new AppError(ApiErrorCodes.AI_APP_CREDENTIAL_REVOKED, '应用凭据已撤销', 409)
    }
    logger.info({ appId, requestId }, 'AI 应用凭据已撤销')
    return toApplication(record)
  }

  function authenticate(secret: string): AiAppCredentialRecord | undefined {
    const prefix = secret.slice(0, 12)
    const record = repository
      .findActiveByPrefix(prefix)
      .find((candidate) => verifyAppSecret(secret, candidate.secretHash))
    if (record) repository.markUsed(record.id, new Date())
    return record
  }

  return { create, list, rotate, revoke, authenticate, toApplication }
}
