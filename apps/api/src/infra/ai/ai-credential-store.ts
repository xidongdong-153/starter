import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import { and, eq, isNotNull } from 'drizzle-orm'

import type { AppDatabase } from '@api/infra/db/client.js'
import { aiProviderConfigs } from '@api/modules/ai/ai.schema.js'

import type { AiCrypto, AiEncryptedPayload } from './ai-crypto.js'
import { createCredentialHint } from './ai-crypto.js'

export class AiCredentialConflictError extends Error {
  constructor() {
    super('AI credential changed concurrently')
    this.name = 'AiCredentialConflictError'
  }
}

export class AiCredentialStore implements CredentialStore {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly db: AppDatabase,
    private readonly crypto: AiCrypto,
  ) {}

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    throwIfAborted(options?.signal)
    const row = this.findRow(providerId)
    const credential = row ? this.readPayload(row).credential : undefined
    throwIfAborted(options?.signal)
    return credential
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    throwIfAborted(options?.signal)
    const rows = this.db
      .select({
        providerId: aiProviderConfigs.providerId,
        type: aiProviderConfigs.credentialType,
      })
      .from(aiProviderConfigs)
      .where(isNotNull(aiProviderConfigs.credentialType))
      .all()
    throwIfAborted(options?.signal)

    return rows.flatMap((row) =>
      row.type === 'api_key' || row.type === 'oauth' ? [{ providerId: row.providerId, type: row.type }] : [],
    )
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      throwIfAborted(options?.signal)
      const row = this.findRow(providerId)
      const payload = row ? this.readPayload(row) : { runtimeSettings: {} }
      const next = await fn(payload.credential)
      throwIfAborted(options?.signal)

      if (next === undefined) return payload.credential

      const now = new Date()
      const encrypted = this.crypto.encrypt({
        credential: next,
        runtimeSettings: payload.runtimeSettings,
      })
      if (!row) {
        try {
          this.db
            .insert(aiProviderConfigs)
            .values({
              providerId,
              enabled: false,
              credentialType: next.type,
              credentialHint: createCredentialHint(next),
              ...encrypted,
              rowVersion: 1,
              configRevision: 0,
              authStatus: 'not_configured',
              createdAt: now,
              updatedAt: now,
            })
            .run()
        } catch {
          throw new AiCredentialConflictError()
        }
        return next
      }

      const result = this.db
        .update(aiProviderConfigs)
        .set({
          credentialType: next.type,
          credentialHint: createCredentialHint(next),
          ...encrypted,
          rowVersion: row.rowVersion + 1,
          updatedAt: now,
        })
        .where(and(eq(aiProviderConfigs.providerId, providerId), eq(aiProviderConfigs.rowVersion, row.rowVersion)))
        .run()
      if (result.changes !== 1) throw new AiCredentialConflictError()
      return next
    })
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.enqueue(providerId, async () => {
      throwIfAborted(options?.signal)
      const row = this.findRow(providerId)
      if (!row) return
      const payload = this.readPayload(row)
      if (!payload.credential) return

      const encrypted =
        Object.keys(payload.runtimeSettings).length > 0
          ? this.crypto.encrypt({ runtimeSettings: payload.runtimeSettings })
          : undefined
      const result = this.db
        .update(aiProviderConfigs)
        .set({
          credentialType: null,
          credentialHint: null,
          payloadCiphertext: encrypted?.payloadCiphertext ?? null,
          payloadIv: encrypted?.payloadIv ?? null,
          payloadAuthTag: encrypted?.payloadAuthTag ?? null,
          encryptionVersion: encrypted?.encryptionVersion ?? null,
          rowVersion: row.rowVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(aiProviderConfigs.providerId, providerId), eq(aiProviderConfigs.rowVersion, row.rowVersion)))
        .run()
      if (result.changes !== 1) throw new AiCredentialConflictError()
      throwIfAborted(options?.signal)
    })
  }

  private findRow(providerId: string) {
    return this.db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.providerId, providerId)).get()
  }

  private readPayload(row: typeof aiProviderConfigs.$inferSelect): AiEncryptedPayload {
    if (
      row.payloadCiphertext === null ||
      row.payloadIv === null ||
      row.payloadAuthTag === null ||
      row.encryptionVersion === null
    ) {
      return { runtimeSettings: {} }
    }

    return this.crypto.decrypt({
      payloadCiphertext: row.payloadCiphertext,
      payloadIv: row.payloadIv,
      payloadAuthTag: row.payloadAuthTag,
      encryptionVersion: row.encryptionVersion,
    })
  }

  private enqueue<T>(providerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(providerId) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.queues.set(providerId, settled)
    void settled.finally(() => {
      if (this.queues.get(providerId) === settled) this.queues.delete(providerId)
    })
    return result
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}
