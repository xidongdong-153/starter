import type { Credential, Model, Models } from '@earendil-works/pi-ai'
import { ModelsError } from '@earendil-works/pi-ai'
import { builtinModels, radiusProvider } from '@earendil-works/pi-ai/providers/all'
import { and, eq } from 'drizzle-orm'

import type { AiAuthSource, AiCredentialType, AiModelCapabilities, AiModelRef } from '@starter/contracts'
import { customAiProviderDefinitionSchema } from '@starter/contracts'
import type { AppDatabase } from '@api/infra/db/client.js'
import { parseBoundedJson } from '@api/shared/bounded-json.js'
import { aiCustomProviders, aiEnabledModels, aiProviderConfigs, aiSettings } from '@api/modules/ai/ai.schema.js'

import type { AiCrypto, AiEncryptedColumns } from './ai-crypto.js'
import { AiCredentialDecryptError, AiCredentialKeyUnavailableError, createCredentialHint } from './ai-crypto.js'
import { AiCredentialConflictError, AiCredentialStore } from './ai-credential-store.js'
import { AiModelsStore } from './ai-models-store.js'
import type { AiProviderDefinition } from './ai-provider-registry.js'
import { createAiProviderRegistry, createCustomAiProviderDefinition } from './ai-provider-registry.js'
import { createCustomAiProvider } from './custom-provider.factory.js'
import { AiUrlGuardError, createAiUrlGuard } from './ai-url-guard.js'

export interface AiRuntimeModel extends AiModelRef {
  name: string
  capabilities: AiModelCapabilities
}

export interface AiPreparedProviderPayload extends AiEncryptedColumns {
  credentialType: AiCredentialType | null
  credentialHint: string | null
}

export interface AiStoredPayloadColumns {
  payloadCiphertext: string | null
  payloadIv: string | null
  payloadAuthTag: string | null
  encryptionVersion: number | null
}

export interface AiAuthCheckResult {
  credentialType: AiCredentialType | null
  source: AiAuthSource | null
}

export type AiRuntimeErrorKind =
  | 'auth'
  | 'catalog'
  | 'conflict'
  | 'credential_key_unavailable'
  | 'decrypt'
  | 'provider_not_found'
  | 'response_invalid'
  | 'timeout'
  | 'upstream'

export class AiRuntimeError extends Error {
  constructor(readonly kind: AiRuntimeErrorKind) {
    super(`AI runtime error: ${kind}`)
    this.name = 'AiRuntimeError'
  }
}

export type AiAuthPrompt = {
  signal?: AbortSignal
} & (
  | {
      type: 'text' | 'secret' | 'manual_code'
      message: string
      placeholder?: string
    }
  | {
      type: 'select'
      message: string
      options: readonly {
        id: string
        label: string
        description?: string
      }[]
    }
)

export type AiAuthEvent =
  | {
      type: 'info'
      message: string
      links?: readonly { url: string; label?: string }[]
    }
  | { type: 'auth_url'; url: string; instructions?: string }
  | {
      type: 'device_code'
      userCode: string
      verificationUri: string
      intervalSeconds?: number
      expiresInSeconds?: number
    }
  | { type: 'progress'; message: string }

export interface AiAuthInteraction {
  signal?: AbortSignal
  prompt: (prompt: AiAuthPrompt) => Promise<string>
  notify: (event: AiAuthEvent) => void
}

export interface AiRuntime {
  readonly providers: readonly AiProviderDefinition[]
  ensureReady: () => Promise<void>
  listModels: (providerId?: string) => readonly AiRuntimeModel[]
  listAvailableModels: (providerId?: string) => readonly AiRuntimeModel[]
  getProviderRequestEnv: (providerId: string) => Record<string, string>
  checkAuth: (providerId: string, signal?: AbortSignal) => Promise<AiAuthCheckResult>
  refreshModels: (providerId: string, signal?: AbortSignal) => Promise<void>
  login: (providerId: string, type: AiCredentialType, interaction: AiAuthInteraction) => Promise<void>
  logout: (providerId: string, signal?: AbortSignal) => Promise<void>
  readProviderSettings: (current: AiStoredPayloadColumns) => Record<string, string>
  prepareProviderConfig: (
    providerId: string,
    current: AiStoredPayloadColumns | undefined,
    apiKey: string | undefined,
    settings: Record<string, string>,
  ) => AiPreparedProviderPayload
  prepareCredentialClear: (current: AiStoredPayloadColumns) => AiPreparedProviderPayload | null
  reloadProvider: (providerId: string) => void
  unloadProvider: (providerId: string) => void
  validateCustomProviderUrl: (url: string) => Promise<void>
  getModelsCollection: () => Models
}

export interface AiRuntimeOptions {
  appEnv?: 'development' | 'test' | 'production'
  allowedPrivateCidrs?: readonly string[]
}

export function createAiRuntime(db: AppDatabase, crypto: AiCrypto, options: AiRuntimeOptions = {}): AiRuntime {
  const urlGuard = createAiUrlGuard(options)
  const credentialStore = new AiCredentialStore(db, crypto)
  const modelsStore = new AiModelsStore(db)
  const models = builtinModels({ credentials: credentialStore, modelsStore })
  const providerDefinitions = [...createAiProviderRegistry()]
  let readyPromise: Promise<void> | undefined

  const runtime: AiRuntime = {
    providers: providerDefinitions,
    ensureReady() {
      readyPromise ??= initialize()
      return readyPromise
    },
    listModels(providerId) {
      return models.getModels(providerId).map(toRuntimeModel)
    },
    listAvailableModels(providerId) {
      const provider = providerId ? models.getProvider(providerId) : undefined
      const selectedProviders = providerId ? (provider ? [provider] : []) : models.getProviders()

      return selectedProviders.flatMap((provider) => {
        try {
          const credential = readStoredPayload(db, crypto, provider.id).credential
          const providerModels = models.getModels(provider.id)
          return (provider.filterModels?.(providerModels, credential) ?? providerModels).map(toRuntimeModel)
        } catch {
          return []
        }
      })
    },
    getProviderRequestEnv(providerId) {
      return readStoredPayload(db, crypto, providerId).runtimeSettings
    },
    async checkAuth(providerId, signal) {
      if (!models.getProvider(providerId)) throw new AiRuntimeError('provider_not_found')
      try {
        const [auth, credential] = await Promise.all([
          models.getAuth(providerId, {
            signal,
            env: runtime.getProviderRequestEnv(providerId),
          }),
          credentialStore.read(providerId, { signal }),
        ])
        const result = {
          credentialType: credential?.type ?? null,
          source: auth ? normalizeAuthSource(auth.source, credential) : null,
        }
        if (providerDefinitions.find((item) => item.id === providerId)?.kind === 'custom') {
          await probeCustomProvider(providerId, signal)
        }
        return result
      } catch (error) {
        throw normalizeRuntimeError(error)
      }
    },
    async refreshModels(providerId, signal) {
      if (!models.getProvider(providerId)) throw new AiRuntimeError('provider_not_found')
      const result = await models.refresh({
        providers: [providerId],
        force: true,
        signal,
      })
      if (result.aborted) throw new DOMException('The operation was aborted', 'AbortError')
      if (result.errors.has(providerId)) throw new AiRuntimeError('catalog')
    },
    async login(providerId, type, interaction) {
      try {
        await models.login(providerId, type, interaction)
      } catch (error) {
        throw normalizeRuntimeError(error)
      }
    },
    async logout(providerId, signal) {
      if (!models.getProvider(providerId)) throw new AiRuntimeError('provider_not_found')
      try {
        await models.logout(providerId, { signal })
      } catch (error) {
        throw normalizeRuntimeError(error)
      }
    },
    readProviderSettings(current) {
      return decryptColumns(crypto, current).runtimeSettings
    },
    prepareProviderConfig(providerId, current, apiKey, settings) {
      if (!models.getProvider(providerId)) throw new AiRuntimeError('provider_not_found')
      const payload = current ? decryptColumns(crypto, current) : { runtimeSettings: {} }
      let credential = payload.credential
      if (apiKey !== undefined) credential = { type: 'api_key', key: apiKey, env: { ...settings } }
      else if (credential?.type === 'api_key') credential = { ...credential, env: { ...settings } }

      const encrypted = crypto.encrypt({
        credential,
        runtimeSettings: { ...settings },
      })
      return {
        ...encrypted,
        credentialType: credential?.type ?? null,
        credentialHint: createCredentialHint(credential),
      }
    },
    prepareCredentialClear(current) {
      const payload = decryptColumns(crypto, current)
      if (Object.keys(payload.runtimeSettings).length === 0) return null
      return {
        ...crypto.encrypt({ runtimeSettings: payload.runtimeSettings }),
        credentialType: null,
        credentialHint: null,
      }
    },
    reloadProvider(providerId) {
      if (providerId === 'radius') {
        const row = db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.providerId, providerId)).get()
        const gateway = row ? readRuntimeSettings(crypto, row).RADIUS_GATEWAY_URL : undefined
        models.setProvider(radiusProvider(gateway ? { gateway } : undefined))
      } else {
        reloadCustomProvider(providerId)
      }
      readyPromise = undefined
    },
    validateCustomProviderUrl: async (url) => {
      try {
        await urlGuard.assertAllowed(url)
      } catch (error) {
        if (error instanceof AiUrlGuardError) throw new AiRuntimeError('catalog')
        throw error
      }
    },
    getModelsCollection() {
      return models
    },
    unloadProvider(providerId) {
      if (providerDefinitions.find((item) => item.id === providerId)?.kind !== 'custom') {
        throw new AiRuntimeError('provider_not_found')
      }
      models.deleteProvider(providerId)
      removeProviderDefinition(providerId)
      readyPromise = undefined
    },
  }

  return runtime

  async function initialize(): Promise<void> {
    await loadCustomProviders()
    const rows = db.select().from(aiProviderConfigs).all()
    for (const row of rows) {
      try {
        decryptColumns(crypto, row)
        if (row.providerId === 'radius') runtime.reloadProvider(row.providerId)
      } catch (error) {
        markProviderError(row.providerId, error)
      }
    }

    const result = await models.refresh({ allowNetwork: false })
    for (const [providerId, error] of result.errors) markProviderError(providerId, error)
    revalidateStoredCatalog()
  }

  async function probeCustomProvider(providerId: string, signal?: AbortSignal): Promise<void> {
    const model = models.getModels(providerId)[0]
    if (!model) throw new AiRuntimeError('catalog')
    const auth = await models.getAuth(model, {
      signal,
      env: runtime.getProviderRequestEnv(providerId),
    })
    if (!auth) throw new AiRuntimeError('auth')
    const probeTimeout = AbortSignal.timeout(10_000)
    const probeSignal = AbortSignal.any([...(signal ? [signal] : []), probeTimeout])
    let responseStatus: number | undefined
    const stream = models.streamSimple(
      model,
      { messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }] },
      {
        signal: probeSignal,
        env: runtime.getProviderRequestEnv(providerId),
        timeoutMs: 10_000,
        maxRetries: 0,
        maxTokens: 1,
        onResponse(response) {
          responseStatus = response.status
        },
      },
    )
    for await (const event of stream) {
      if (event.type === 'error') {
        throw classifyProbeError(event.error.errorMessage, responseStatus, probeTimeout.aborted)
      }
      if (event.type === 'done') return
    }
    throw new AiRuntimeError('response_invalid')
  }

  function revalidateStoredCatalog(): void {
    const validKeys = new Set(models.getModels().map((model) => `${model.provider}\u0000${model.id}`))
    db.transaction((tx) => {
      for (const model of tx.select().from(aiEnabledModels).all()) {
        if (validKeys.has(`${model.providerId}\u0000${model.modelId}`)) continue
        tx.delete(aiEnabledModels)
          .where(and(eq(aiEnabledModels.providerId, model.providerId), eq(aiEnabledModels.modelId, model.modelId)))
          .run()
      }
      const global = tx.select().from(aiSettings).where(eq(aiSettings.id, 'global')).get()
      if (
        global?.globalProviderId &&
        global.globalModelId &&
        !validKeys.has(`${global.globalProviderId}\u0000${global.globalModelId}`)
      ) {
        tx.update(aiSettings)
          .set({
            globalProviderId: null,
            globalModelId: null,
            updatedBy: null,
            updatedAt: new Date(),
          })
          .where(eq(aiSettings.id, 'global'))
          .run()
      }
    })
  }

  async function loadCustomProviders(): Promise<void> {
    for (const row of db.select().from(aiCustomProviders).all()) {
      try {
        const definition = customAiProviderDefinitionSchema.parse(parseBoundedJson(row.definitionJson))
        await urlGuard.assertAllowed(definition.baseUrl)
        models.setProvider(createCustomAiProvider(definition, options))
        replaceProviderDefinition(createCustomAiProviderDefinition(definition, row.revision))
      } catch {
        markProviderError(row.providerId, new AiRuntimeError('catalog'))
      }
    }
  }

  function reloadCustomProvider(providerId: string): void {
    const row = db.select().from(aiCustomProviders).where(eq(aiCustomProviders.providerId, providerId)).get()
    if (!row) return
    try {
      const definition = customAiProviderDefinitionSchema.parse(parseBoundedJson(row.definitionJson))
      models.setProvider(createCustomAiProvider(definition, options))
      replaceProviderDefinition(createCustomAiProviderDefinition(definition, row.revision))
    } catch {
      models.deleteProvider(providerId)
      markProviderError(providerId, new AiRuntimeError('catalog'))
    }
  }

  function replaceProviderDefinition(definition: AiProviderDefinition): void {
    const index = providerDefinitions.findIndex((item) => item.id === definition.id)
    if (index === -1) providerDefinitions.push(definition)
    else providerDefinitions[index] = definition
  }

  function removeProviderDefinition(providerId: string): void {
    const index = providerDefinitions.findIndex((item) => item.id === providerId)
    if (index !== -1 && providerDefinitions[index]?.kind === 'custom') providerDefinitions.splice(index, 1)
  }
  function markProviderError(providerId: string, error: unknown): void {
    const kind = normalizeRuntimeError(error).kind
    db.transaction((tx) => {
      tx.update(aiProviderConfigs)
        .set({
          enabled: false,
          authStatus: 'error',
          lastCheckErrorCode: kind,
          updatedAt: new Date(),
        })
        .where(eq(aiProviderConfigs.providerId, providerId))
        .run()
      const global = tx.select().from(aiSettings).where(eq(aiSettings.id, 'global')).get()
      if (global?.globalProviderId === providerId) {
        tx.update(aiSettings)
          .set({
            globalProviderId: null,
            globalModelId: null,
            updatedBy: null,
            updatedAt: new Date(),
          })
          .where(eq(aiSettings.id, 'global'))
          .run()
      }
    })
  }
}

function decryptColumns(crypto: AiCrypto, current: AiStoredPayloadColumns) {
  if (
    current.payloadCiphertext === null ||
    current.payloadIv === null ||
    current.payloadAuthTag === null ||
    current.encryptionVersion === null
  ) {
    return { runtimeSettings: {} }
  }
  return crypto.decrypt({
    payloadCiphertext: current.payloadCiphertext,
    payloadIv: current.payloadIv,
    payloadAuthTag: current.payloadAuthTag,
    encryptionVersion: current.encryptionVersion,
  })
}

function readStoredPayload(db: AppDatabase, crypto: AiCrypto, providerId: string) {
  const row = db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.providerId, providerId)).get()
  return row ? decryptColumns(crypto, row) : { credential: undefined, runtimeSettings: {} }
}

function readRuntimeSettings(crypto: AiCrypto, row: AiStoredPayloadColumns): Record<string, string> {
  return decryptColumns(crypto, row).runtimeSettings
}

function toRuntimeModel(model: Model<string>): AiRuntimeModel {
  return {
    providerId: model.provider,
    modelId: model.id,
    name: model.name,
    capabilities: {
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxTokens,
      supportsImageInput: model.input.includes('image'),
      supportsReasoning: model.reasoning,
      supportsTools: 'supportsTools' in model && typeof model.supportsTools === 'boolean' ? model.supportsTools : true,
    },
  }
}

function normalizeAuthSource(source: string | undefined, credential: Credential | undefined): AiAuthSource {
  if (credential?.type === 'oauth') return 'stored_oauth'
  if (credential?.type === 'api_key') return 'stored_api_key'
  const normalized = source?.toLowerCase() ?? ''
  if (normalized.includes('aws') || normalized.includes('ecs') || normalized.includes('identity')) {
    return 'aws_credentials'
  }
  if (normalized.includes('gcloud') || normalized.includes('application default')) {
    return 'vertex_adc'
  }
  if (source) return 'environment'
  return 'keyless'
}

function classifyProbeError(
  message: string | undefined,
  responseStatus: number | undefined,
  timedOut: boolean,
): AiRuntimeError {
  const status = responseStatus ?? statusCodeFromMessage(message)
  if (timedOut) return new AiRuntimeError('timeout')
  if (status === 401 || status === 403) return new AiRuntimeError('auth')
  if (status === 408 || status === 504) return new AiRuntimeError('timeout')
  if (status !== undefined && status >= 400) return new AiRuntimeError('upstream')
  if (message?.toLowerCase().includes('timeout')) return new AiRuntimeError('timeout')
  return new AiRuntimeError('upstream')
}

function statusCodeFromMessage(message: string | undefined): number | undefined {
  const match = message?.match(/(^|\D)([45]\d{2})(\D|$)/u)
  return match?.[2] ? Number(match[2]) : undefined
}

function normalizeRuntimeError(error: unknown): AiRuntimeError {
  if (error instanceof AiRuntimeError) return error
  if (error instanceof AiCredentialConflictError) return new AiRuntimeError('conflict')
  if (error instanceof AiCredentialKeyUnavailableError) return new AiRuntimeError('credential_key_unavailable')
  if (error instanceof AiCredentialDecryptError) return new AiRuntimeError('decrypt')
  if (error instanceof ModelsError) {
    return new AiRuntimeError(error.code === 'auth' || error.code === 'oauth' ? 'auth' : 'catalog')
  }
  return new AiRuntimeError('auth')
}
