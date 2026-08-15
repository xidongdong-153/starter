import { z } from 'zod'

import { apiErrorCodeSchema, isoDateTimeSchema } from './common.js'

export const aiProviderIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9-]*$/)

export const aiModelIdSchema = z.string().trim().min(1).max(240)

export const aiModelRefSchema = z.object({
  providerId: aiProviderIdSchema,
  modelId: aiModelIdSchema,
})

export type AiModelRef = z.infer<typeof aiModelRefSchema>

export const aiAuthModeSchema = z.enum(['api_key', 'oauth', 'ambient'])
export const aiCredentialTypeSchema = z.enum(['api_key', 'oauth'])
export const aiAuthStatusSchema = z.enum(['not_configured', 'needs_check', 'ready', 'error'])
export const aiAuthSourceSchema = z.enum([
  'stored_api_key',
  'stored_oauth',
  'environment',
  'aws_credentials',
  'vertex_adc',
  'keyless',
])

export type AiAuthMode = z.infer<typeof aiAuthModeSchema>
export type AiCredentialType = z.infer<typeof aiCredentialTypeSchema>
export type AiAuthStatus = z.infer<typeof aiAuthStatusSchema>
export type AiAuthSource = z.infer<typeof aiAuthSourceSchema>

export const aiProviderConfigFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  label: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  required: z.boolean(),
  type: z.enum(['text', 'url', 'select']),
  options: z
    .array(z.object({ label: z.string().max(120), value: z.string().max(240) }))
    .max(40)
    .optional(),
})

export type AiProviderConfigField = z.infer<typeof aiProviderConfigFieldSchema>

export const adminAiProviderSchema = z.object({
  providerId: aiProviderIdSchema,
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  supportedAuthModes: z.array(aiAuthModeSchema),
  activeCredentialType: aiCredentialTypeSchema.nullable(),
  authStatus: aiAuthStatusSchema,
  authSource: aiAuthSourceSchema.nullable(),
  checkedAt: isoDateTimeSchema.nullable(),
  credentialMask: z.string().max(32).nullable(),
  configFields: z.array(aiProviderConfigFieldSchema),
  configuredSettings: z.record(z.string(), z.string()),
  setupInstructions: z.array(z.string().min(1).max(500)).max(12),
  supportsModelRefresh: z.boolean(),
  catalogModelCount: z.number().int().min(0),
  enabledModelCount: z.number().int().min(0),
  configRevision: z.number().int().min(0),
})

export type AdminAiProvider = z.infer<typeof adminAiProviderSchema>

export const aiModelCapabilitiesSchema = z.object({
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  supportsImageInput: z.boolean(),
  supportsReasoning: z.boolean(),
  supportsTools: z.boolean(),
})

export type AiModelCapabilities = z.infer<typeof aiModelCapabilitiesSchema>

export const adminAiModelSchema = z.object({
  providerId: aiProviderIdSchema,
  modelId: aiModelIdSchema,
  name: z.string().min(1).max(240),
  providerName: z.string().min(1).max(120),
  capabilities: aiModelCapabilitiesSchema,
  available: z.boolean(),
  enabled: z.boolean(),
  unavailableReason: z
    .enum(['provider_disabled', 'provider_not_ready', 'model_missing', 'model_unavailable'])
    .nullable(),
})

export type AdminAiModel = z.infer<typeof adminAiModelSchema>

export const aiUserModelSchema = z.object({
  providerId: aiProviderIdSchema,
  modelId: aiModelIdSchema,
  name: z.string().min(1).max(240),
  providerName: z.string().min(1).max(120),
  capabilities: aiModelCapabilitiesSchema,
})

export type AiUserModel = z.infer<typeof aiUserModelSchema>

export const aiUserPreferenceSchema = z.object({
  selectedModel: aiModelRefSchema.nullable(),
  effectiveModel: aiModelRefSchema.nullable(),
  effectiveSource: z.enum(['user', 'global']).nullable(),
})

export type AiUserPreference = z.infer<typeof aiUserPreferenceSchema>

export const adminAiModelsResponseSchema = z.object({
  items: z.array(adminAiModelSchema),
  globalDefaultModel: aiModelRefSchema.nullable(),
})

export type AdminAiModelsResponse = z.infer<typeof adminAiModelsResponseSchema>

export const aiProviderParamsSchema = z.object({ providerId: aiProviderIdSchema })

const aiSettingsSchema = z
  .record(z.string().min(1).max(80), z.string().trim().max(1000))
  .superRefine((settings, context) => {
    if (Object.keys(settings).length > 24) {
      context.addIssue({ code: 'custom', message: 'Provider 配置项不能超过 24 个' })
    }
  })

export const updateAiProviderConfigSchema = z.object({
  apiKey: z.string().trim().min(1).max(16_384).optional(),
  settings: aiSettingsSchema,
})

export type UpdateAiProviderConfigInput = z.infer<typeof updateAiProviderConfigSchema>

export const updateAiProviderStateSchema = z.object({ enabled: z.boolean() })
export type UpdateAiProviderStateInput = z.infer<typeof updateAiProviderStateSchema>

export const replaceAiEnabledModelsSchema = z
  .object({ models: z.array(aiModelRefSchema).max(1000) })
  .superRefine((value, context) => {
    const keys = value.models.map((model) => `${model.providerId}\u0000${model.modelId}`)
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', message: '模型列表不能包含重复项' })
    }
  })

export type ReplaceAiEnabledModelsInput = z.infer<typeof replaceAiEnabledModelsSchema>

export const updateAiDefaultModelSchema = z.object({ model: aiModelRefSchema.nullable() })
export type UpdateAiDefaultModelInput = z.infer<typeof updateAiDefaultModelSchema>

export const updateAiPreferenceSchema = z.object({ model: aiModelRefSchema.nullable() })
export type UpdateAiPreferenceInput = z.infer<typeof updateAiPreferenceSchema>

export const aiTestInputSchema = z.object({
  model: aiModelRefSchema.optional(),
  prompt: z.string().trim().min(1).max(8000),
})

export type AiTestInput = z.infer<typeof aiTestInputSchema>

export const aiTestStartEventSchema = z.object({
  type: z.literal('start'),
  requestId: z.string().min(1),
  model: aiModelRefSchema,
})

export const aiTestTextDeltaEventSchema = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
})

export const aiTestDoneEventSchema = z.object({
  type: z.literal('done'),
  stopReason: z.enum(['stop', 'length', 'tool_use']),
  usage: z
    .object({
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      totalTokens: z.number().int().min(0),
    })
    .optional(),
})

export const aiTestErrorEventSchema = z.object({
  type: z.literal('error'),
  code: apiErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  requestId: z.string().min(1),
})

export const aiTestStreamEventSchema = z.discriminatedUnion('type', [
  aiTestStartEventSchema,
  aiTestTextDeltaEventSchema,
  aiTestDoneEventSchema,
  aiTestErrorEventSchema,
])

export type AiTestStreamEvent = z.infer<typeof aiTestStreamEventSchema>
