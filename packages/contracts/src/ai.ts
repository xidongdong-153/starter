import { z } from 'zod'

import { apiErrorCodeSchema, isoDateTimeSchema, uuidSchema } from './common.js'

export const aiProviderIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9-]*$/)

export const aiProviderKindSchema = z.enum(['built_in', 'custom'])
export type AiProviderKind = z.infer<typeof aiProviderKindSchema>

export const customAiProviderProtocolSchema = z.enum(['openai-completions', 'openai-responses', 'anthropic-messages'])
export type CustomAiProviderProtocol = z.infer<typeof customAiProviderProtocolSchema>

const sessionAffinityFormatSchema = z.enum(['openai', 'openai-nosession', 'openrouter'])

export const openAiCompletionsCompatSchema = z.strictObject({
  supportsStore: z.boolean().optional(),
  supportsDeveloperRole: z.boolean().optional(),
  supportsReasoningEffort: z.boolean().optional(),
  supportsUsageInStreaming: z.boolean().optional(),
  supportsFinishReason: z.boolean().optional(),
  maxTokensField: z.enum(['max_completion_tokens', 'max_tokens']).optional(),
  requiresToolResultName: z.boolean().optional(),
  requiresAssistantAfterToolResult: z.boolean().optional(),
  requiresThinkingAsText: z.boolean().optional(),
  requiresReasoningContentOnAssistantMessages: z.boolean().optional(),
  thinkingFormat: z
    .enum([
      'openai',
      'openrouter',
      'deepseek',
      'together',
      'baseten',
      'zai',
      'qwen',
      'chat-template',
      'qwen-chat-template',
      'string-thinking',
      'ant-ling',
    ])
    .optional(),
  zaiToolStream: z.boolean().optional(),
  supportsThinkingTokenBudget: z.boolean().optional(),
  supportsOpenAIGrammarTools: z.boolean().optional(),
  supportsStrictMode: z.boolean().optional(),
  cacheControlFormat: z.literal('anthropic').optional(),
  sendSessionAffinityHeaders: z.boolean().optional(),
  deferredToolsMode: z.literal('kimi').optional(),
  sessionAffinityFormat: sessionAffinityFormatSchema.optional(),
  supportsLongCacheRetention: z.boolean().optional(),
})
export type OpenAiCompletionsCompat = z.infer<typeof openAiCompletionsCompatSchema>
export const customAiProviderOpenAiCompletionsCompatSchema = openAiCompletionsCompatSchema
export type CustomAiProviderOpenAiCompletionsCompat = OpenAiCompletionsCompat

export const openAiResponsesCompatSchema = z.strictObject({
  supportsDeveloperRole: z.boolean().optional(),
  sessionAffinityFormat: sessionAffinityFormatSchema.optional(),
  supportsLongCacheRetention: z.boolean().optional(),
  supportsStrictMode: z.boolean().optional(),
  supportsOpenAIGrammarTools: z.boolean().optional(),
  supportsToolSearch: z.boolean().optional(),
  supportsExplicitPromptCacheMode: z.boolean().optional(),
})
export type OpenAiResponsesCompat = z.infer<typeof openAiResponsesCompatSchema>
export const customAiProviderOpenAiResponsesCompatSchema = openAiResponsesCompatSchema
export type CustomAiProviderOpenAiResponsesCompat = OpenAiResponsesCompat

export const anthropicMessagesCompatSchema = z.strictObject({
  supportsEagerToolInputStreaming: z.boolean().optional(),
  supportsLongCacheRetention: z.boolean().optional(),
  sendSessionAffinityHeaders: z.boolean().optional(),
  supportsCacheControlOnTools: z.boolean().optional(),
  supportsTemperature: z.boolean().optional(),
  forceAdaptiveThinking: z.boolean().optional(),
  allowEmptySignature: z.boolean().optional(),
  supportsStrictTools: z.boolean().optional(),
  supportsToolReferences: z.boolean().optional(),
})
export type AnthropicMessagesCompat = z.infer<typeof anthropicMessagesCompatSchema>
export const customAiProviderAnthropicMessagesCompatSchema = anthropicMessagesCompatSchema
export type CustomAiProviderAnthropicMessagesCompat = AnthropicMessagesCompat

export const customAiProviderCompatSchema = z.union([
  openAiCompletionsCompatSchema,
  openAiResponsesCompatSchema,
  anthropicMessagesCompatSchema,
])
export type CustomAiProviderCompat = z.infer<typeof customAiProviderCompatSchema>

export const customAiProviderModelSchema = z.strictObject({
  modelId: z.string().trim().min(1).max(240),
  name: z.string().trim().min(1).max(240),
  contextWindow: z.number().int().min(1).max(10_000_000),
  maxOutputTokens: z.number().int().min(1).max(1_000_000),
  supportsImageInput: z.boolean(),
  supportsReasoning: z.boolean(),
  supportsTools: z.boolean(),
  inputCost: z.number().finite().min(0).max(1_000_000),
  outputCost: z.number().finite().min(0).max(1_000_000),
  cacheReadCost: z.number().finite().min(0).max(1_000_000),
  cacheWriteCost: z.number().finite().min(0).max(1_000_000),
})
export type CustomAiProviderModel = z.infer<typeof customAiProviderModelSchema>
export const customAiProviderModelDefinitionSchema = customAiProviderModelSchema
export type CustomAiProviderModelDefinition = CustomAiProviderModel

export const customAiProviderModelsSchema = z
  .array(customAiProviderModelSchema)
  .min(1)
  .max(200)
  .superRefine((models, context) => {
    const seen = new Set<string>()
    for (const [index, model] of models.entries()) {
      if (seen.has(model.modelId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'modelId'],
          message: '模型列表不能包含重复的 modelId',
        })
      }
      seen.add(model.modelId)
    }
  })

export const customAiProviderBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url()
  .refine((value) => /^https?:\/\//iu.test(value), {
    message: 'Base URL 只允许 HTTP(S) 协议',
  })
  .refine((value) => !/^https?:\/\/[^/]*@/iu.test(value), {
    message: 'Base URL 不能包含凭据',
  })
  .refine((value) => !/[?#]/u.test(value), {
    message: 'Base URL 不能包含 query 或 fragment',
  })
  .transform((value) => value.replace(/\/+$/u, ''))

const customAiProviderDefinitionBaseShape = {
  providerId: aiProviderIdSchema,
  name: z.string().trim().min(1).max(120),
  baseUrl: customAiProviderBaseUrlSchema,
  models: customAiProviderModelsSchema,
}

const openAiCompletionsDefinitionSchema = z.strictObject({
  ...customAiProviderDefinitionBaseShape,
  protocol: z.literal('openai-completions'),
  compat: openAiCompletionsCompatSchema,
})

const openAiResponsesDefinitionSchema = z.strictObject({
  ...customAiProviderDefinitionBaseShape,
  protocol: z.literal('openai-responses'),
  compat: openAiResponsesCompatSchema,
})

const anthropicMessagesDefinitionSchema = z.strictObject({
  ...customAiProviderDefinitionBaseShape,
  protocol: z.literal('anthropic-messages'),
  compat: anthropicMessagesCompatSchema,
})

export const customAiProviderDefinitionSchema = z.discriminatedUnion('protocol', [
  openAiCompletionsDefinitionSchema,
  openAiResponsesDefinitionSchema,
  anthropicMessagesDefinitionSchema,
])
export type CustomAiProviderDefinition = z.infer<typeof customAiProviderDefinitionSchema>

const customAiProviderSecretSchema = z.string().trim().min(1).max(16_384)

export const createCustomAiProviderSchema = z.discriminatedUnion('protocol', [
  openAiCompletionsDefinitionSchema.extend({ apiKey: customAiProviderSecretSchema.optional() }),
  openAiResponsesDefinitionSchema.extend({ apiKey: customAiProviderSecretSchema.optional() }),
  anthropicMessagesDefinitionSchema.extend({ apiKey: customAiProviderSecretSchema.optional() }),
])
export type CreateCustomAiProviderInput = z.infer<typeof createCustomAiProviderSchema>

const customAiProviderUpdateShape = {
  expectedRevision: z.number().int().min(1),
  apiKey: customAiProviderSecretSchema.optional(),
}

export const updateCustomAiProviderSchema = z.discriminatedUnion('protocol', [
  openAiCompletionsDefinitionSchema.omit({ providerId: true }).extend(customAiProviderUpdateShape),
  openAiResponsesDefinitionSchema.omit({ providerId: true }).extend(customAiProviderUpdateShape),
  anthropicMessagesDefinitionSchema.omit({ providerId: true }).extend(customAiProviderUpdateShape),
])
export type UpdateCustomAiProviderInput = z.infer<typeof updateCustomAiProviderSchema>

export const replaceCustomAiProviderModelsSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
  models: customAiProviderModelsSchema,
})
export type ReplaceCustomAiProviderModelsInput = z.infer<typeof replaceCustomAiProviderModelsSchema>
export const deleteCustomAiProviderSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
})
export type DeleteCustomAiProviderInput = z.infer<typeof deleteCustomAiProviderSchema>

export const checkCustomAiProviderSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
})
export type CheckCustomAiProviderInput = z.infer<typeof checkCustomAiProviderSchema>

export const updateCustomAiProviderCredentialSchema = z.strictObject({
  apiKey: customAiProviderSecretSchema,
})
export type UpdateCustomAiProviderCredentialInput = z.infer<typeof updateCustomAiProviderCredentialSchema>

const customAiProviderResponseShape = {
  kind: z.literal('custom'),
  revision: z.number().int().min(1),
  enabled: z.boolean(),
  authStatus: z.enum(['not_configured', 'needs_check', 'ready', 'error']),
  credentialMask: z.string().max(32).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}

export const customAiProviderSchema = z.discriminatedUnion('protocol', [
  openAiCompletionsDefinitionSchema.extend(customAiProviderResponseShape),
  openAiResponsesDefinitionSchema.extend(customAiProviderResponseShape),
  anthropicMessagesDefinitionSchema.extend(customAiProviderResponseShape),
])
export type CustomAiProvider = z.infer<typeof customAiProviderSchema>

export const aiScopeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^\w[\w.:-]*$/)

export const aiExternalUserIdSchema = z.string().trim().min(1).max(240)
export type AiExternalUserId = z.infer<typeof aiExternalUserIdSchema>
export const aiSubjectTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9._-]*$/)
export type AiSubjectType = z.infer<typeof aiSubjectTypeSchema>
export const aiSubjectIdSchema = z.string().trim().min(1).max(240)
export type AiSubjectId = z.infer<typeof aiSubjectIdSchema>

export const createAiApplicationSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  tenantId: aiScopeIdSchema,
  projectId: aiScopeIdSchema,
})
export type CreateAiApplicationInput = z.infer<typeof createAiApplicationSchema>

export const aiApplicationSchema = z.strictObject({
  appId: uuidSchema,
  name: z.string().min(1).max(120),
  tenantId: aiScopeIdSchema,
  projectId: aiScopeIdSchema,
  status: z.enum(['active', 'revoked']),
  secretPrefix: z.string().min(8).max(32),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  lastUsedAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
})
export type AiApplication = z.infer<typeof aiApplicationSchema>

export const aiApplicationSecretSchema = z.strictObject({
  application: aiApplicationSchema,
  secret: z.string().min(32).max(240),
})
export type AiApplicationSecret = z.infer<typeof aiApplicationSecretSchema>

export const aiApplicationParamsSchema = z.strictObject({ appId: uuidSchema })

export const aiRuntimeSubjectHeadersSchema = z
  .strictObject({
    externalUserId: aiExternalUserIdSchema,
    subjectType: aiSubjectTypeSchema.optional(),
    subjectId: aiSubjectIdSchema.optional(),
  })
  .superRefine((value, context) => {
    if ((value.subjectType === undefined) !== (value.subjectId === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'subjectType 和 subjectId 必须同时提供',
      })
    }
  })

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
  kind: aiProviderKindSchema,
  protocol: customAiProviderProtocolSchema.nullable(),
  baseUrl: z.string().url().nullable(),
  revision: z.number().int().min(0),
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

export const aiPromptNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, '只允许小写字母、数字与连字符（不能以连字符开头/结尾或连续连字符）')

export const aiPromptContentSchema = z.string().trim().min(1).max(8000)

export const systemPromptSchema = z.object({
  id: uuidSchema,
  name: aiPromptNameSchema,
  content: aiPromptContentSchema,
  enabled: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})
export type SystemPrompt = z.infer<typeof systemPromptSchema>

export const createSystemPromptSchema = z.object({
  name: aiPromptNameSchema,
  content: aiPromptContentSchema,
  enabled: z.boolean().optional(),
})
export type CreateSystemPromptInput = z.infer<typeof createSystemPromptSchema>

export const updateSystemPromptSchema = z.object({
  name: aiPromptNameSchema.optional(),
  content: aiPromptContentSchema.optional(),
  enabled: z.boolean().optional(),
})
export type UpdateSystemPromptInput = z.infer<typeof updateSystemPromptSchema>

export const updateGlobalSystemPromptSchema = z.object({
  systemPromptId: uuidSchema.nullable(),
})
export type UpdateGlobalSystemPromptInput = z.infer<typeof updateGlobalSystemPromptSchema>

export const promptTemplateSchema = z.object({
  id: uuidSchema,
  name: aiPromptNameSchema,
  description: z.string().max(200).default(''),
  content: aiPromptContentSchema,
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})
export type PromptTemplate = z.infer<typeof promptTemplateSchema>

export const createPromptTemplateSchema = z.object({
  name: aiPromptNameSchema,
  description: z.string().max(200).optional(),
  content: aiPromptContentSchema,
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})
export type CreatePromptTemplateInput = z.infer<typeof createPromptTemplateSchema>

export const updatePromptTemplateSchema = z.object({
  name: aiPromptNameSchema.optional(),
  description: z.string().max(200).optional(),
  content: aiPromptContentSchema.optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})
export type UpdatePromptTemplateInput = z.infer<typeof updatePromptTemplateSchema>

export const aiSkillDescriptionSchema = z.string().trim().min(1).max(1024)
export const aiSkillContentSchema = z.string().trim().min(1).max(32_000)

export const aiSkillSummarySchema = z.object({
  id: uuidSchema,
  name: aiPromptNameSchema,
  description: aiSkillDescriptionSchema,
  enabled: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})
export type AiSkillSummary = z.infer<typeof aiSkillSummarySchema>

export const aiSkillSchema = aiSkillSummarySchema.extend({
  content: aiSkillContentSchema,
})
export type AiSkill = z.infer<typeof aiSkillSchema>

export const aiToolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]{0,63}$/u)
export type AiToolName = z.infer<typeof aiToolNameSchema>

export const aiToolVersionSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+$/u)
export type AiToolVersion = z.infer<typeof aiToolVersionSchema>

export const aiToolRefSchema = z.strictObject({
  name: aiToolNameSchema,
  version: aiToolVersionSchema,
})
export type AiToolRef = z.infer<typeof aiToolRefSchema>

export const aiToolSummarySchema = z.strictObject({
  name: aiToolNameSchema,
  version: aiToolVersionSchema,
  description: z.string().min(1).max(1000),
  scope: z.union([z.literal('platform'), z.strictObject({ tenantId: aiScopeIdSchema, projectId: aiScopeIdSchema })]),
})
export type AiToolSummary = z.infer<typeof aiToolSummarySchema>

export const createAiSkillSchema = z.object({
  name: aiPromptNameSchema,
  description: aiSkillDescriptionSchema,
  content: aiSkillContentSchema,
  enabled: z.boolean().optional(),
})
export type CreateAiSkillInput = z.infer<typeof createAiSkillSchema>

export const updateAiSkillSchema = z.object({
  name: aiPromptNameSchema.optional(),
  description: aiSkillDescriptionSchema.optional(),
  content: aiSkillContentSchema.optional(),
  enabled: z.boolean().optional(),
})
export type UpdateAiSkillInput = z.infer<typeof updateAiSkillSchema>

export const agentLaneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^(?!_)\w[\w.-]*$/u)

export type AgentLane = z.infer<typeof agentLaneSchema>

export const agentThinkingLevelSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
export type AgentThinkingLevel = z.infer<typeof agentThinkingLevelSchema>

export const agentDefinitionStatusSchema = z.enum(['draft', 'enabled', 'disabled'])
export type AgentDefinitionStatus = z.infer<typeof agentDefinitionStatusSchema>

export const agentDefinitionNameSchema = z.string().trim().min(1).max(80)
export const agentDefinitionDescriptionSchema = z.string().max(500)

const agentSkillIdsSchema = z
  .array(uuidSchema)
  .max(64)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: '技能列表不能包含重复项' })
    }
  })

const agentToolRefsSchema = z
  .array(aiToolRefSchema)
  .max(64)
  .superRefine((values, context) => {
    const keys = values.map((ref) => `${ref.name}\u0000${ref.version}`)
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', message: '工具列表不能包含重复的 name@version' })
    }
  })

const strictAiModelRefSchema = aiModelRefSchema.strict()

export const aiOutputRenderKindSchema = z.enum(['plan', 'table', 'scorecard', 'decision', 'form', 'json'])
export type AiOutputRenderKind = z.infer<typeof aiOutputRenderKindSchema>

export const aiOutputModeSchema = z.enum(['optional', 'required'])
export type AiOutputMode = z.infer<typeof aiOutputModeSchema>

export const aiOutputVisibilitySchema = z.enum(['product', 'admin'])
export type AiOutputVisibility = z.infer<typeof aiOutputVisibilitySchema>

export const aiOutputContractRefSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9._-]*$/u),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  schemaHash: z.string().regex(/^[a-f0-9]{64}$/u),
  renderKind: aiOutputRenderKindSchema,
  visibility: aiOutputVisibilitySchema,
  mode: aiOutputModeSchema,
})
export type AiOutputContractRef = z.infer<typeof aiOutputContractRefSchema>

export const agentRunOutputContractSchema = aiOutputContractRefSchema.nullable()

/** Structured Output 的服务端校验后取值；`ai_structured_outputs.value_json` 读写用同一个 schema。 */
export const aiStructuredOutputValueSchema = z.record(z.string(), z.unknown())
export type AiStructuredOutputValue = z.infer<typeof aiStructuredOutputValueSchema>

export const agentDefinitionConfigSchema = z.strictObject({
  schemaVersion: z.literal(2),
  model: strictAiModelRefSchema.nullable(),
  systemPromptId: uuidSchema.nullable(),
  skillIds: agentSkillIdsSchema,
  toolRefs: agentToolRefsSchema,
  outputContract: aiOutputContractRefSchema.nullable().default(null),
  outputMode: aiOutputModeSchema.default('optional'),
  thinkingLevel: agentThinkingLevelSchema,
  maxTurns: z.number().int().min(1).max(32),
})

export type AgentDefinitionConfig = z.infer<typeof agentDefinitionConfigSchema>

export const defaultAgentDefinitionConfig = agentDefinitionConfigSchema.parse({
  schemaVersion: 2,
  model: null,
  systemPromptId: null,
  skillIds: [],
  toolRefs: [],
  outputContract: null,
  outputMode: 'optional',
  thinkingLevel: 'off',
  maxTurns: 8,
})

export const agentDefinitionSummarySchema = z.strictObject({
  id: uuidSchema,
  name: agentDefinitionNameSchema,
  description: agentDefinitionDescriptionSchema,
  status: agentDefinitionStatusSchema,
  revision: z.number().int().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export type AgentDefinitionSummary = z.infer<typeof agentDefinitionSummarySchema>

export const agentDefinitionDetailSchema = agentDefinitionSummarySchema.extend({
  config: agentDefinitionConfigSchema,
})

export type AgentDefinitionDetail = z.infer<typeof agentDefinitionDetailSchema>

export const agentDefinitionListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type AgentDefinitionListQuery = z.infer<typeof agentDefinitionListQuerySchema>

export const agentDefinitionSummaryListSchema = z.strictObject({
  items: z.array(agentDefinitionSummarySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
})

export type AgentDefinitionSummaryList = z.infer<typeof agentDefinitionSummaryListSchema>

export const agentDefinitionDetailListSchema = z.strictObject({
  items: z.array(agentDefinitionDetailSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
})

export type AgentDefinitionDetailList = z.infer<typeof agentDefinitionDetailListSchema>

export const createAgentDefinitionSchema = z.strictObject({
  name: agentDefinitionNameSchema,
  description: agentDefinitionDescriptionSchema.optional(),
  config: agentDefinitionConfigSchema.optional(),
})

export type CreateAgentDefinitionInput = z.infer<typeof createAgentDefinitionSchema>

export const updateAgentDefinitionSchema = z
  .strictObject({
    name: agentDefinitionNameSchema.optional(),
    description: agentDefinitionDescriptionSchema.optional(),
    config: agentDefinitionConfigSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: '至少提供一个要修改的字段',
  })

export type UpdateAgentDefinitionInput = z.infer<typeof updateAgentDefinitionSchema>

export const updateAgentDefinitionStatusSchema = z.strictObject({
  status: agentDefinitionStatusSchema,
})

export type UpdateAgentDefinitionStatusInput = z.infer<typeof updateAgentDefinitionStatusSchema>

export const agentSessionTitleSchema = z.string().trim().min(1).max(120)

export const agentSessionSchema = z.strictObject({
  id: uuidSchema,
  title: agentSessionTitleSchema,
  defaultAgentId: uuidSchema.nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export type AgentSession = z.infer<typeof agentSessionSchema>

export const createAgentSessionSchema = z.strictObject({
  title: agentSessionTitleSchema.optional(),
  defaultAgentId: uuidSchema.nullable().optional(),
})

export type CreateAgentSessionInput = z.infer<typeof createAgentSessionSchema>

export const updateAgentSessionSchema = z
  .strictObject({
    title: agentSessionTitleSchema.optional(),
    defaultAgentId: uuidSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: '至少提供一个要修改的字段',
  })

export type UpdateAgentSessionInput = z.infer<typeof updateAgentSessionSchema>

export const agentSessionListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type AgentSessionListQuery = z.infer<typeof agentSessionListQuerySchema>

export const agentSessionListSchema = z.strictObject({
  items: z.array(agentSessionSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
})

export type AgentSessionList = z.infer<typeof agentSessionListSchema>

export const agentTranscriptQuerySchema = z.strictObject({
  lane: agentLaneSchema.default('main'),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /**
   * 分页方向。`backward` 取比 cursor 更早的一页（cursor 省略时取最新一页），
   * `forward` 取比 cursor 更新的一页。两种方向的 `items` 都是时间正序。
   */
  direction: z.enum(['forward', 'backward']).default('backward'),
})

export type AgentTranscriptQuery = z.infer<typeof agentTranscriptQuerySchema>

const agentTranscriptItemBaseShape = {
  id: uuidSchema,
  sequence: z.number().int().min(1),
  lane: agentLaneSchema,
  createdAt: isoDateTimeSchema,
}

export const aiUsageSchema = z.object({
  inputTokens: z.number().int().min(0).nullable(),
  outputTokens: z.number().int().min(0).nullable(),
  cacheReadTokens: z.number().int().min(0).nullable(),
  cacheWriteTokens: z.number().int().min(0).nullable(),
  cacheWrite1hTokens: z.number().int().min(0).nullable(),
  reasoningTokens: z.number().int().min(0).nullable(),
  totalTokens: z.number().int().min(0).nullable(),
})

export type AiUsage = z.infer<typeof aiUsageSchema>

export const aiCostSchema = z.object({
  currency: z.literal('USD'),
  input: z.number().min(0),
  output: z.number().min(0),
  cacheRead: z.number().min(0),
  cacheWrite: z.number().min(0),
  total: z.number().min(0),
})

export type AiCost = z.infer<typeof aiCostSchema>

export const agentToolStatusSchema = z.enum([
  'succeeded',
  'not_found',
  'invalid_arguments',
  'forbidden',
  'failed',
  'timed_out',
  'cancelled',
  'interrupted',
])

export type AgentToolStatus = z.infer<typeof agentToolStatusSchema>

/**
 * assistant message 内部的有序内容块。
 * `text` 是给用户看的正文，`thinking` 是模型的思考内容（默认折叠展示）。
 * 工具入参不作为块暴露，只通过 `toolCalls` 暴露 id 和名称。
 */
export const agentMessageBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({ type: z.literal('thinking'), text: z.string() }),
])

export type AgentMessageBlock = z.infer<typeof agentMessageBlockSchema>

export const agentTranscriptUserMessageSchema = z.strictObject({
  ...agentTranscriptItemBaseShape,
  type: z.literal('user_message'),
  runId: uuidSchema,
  content: z.string(),
})

export const agentTranscriptAssistantMessageSchema = z.strictObject({
  ...agentTranscriptItemBaseShape,
  type: z.literal('assistant_message'),
  runId: uuidSchema,
  /** 纯文字拼接，语义不变，只包含 text 块。 */
  content: z.string(),
  /** 按原始顺序保留的 text 与 thinking 块；缺失时回退到 `content`。 */
  blocks: z.array(agentMessageBlockSchema).max(64).optional(),
  status: z.enum(['completed', 'failed', 'aborted', 'interrupted']),
  model: strictAiModelRefSchema,
  stopReason: z.enum(['stop', 'length', 'tool_use']).nullable(),
  errorCode: apiErrorCodeSchema.nullable(),
  usage: aiUsageSchema.nullish(),
  toolCalls: z
    .array(
      z.strictObject({
        toolCallId: z.string().min(1).max(240),
        name: z.string().min(1).max(240),
      }),
    )
    .max(64)
    .optional(),
})

export const agentTranscriptToolActivitySchema = z.strictObject({
  ...agentTranscriptItemBaseShape,
  type: z.literal('tool_activity'),
  runId: uuidSchema,
  toolCallId: z.string().min(1).max(240),
  name: z.string().min(1).max(240),
  status: agentToolStatusSchema,
  errorCode: apiErrorCodeSchema.nullable(),
  safeSummary: z.string().max(1000).nullable(),
})

export const agentTranscriptSystemSchema = z.strictObject({
  ...agentTranscriptItemBaseShape,
  type: z.literal('system'),
  runId: uuidSchema.nullable(),
  kind: z.literal('compaction'),
  summary: z.string(),
  tokensBefore: z.number().int().min(0).nullish(),
})

export const agentTranscriptItemSchema = z.discriminatedUnion('type', [
  agentTranscriptUserMessageSchema,
  agentTranscriptAssistantMessageSchema,
  agentTranscriptToolActivitySchema,
  agentTranscriptSystemSchema,
])

export type AgentTranscriptItem = z.infer<typeof agentTranscriptItemSchema>

export const agentTranscriptSchema = z.strictObject({
  items: z.array(agentTranscriptItemSchema),
  nextCursor: z.number().int().min(1).nullable(),
})

export type AgentTranscript = z.infer<typeof agentTranscriptSchema>

export const agentRunStatusSchema = z.enum(['starting', 'running', 'completed', 'failed', 'aborted', 'interrupted'])
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>

export const agentRunSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(2),
  agentId: uuidSchema,
  agentRevision: z.number().int().min(1),
  model: strictAiModelRefSchema,
  systemPromptId: uuidSchema.nullable(),
  skillIds: agentSkillIdsSchema,
  toolRefs: agentToolRefsSchema,
  outputContract: aiOutputContractRefSchema.nullable().default(null),
  outputMode: aiOutputModeSchema.default('optional'),
  thinkingLevel: agentThinkingLevelSchema,
  maxTurns: z.number().int().min(1).max(32),
})

export type AgentRunSnapshot = z.infer<typeof agentRunSnapshotSchema>

export const agentRunLiveSnapshotSchema = z.strictObject({
  lastSequence: z.number().int().min(0),
  turn: z.number().int().min(0),
  maxTurns: z.number().int().min(1).max(32),
  /** 按 sequence 排序的一条时间线，与 Admin reducer 同构；超过 128 条丢最旧的。 */
  timeline: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('message'),
          messageId: uuidSchema,
          blocks: z.array(agentMessageBlockSchema).max(64),
          completed: z.boolean(),
          usage: aiUsageSchema.nullish(),
        }),
        z.strictObject({
          kind: z.literal('tool'),
          toolCallId: z.string().min(1).max(240),
          name: z.string().min(1).max(240),
          status: z.union([agentToolStatusSchema, z.literal('running')]),
          safeSummary: z.string().max(1000).nullable(),
        }),
        z.strictObject({
          kind: z.literal('compaction'),
          entryId: uuidSchema,
          summary: z.string(),
        }),
      ]),
    )
    .max(128),
})

export type AgentRunLiveSnapshot = z.infer<typeof agentRunLiveSnapshotSchema>

export type AgentRunLiveTimelineItem = AgentRunLiveSnapshot['timeline'][number]

export const agentRunSchema = z
  .strictObject({
    id: uuidSchema,
    sessionId: uuidSchema,
    agentId: uuidSchema,
    agentRevision: z.number().int().min(1),
    lane: agentLaneSchema,
    status: agentRunStatusSchema,
    snapshot: agentRunSnapshotSchema,
    requestId: z.string().min(1).max(200),
    finalEntryId: uuidSchema.nullable(),
    errorCode: apiErrorCodeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    live: agentRunLiveSnapshotSchema.nullish(),
  })
  .superRefine((run, context) => {
    if (run.snapshot.agentId !== run.agentId) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot', 'agentId'],
        message: 'Run snapshot 的 Agent 必须与 Run 一致',
      })
    }
    if (run.snapshot.agentRevision !== run.agentRevision) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot', 'agentRevision'],
        message: 'Run snapshot 的 revision 必须与 Run 一致',
      })
    }

    const issue = (path: 'finishedAt' | 'finalEntryId' | 'errorCode', message: string) =>
      context.addIssue({ code: 'custom', path: [path], message })

    if (run.status === 'starting' || run.status === 'running') {
      if (run.finishedAt !== null) issue('finishedAt', '非终态 Run 不能包含 finishedAt')
      if (run.finalEntryId !== null) issue('finalEntryId', '非终态 Run 不能包含 finalEntryId')
      if (run.errorCode !== null) issue('errorCode', '非终态 Run 不能包含 errorCode')
      return
    }
    if (run.live) {
      context.addIssue({ code: 'custom', path: ['live'], message: '终态 Run 不能包含 live 快照' })
    }
    if (run.finishedAt === null) issue('finishedAt', '终态 Run 必须包含 finishedAt')
    if (run.status === 'completed') {
      if (run.finalEntryId === null) issue('finalEntryId', '完成的 Run 必须包含 finalEntryId')
      if (run.errorCode !== null) issue('errorCode', '完成的 Run 不能包含 errorCode')
    }
    if (run.status === 'failed' && run.errorCode === null) issue('errorCode', '失败的 Run 必须包含 errorCode')
    if (run.status === 'aborted' && run.errorCode !== 'AI.REQUEST_ABORTED') {
      issue('errorCode', '已取消的 Run 必须使用 AI.REQUEST_ABORTED')
    }
    if (run.status === 'interrupted' && run.errorCode !== 'AI.RUN_INTERRUPTED') {
      issue('errorCode', '已中断的 Run 必须使用 AI.RUN_INTERRUPTED')
    }
  })

export type AgentRun = z.infer<typeof agentRunSchema>

const agentRunInputTextSchema = z.string().trim().min(1).max(100_000)

export const startAgentRunSchema = z.strictObject({
  agentId: uuidSchema.optional(),
  lane: agentLaneSchema.optional(),
  input: agentRunInputTextSchema,
})

export type StartAgentRunInput = z.infer<typeof startAgentRunSchema>

export const steerAgentRunSchema = z.strictObject({ text: agentRunInputTextSchema })
export type SteerAgentRunInput = z.infer<typeof steerAgentRunSchema>

export const followUpAgentRunSchema = z.strictObject({ text: agentRunInputTextSchema })
export type FollowUpAgentRunInput = z.infer<typeof followUpAgentRunSchema>

export const runEventLaneSchema = agentLaneSchema
const runEventAssociationShape = {
  turnIndex: z.number().int().min(1).nullable(),
  stepId: uuidSchema.nullable(),
  modelCallId: uuidSchema.nullable(),
  messageId: uuidSchema.nullable(),
  toolCallId: z.string().min(1).max(240).nullable(),
  toolExecutionId: uuidSchema.nullable(),
}

const runEventEnvelopeShape = {
  eventId: uuidSchema,
  sequence: z.number().int().min(1),
  occurredAt: isoDateTimeSchema,
  runId: uuidSchema,
  sessionId: uuidSchema,
  lane: runEventLaneSchema,
  ...runEventAssociationShape,
}

const runEventUsageShape = aiUsageSchema.optional()
export const aiErrorCategorySchema = z.enum([
  'auth',
  'upstream',
  'timeout',
  'cancelled',
  'storage',
  'tool',
  'validation',
  'unknown',
])
export type AiErrorCategory = z.infer<typeof aiErrorCategorySchema>

const runEventErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  category: aiErrorCategorySchema,
  retryable: z.boolean(),
})
const runEventToolStatusSchema = z.enum([
  'succeeded',
  'not_found',
  'invalid_arguments',
  'forbidden',
  'failed',
  'timed_out',
  'cancelled',
  'interrupted',
])
const runEventOutcomeSchema = z.enum(['succeeded', 'failed', 'aborted', 'retry', 'deferred', 'overflow'])
const runEventSafeTextSchema = z.string().max(1000)

/**
 * 工具上报的引用来源。产品事件 `source.available` 的 data 就是它。
 *
 * `uri` 只放可安全展示的 http/https 链接，服务端会按出站守卫的同级规则校验；
 * `excerpt` 是脱敏摘要，不放原始工具结果。
 */
export const aiSourceSchema = z.strictObject({
  sourceId: z.string().min(1).max(240),
  kind: z.string().min(1).max(80),
  title: z.string().min(1).max(500),
  uri: z.string().url().nullable(),
  excerpt: runEventSafeTextSchema.nullable(),
})
export type AiSource = z.infer<typeof aiSourceSchema>

const runEventSchemas = [
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('run.started'),
    data: z.strictObject({
      agentId: uuidSchema,
      agentRevision: z.number().int().min(1),
      model: strictAiModelRefSchema,
      outputContract: aiOutputContractRefSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('run.completed'),
    data: z.strictObject({
      finalEntryId: uuidSchema.nullable(),
      reason: z.enum(['model_finished', 'max_turns', 'structured_output']),
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('run.failed'),
    data: z.strictObject({ error: runEventErrorSchema, finalEntryId: uuidSchema.nullable() }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('run.aborted'),
    data: z.strictObject({ code: z.literal('AI.REQUEST_ABORTED') }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('turn.started'),
    data: z.strictObject({ stepLimit: z.number().int().min(1).max(32) }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('turn.completed'),
    data: z.strictObject({
      stepCount: z.number().int().min(0),
      toolCount: z.number().int().min(0),
      outcome: runEventOutcomeSchema,
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('step.started'),
    data: z.strictObject({
      kind: z.enum(['assistant', 'compaction', 'branch_summary']),
      attempt: z.number().int().min(1),
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('step.completed'),
    data: z.strictObject({
      kind: z.enum(['assistant', 'compaction', 'branch_summary']),
      attempt: z.number().int().min(1),
      outcome: runEventOutcomeSchema,
      error: runEventErrorSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('model_call.started'),
    data: z.strictObject({
      providerId: aiProviderIdSchema,
      modelId: aiModelIdSchema,
      api: z.string().min(1).max(80),
      streaming: z.boolean(),
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('model_call.first_output'),
    data: z.strictObject({ elapsedMs: z.number().int().min(0) }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('model_call.completed'),
    data: z.strictObject({
      responseModel: aiModelIdSchema.nullable(),
      responseId: z.string().max(240).nullable(),
      stopReason: z.enum(['stop', 'length', 'tool_use', 'aborted', 'error', 'deferred']),
      usage: aiUsageSchema.nullable(),
      cost: aiCostSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('model_call.failed'),
    data: z.strictObject({ error: runEventErrorSchema }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('message.started'),
    data: z.strictObject({ role: z.enum(['user', 'assistant']), partPolicy: z.enum(['text', 'text_and_thinking']) }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('message.delta'),
    data: z.strictObject({ partId: z.string().min(1).max(240), delta: z.string().max(8192) }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('message.completed'),
    data: z.strictObject({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      stopReason: z.enum(['stop', 'length', 'tool_use']).nullable(),
      usage: runEventUsageShape,
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('thinking.started'),
    data: z.strictObject({ blockIndex: z.number().int().min(0), display: z.boolean() }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('thinking.delta'),
    data: z.strictObject({ blockIndex: z.number().int().min(0), delta: z.string().max(8192) }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('thinking.completed'),
    data: z.strictObject({
      blockIndex: z.number().int().min(0),
      display: z.boolean(),
      summary: runEventSafeTextSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('tool.started'),
    data: z.strictObject({ name: aiToolNameSchema, version: aiToolVersionSchema }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('tool.progress'),
    data: z.strictObject({ summary: runEventSafeTextSchema, state: z.enum(['running', 'waiting', 'retrying']) }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('tool.completed'),
    data: z.strictObject({
      name: aiToolNameSchema,
      version: aiToolVersionSchema,
      status: runEventToolStatusSchema,
      summary: runEventSafeTextSchema.nullable(),
      entryId: uuidSchema.nullable(),
      error: runEventErrorSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('context.compacted'),
    data: z.strictObject({
      entryId: uuidSchema,
      tokensBefore: z.number().int().min(0),
      summary: runEventSafeTextSchema,
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('structured_output.available'),
    data: z.strictObject({
      contract: aiOutputContractRefSchema,
      value: aiStructuredOutputValueSchema.nullable(),
      referenceId: uuidSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...runEventEnvelopeShape,
    type: z.literal('source.available'),
    data: aiSourceSchema,
  }),
] as const

export const runEventSchema = z.discriminatedUnion('type', runEventSchemas)
export type RunEvent = z.infer<typeof runEventSchema>

export const runTimelineQuerySchema = z.strictObject({
  afterSequence: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
})
export type RunTimelineQuery = z.infer<typeof runTimelineQuerySchema>

export const runTimelineSchema = z.strictObject({
  items: z.array(runEventSchema),
  afterSequence: z.number().int().min(0),
  nextSequence: z.number().int().min(0).nullable(),
  hasMore: z.boolean(),
})
export type RunTimeline = z.infer<typeof runTimelineSchema>

export const runTraceNodeSchema = z.strictObject({
  id: uuidSchema,
  parentId: uuidSchema.nullable(),
  kind: z.enum(['run', 'turn', 'step', 'model_call', 'tool_execution']),
  status: z.enum(['running', 'succeeded', 'failed', 'aborted', 'retry', 'deferred', 'overflow']),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().min(0).nullable(),
  error: runEventErrorSchema.nullable(),
  attributes: z.record(z.string(), z.string().max(240)),
})
export type RunTraceNode = z.infer<typeof runTraceNodeSchema>

export const runTraceSchema = z.strictObject({
  runId: uuidSchema,
  nodes: z.array(runTraceNodeSchema).max(2000),
})
export type RunTrace = z.infer<typeof runTraceSchema>

export const starterRunDataSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    runId: uuidSchema,
    sessionId: uuidSchema,
    lane: agentLaneSchema,
    agentId: uuidSchema,
    agentRevision: z.number().int().min(1),
    status: z.enum(['completed', 'failed', 'aborted']),
    finalEntryId: uuidSchema.nullable(),
    errorCode: apiErrorCodeSchema.nullable(),
    finishedAt: z.number().int().min(0),
  })
  .superRefine((entry, context) => {
    if (entry.status === 'completed' && entry.finalEntryId === null) {
      context.addIssue({ code: 'custom', path: ['finalEntryId'], message: '完成的 Run 必须包含 finalEntryId' })
    }
    if (entry.status === 'completed' && entry.errorCode !== null) {
      context.addIssue({ code: 'custom', path: ['errorCode'], message: '完成的 Run 不能包含 errorCode' })
    }
    if (entry.status === 'failed' && entry.errorCode === null) {
      context.addIssue({ code: 'custom', path: ['errorCode'], message: '失败的 Run 必须包含 errorCode' })
    }
    if (entry.status === 'aborted' && entry.errorCode !== 'AI.REQUEST_ABORTED') {
      context.addIssue({ code: 'custom', path: ['errorCode'], message: '已取消的 Run 必须使用 AI.REQUEST_ABORTED' })
    }
  })

export type StarterRunData = z.infer<typeof starterRunDataSchema>

export const starterRunEntrySchema = z.strictObject({
  type: z.literal('custom'),
  id: uuidSchema,
  customType: z.literal('starter.run'),
  data: starterRunDataSchema,
})

export type StarterRunEntry = z.infer<typeof starterRunEntrySchema>

export const aiModelCallResultSchema = z.enum([
  'running',
  'succeeded',
  'auth_failed',
  'upstream_failed',
  'timed_out',
  'cancelled',
  'interrupted',
])
export type AiModelCallResult = z.infer<typeof aiModelCallResultSchema>

export const aiModelCallStopReasonSchema = z.enum(['stop', 'length', 'tool_use', 'aborted', 'error', 'deferred'])
export type AiModelCallStopReason = z.infer<typeof aiModelCallStopReasonSchema>

export const aiToolExecutionAuditStatusSchema = z.enum([
  'running',
  'succeeded',
  'not_found',
  'invalid_arguments',
  'forbidden',
  'timed_out',
  'cancelled',
  'failed',
  'interrupted',
])
export type AiToolExecutionAuditStatus = z.infer<typeof aiToolExecutionAuditStatusSchema>

export const aiToolExecutionAuditSummarySchema = z.object({
  id: uuidSchema,
  /** Run 关联只在 Agent Run 的 Tool 执行上有值；模型测试没有 Run。 */
  runId: uuidSchema.nullable(),
  turnId: uuidSchema.nullable(),
  stepId: uuidSchema.nullable(),
  modelCallId: uuidSchema.nullable(),
  toolCallId: z.string().min(1).max(240).nullable(),
  toolExecutionId: uuidSchema.nullable(),
  toolName: z.string().min(1).max(240),
  /** 已注册 Tool 的新记录必须写入精确版本；历史记录与未注册 Tool 的 not_found 记录允许 null。 */
  toolVersion: aiToolVersionSchema.nullable(),
  status: aiToolExecutionAuditStatusSchema,
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().min(0).nullable(),
  timeoutMs: z.number().int().min(1),
  errorCode: z.string().max(120).nullable(),
  /** 从 errorCode 推导的稳定失败类别；成功记录为 null。 */
  errorCategory: aiErrorCategorySchema.nullable(),
})
export type AiToolExecutionAuditSummary = z.infer<typeof aiToolExecutionAuditSummarySchema>

export const aiModelCallAuditSchema = z
  .object({
    id: uuidSchema,
    requestId: z.string().min(1).max(200),
    userId: z.string().min(1).max(200),
    appId: z.string().nullable(),
    principalKind: z.enum(['starter_user', 'product_app']),
    tenantId: z.string().min(1).max(200),
    projectId: z.string().min(1).max(200),
    externalUserId: z.string().nullable(),
    scenario: z.enum(['model_test', 'agent_run', 'legacy']),
    runId: uuidSchema.nullable(),
    turnId: uuidSchema.nullable(),
    stepId: uuidSchema.nullable(),
    providerId: aiProviderIdSchema,
    modelId: aiModelIdSchema,
    api: z.string().min(1).max(80).nullable(),
    startedAt: isoDateTimeSchema,
    timeoutMs: z.number().int().min(1),
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: z.number().int().min(0).nullable(),
    /** 首个模型输出的时延（ms）；没有输出时为 null。 */
    ttftMs: z.number().int().min(0).nullable(),
    chunkCount: z.number().int().min(0).nullable(),
    responseModel: z.string().max(240).nullable(),
    responseId: z.string().max(240).nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    result: aiModelCallResultSchema,
    stopReason: aiModelCallStopReasonSchema.nullable(),
    errorCode: z.string().max(120).nullable(),
    /** 从 errorCode 推导的稳定失败类别；成功记录为 null。 */
    errorCategory: aiErrorCategorySchema.nullable(),
    usage: aiUsageSchema,
    cost: aiCostSchema.nullable(),
  })
  .superRefine((call, context) => {
    const issue = (path: 'runId' | 'scenario', message: string) =>
      context.addIssue({ code: 'custom', path: [path], message })
    if (call.scenario === 'model_test' && call.runId !== null) {
      issue('scenario', '模型测试不能包含 Run 关联')
    }
    if (call.scenario === 'agent_run' && call.runId === null) {
      issue('runId', 'Agent Run 调用必须包含 runId')
    }
    if (call.scenario === 'legacy' && call.runId !== null) {
      issue('runId', 'legacy 调用不能包含 runId')
    }
  })
export type AiModelCallAudit = z.infer<typeof aiModelCallAuditSchema>

export const aiModelCallAuditDetailSchema = aiModelCallAuditSchema.safeExtend({
  toolExecutions: z.array(aiToolExecutionAuditSummarySchema),
})
export type AiModelCallAuditDetail = z.infer<typeof aiModelCallAuditDetailSchema>

export const aiModelCallAuditListSchema = z.object({
  items: z.array(aiModelCallAuditSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
})
export type AiModelCallAuditList = z.infer<typeof aiModelCallAuditListSchema>

export const aiModelCallAuditResultSchema = aiModelCallResultSchema.exclude(['running'])
export const aiModelCallAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  userId: z.string().trim().min(1).max(200).optional(),
  appId: z.string().trim().min(1).max(200).optional(),
  tenantId: z.string().trim().min(1).max(200).optional(),
  projectId: z.string().trim().min(1).max(200).optional(),
  externalUserId: z.string().trim().min(1).max(200).optional(),
  providerId: aiProviderIdSchema.optional(),
  modelId: aiModelIdSchema.optional(),
  result: aiModelCallAuditResultSchema.optional(),
  requestId: z.string().trim().min(1).max(200).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
})
export type AiModelCallAuditQuery = z.infer<typeof aiModelCallAuditQuerySchema>

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
