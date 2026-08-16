import { z } from 'zod'

import { apiErrorCodeSchema, isoDateTimeSchema, uuidSchema } from './common.js'

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

export const aiContentBlockMetadataSchema = z.object({
  turnIndex: z.number().int().min(0),
  contentIndex: z.number().int().min(0),
  blockId: z.string().min(1).max(200),
})

export type AiContentBlockMetadata = z.infer<typeof aiContentBlockMetadataSchema>

export const aiTextContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})

export type AiTextContent = z.infer<typeof aiTextContentSchema>

export const aiConversationTextBlockSchema = aiContentBlockMetadataSchema.extend({
  type: z.literal('text'),
  text: z.string(),
})

export const aiToolActivityStatusSchema = z.enum([
  'running',
  'succeeded',
  'not_found',
  'invalid_arguments',
  'forbidden',
  'failed',
  'timed_out',
  'cancelled',
  'interrupted',
])

export type AiToolActivityStatus = z.infer<typeof aiToolActivityStatusSchema>

export const aiToolErrorCodeSchema = z.enum([
  'AI.TOOL_NOT_FOUND',
  'AI.TOOL_INVALID_ARGUMENTS',
  'AI.TOOL_FORBIDDEN',
  'AI.TOOL_FAILED',
  'AI.TOOL_TIMED_OUT',
  'AI.TOOL_CANCELLED',
])

export type AiToolErrorCode = z.infer<typeof aiToolErrorCodeSchema>

export const aiToolActivitySchema = z.object({
  type: z.literal('tool_activity'),
  toolCallId: z.string().min(1).max(240),
  name: z.string().min(1).max(240),
  status: aiToolActivityStatusSchema,
  errorCode: aiToolErrorCodeSchema.nullable(),
})

export type AiToolActivity = z.infer<typeof aiToolActivitySchema>

export const aiToolActivityEventSchema = aiToolActivitySchema.omit({ type: true }).extend({
  type: z.literal('tool_activity'),
  ...aiContentBlockMetadataSchema.shape,
  safeSummary: z.string().max(1000).nullable(),
})

export type AiToolActivityEvent = z.infer<typeof aiToolActivityEventSchema>

export const aiConversationToolActivityBlockSchema = aiToolActivitySchema.omit({ type: true }).extend({
  type: z.literal('tool_activity'),
  ...aiContentBlockMetadataSchema.shape,
})

export const aiConversationContentBlockSchema = z.discriminatedUnion('type', [
  aiConversationTextBlockSchema,
  aiConversationToolActivityBlockSchema,
])

export type AiConversationContentBlock = z.infer<typeof aiConversationContentBlockSchema>

export const aiConversationUserMessageSchema = z.object({
  role: z.literal('user'),
  blocks: z.array(aiConversationTextBlockSchema),
})

export const aiAssistantMessageSchema = z.object({
  role: z.literal('assistant'),
  blocks: z.array(aiConversationContentBlockSchema),
})

export const aiConversationMessageSchema = z.discriminatedUnion('role', [
  aiConversationUserMessageSchema,
  aiAssistantMessageSchema,
])

export type AiConversationMessage = z.infer<typeof aiConversationMessageSchema>

export type AiAssistantMessage = z.infer<typeof aiAssistantMessageSchema>

export const aiConversationStatusSchema = z.enum(['idle', 'generating'])
export type AiConversationStatus = z.infer<typeof aiConversationStatusSchema>

export const aiConversationMessageStatusSchema = z.enum(['completed', 'streaming', 'aborted', 'failed', 'interrupted'])
export type AiConversationMessageStatus = z.infer<typeof aiConversationMessageStatusSchema>

export const aiGenerationStatusSchema = z.enum(['generating', 'succeeded', 'failed', 'aborted', 'interrupted'])
export type AiGenerationStatus = z.infer<typeof aiGenerationStatusSchema>

export const aiConversationStopReasonSchema = z.enum(['stop', 'length', 'tool_use'])
export type AiConversationStopReason = z.infer<typeof aiConversationStopReasonSchema>

export const aiConversationTitleSchema = z.string().trim().min(1).max(120)

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

export const createAiConversationSchema = z.object({
  title: aiConversationTitleSchema.optional(),
  systemPromptId: uuidSchema.optional(),
})
export type CreateAiConversationInput = z.infer<typeof createAiConversationSchema>

export const aiConversationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type AiConversationListQuery = z.infer<typeof aiConversationListQuerySchema>

export const aiConversationParamsSchema = z.object({
  conversationId: uuidSchema,
})

export const aiConversationGenerationParamsSchema = aiConversationParamsSchema.extend({
  generationId: uuidSchema,
})

export const sendAiConversationMessageSchema = z.object({
  text: z.string().trim().min(1).max(100_000),
  model: aiModelRefSchema.optional(),
  systemPromptId: uuidSchema.nullable().optional(),
})
export type SendAiConversationMessageInput = z.infer<typeof sendAiConversationMessageSchema>

export const retryAiConversationGenerationSchema = z.object({
  generationId: uuidSchema,
  model: aiModelRefSchema.optional(),
})
export type RetryAiConversationGenerationInput = z.infer<typeof retryAiConversationGenerationSchema>

export const aiConversationSummarySchema = z.object({
  id: uuidSchema,
  title: aiConversationTitleSchema,
  status: aiConversationStatusSchema,
  activeGenerationId: uuidSchema.nullable(),
  lastModel: aiModelRefSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})
export type AiConversationSummary = z.infer<typeof aiConversationSummarySchema>

export const aiConversationMessageDtoSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  sequence: z.number().int().min(1),
  role: z.enum(['user', 'assistant']),
  blocks: z.array(aiConversationContentBlockSchema),
  status: aiConversationMessageStatusSchema,
  model: aiModelRefSchema.nullable(),
  stopReason: aiConversationStopReasonSchema.nullable(),
  errorCode: apiErrorCodeSchema.nullable(),
  generationId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
})
export type AiConversationMessageDto = z.infer<typeof aiConversationMessageDtoSchema>

export const aiConversationDetailSchema = aiConversationSummarySchema.extend({
  messages: z.array(aiConversationMessageDtoSchema),
})
export type AiConversationDetail = z.infer<typeof aiConversationDetailSchema>

export const aiConversationListSchema = z.object({
  items: z.array(aiConversationSummarySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
})
export type AiConversationList = z.infer<typeof aiConversationListSchema>

export const aiConversationGenerationSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  status: aiGenerationStatusSchema,
  userMessageId: uuidSchema,
  assistantMessageId: uuidSchema,
  retryOfGenerationId: uuidSchema.nullable(),
  errorCode: apiErrorCodeSchema.nullable(),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
})
export type AiConversationGeneration = z.infer<typeof aiConversationGenerationSchema>

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
  toolName: z.string().min(1).max(240),
  status: aiToolExecutionAuditStatusSchema,
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().min(0).nullable(),
  timeoutMs: z.number().int().min(1),
  errorCode: z.string().max(120).nullable(),
})
export type AiToolExecutionAuditSummary = z.infer<typeof aiToolExecutionAuditSummarySchema>

export const aiModelCallAuditSchema = z.object({
  id: uuidSchema,
  requestId: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
  scenario: z.enum(['model_test', 'conversation']),
  conversationId: uuidSchema.nullable(),
  generationId: uuidSchema.nullable(),
  providerId: aiProviderIdSchema,
  modelId: aiModelIdSchema,
  startedAt: isoDateTimeSchema,
  timeoutMs: z.number().int().min(1),
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().min(0).nullable(),
  result: aiModelCallResultSchema,
  stopReason: aiModelCallStopReasonSchema.nullable(),
  errorCode: z.string().max(120).nullable(),
  usage: aiUsageSchema,
  cost: aiCostSchema.nullable(),
})
export type AiModelCallAudit = z.infer<typeof aiModelCallAuditSchema>

export const aiModelCallAuditDetailSchema = aiModelCallAuditSchema.extend({
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
  providerId: aiProviderIdSchema.optional(),
  modelId: aiModelIdSchema.optional(),
  result: aiModelCallAuditResultSchema.optional(),
  requestId: z.string().trim().min(1).max(200).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
})
export type AiModelCallAuditQuery = z.infer<typeof aiModelCallAuditQuerySchema>

export const aiConversationStartEventSchema = z.object({
  type: z.literal('start'),
  requestId: z.string().min(1),
  conversationId: uuidSchema,
  generationId: uuidSchema,
  assistantMessageId: uuidSchema,
  model: aiModelRefSchema,
})

export const aiConversationTextDeltaEventSchema = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
  ...aiContentBlockMetadataSchema.shape,
})

export const aiConversationCompletedEventSchema = z.object({
  type: z.literal('completed'),
  turnIndex: z.number().int().min(0),
  assistantMessage: aiAssistantMessageSchema,
  stopReason: aiConversationStopReasonSchema,
  usage: aiUsageSchema,
  cost: aiCostSchema.nullable(),
})

export const aiConversationErrorEventSchema = z.object({
  type: z.literal('error'),
  code: apiErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  requestId: z.string().min(1),
})

export const aiConversationStreamEventSchema = z.discriminatedUnion('type', [
  aiConversationStartEventSchema,
  aiConversationTextDeltaEventSchema,
  aiToolActivityEventSchema,
  aiConversationCompletedEventSchema,
  aiConversationErrorEventSchema,
])

export type AiConversationStreamEvent = z.infer<typeof aiConversationStreamEventSchema>

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
