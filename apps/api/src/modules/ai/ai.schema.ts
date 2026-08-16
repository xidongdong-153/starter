import { relations, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "@api/modules/auth/auth.schema.js";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const aiProviderConfigs = sqliteTable(
  "ai_provider_configs",
  {
    providerId: text("provider_id").primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    credentialType: text("credential_type"),
    credentialHint: text("credential_hint"),
    payloadCiphertext: text("payload_ciphertext"),
    payloadIv: text("payload_iv"),
    payloadAuthTag: text("payload_auth_tag"),
    encryptionVersion: integer("encryption_version"),
    rowVersion: integer("row_version").notNull().default(0),
    configRevision: integer("config_revision").notNull().default(0),
    checkedConfigRevision: integer("checked_config_revision"),
    authStatus: text("auth_status").notNull().default("not_configured"),
    authSource: text("auth_source"),
    lastCheckedAt: timestamp("last_checked_at"),
    lastCheckErrorCode: text("last_check_error_code"),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("ai_provider_configs_enabled_idx").on(table.enabled),
    check(
      "ai_provider_payload_all_or_none",
      sql`(payload_ciphertext IS NULL AND payload_iv IS NULL AND payload_auth_tag IS NULL AND encryption_version IS NULL) OR (payload_ciphertext IS NOT NULL AND payload_iv IS NOT NULL AND payload_auth_tag IS NOT NULL AND encryption_version IS NOT NULL)`,
    ),
    check(
      "ai_provider_credential_type",
      sql`credential_type IS NULL OR credential_type IN ('api_key', 'oauth')`,
    ),
  ],
);

export const aiModelCatalogs = sqliteTable("ai_model_catalogs", {
  providerId: text("provider_id").primaryKey(),
  modelsJson: text("models_json").notNull(),
  checkedAt: timestamp("checked_at"),
  lastModified: timestamp("last_modified"),
  etag: text("etag"),
  updatedAt: timestamp("updated_at").notNull(),
});

export const aiEnabledModels = sqliteTable(
  "ai_enabled_models",
  {
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    enabledAt: timestamp("enabled_at").notNull(),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    primaryKey({ columns: [table.providerId, table.modelId] }),
    index("ai_enabled_models_provider_idx").on(table.providerId),
  ],
);

export const aiSystemPrompts = sqliteTable("ai_system_prompts", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  content: text("content").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedBy: text("updated_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const aiPromptTemplates = sqliteTable(
  "ai_prompt_templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description").notNull().default(""),
    content: text("content").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("ai_prompt_templates_enabled_sort_idx").on(
      table.enabled,
      table.sortOrder,
    ),
  ],
);

export const aiSkills = sqliteTable(
  "ai_skills",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description").notNull(),
    content: text("content").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("ai_skills_enabled_name_idx").on(table.enabled, table.name),
  ],
);

export const aiSettings = sqliteTable(
  "ai_settings",
  {
    id: text("id").primaryKey(),
    globalProviderId: text("global_provider_id"),
    globalModelId: text("global_model_id"),
    globalSystemPromptId: text("global_system_prompt_id").references(
      () => aiSystemPrompts.id,
      { onDelete: "set null" },
    ),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (_table) => [
    check(
      "ai_settings_global_model_pair",
      sql`(global_provider_id IS NULL AND global_model_id IS NULL) OR (global_provider_id IS NOT NULL AND global_model_id IS NOT NULL)`,
    ),
  ],
);

export const userAiPreferences = sqliteTable(
  "user_ai_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (_table) => [
    check(
      "user_ai_preferences_model_pair",
      sql`(provider_id IS NULL AND model_id IS NULL) OR (provider_id IS NOT NULL AND model_id IS NOT NULL)`,
    ),
  ],
);

export const aiProviderConfigsRelations = relations(
  aiProviderConfigs,
  ({ one }) => ({
    updater: one(user, {
      fields: [aiProviderConfigs.updatedBy],
      references: [user.id],
    }),
  }),
);

export const aiEnabledModelsRelations = relations(
  aiEnabledModels,
  ({ one }) => ({
    updater: one(user, {
      fields: [aiEnabledModels.updatedBy],
      references: [user.id],
    }),
  }),
);

export const aiSettingsRelations = relations(aiSettings, ({ one }) => ({
  updater: one(user, { fields: [aiSettings.updatedBy], references: [user.id] }),
}));

export const userAiPreferencesRelations = relations(
  userAiPreferences,
  ({ one }) => ({
    user: one(user, {
      fields: [userAiPreferences.userId],
      references: [user.id],
    }),
  }),
);

export const aiModelCalls = sqliteTable(
  "ai_model_calls",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    userId: text("user_id").notNull(),
    scenario: text("scenario").notNull(),
    conversationId: text("conversation_id").references(
      // eslint-disable-next-line ts/no-use-before-define -- 审计记录通过延迟回调引用后声明的会话表。
      (): AnySQLiteColumn => aiConversations.id,
      {
        onDelete: "set null",
      },
    ),
    generationId: text("generation_id").references(
      // eslint-disable-next-line ts/no-use-before-define -- 审计记录通过延迟回调引用后声明的 generation 表。
      (): AnySQLiteColumn => aiGenerations.id,
      {
        onDelete: "set null",
      },
    ),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    startedAt: timestamp("started_at").notNull(),
    timeoutMs: integer("timeout_ms").notNull().default(120_000),
    finishedAt: timestamp("finished_at"),
    durationMs: integer("duration_ms"),
    result: text("result").notNull(),
    stopReason: text("stop_reason"),
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    cacheWrite1hTokens: integer("cache_write_1h_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    totalTokens: integer("total_tokens"),
    costInput: real("cost_input"),
    costOutput: real("cost_output"),
    costCacheRead: real("cost_cache_read"),
    costCacheWrite: real("cost_cache_write"),
    costTotal: real("cost_total"),
    costCurrency: text("cost_currency"),
  },
  (table) => [
    index("ai_model_calls_started_idx").on(table.startedAt, table.id),
    index("ai_model_calls_user_started_idx").on(table.userId, table.startedAt),
    index("ai_model_calls_provider_model_started_idx").on(
      table.providerId,
      table.modelId,
      table.startedAt,
    ),
    index("ai_model_calls_result_started_idx").on(
      table.result,
      table.startedAt,
    ),
    index("ai_model_calls_request_started_idx").on(
      table.requestId,
      table.startedAt,
    ),
  ],
);

export const aiToolExecutions = sqliteTable(
  "ai_tool_executions",
  {
    id: text("id").primaryKey(),
    aiCallId: text("ai_call_id")
      .notNull()
      .references(() => aiModelCalls.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at"),
    durationMs: integer("duration_ms"),
    status: text("status").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    errorCode: text("error_code"),
  },
  (table) => [
    index("ai_tool_executions_call_started_idx").on(
      table.aiCallId,
      table.startedAt,
      table.id,
    ),
    index("ai_tool_executions_status_started_idx").on(
      table.status,
      table.startedAt,
    ),
  ],
);

export const aiConversations = sqliteTable(
  "ai_conversations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("idle"),
    activeGenerationId: text("active_generation_id"),
    systemPromptId: text("system_prompt_id").references(
      () => aiSystemPrompts.id,
      { onDelete: "set null" },
    ),
    lastProviderId: text("last_provider_id"),
    lastModelId: text("last_model_id"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("ai_conversations_owner_updated_idx").on(
      table.ownerId,
      table.updatedAt,
      table.id,
    ),
    index("ai_conversations_owner_active_idx").on(
      table.ownerId,
      table.activeGenerationId,
    ),
  ],
);

export const aiConversationMessages = sqliteTable(
  "ai_conversation_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    role: text("role").notNull(),
    contentJson: text("content_json").notNull(),
    status: text("status").notNull(),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    stopReason: text("stop_reason"),
    errorCode: text("error_code"),
    generationId: text("generation_id").references(
      // eslint-disable-next-line ts/no-use-before-define -- 会话消息与 generation 互相引用，保留延迟解析以支持 SQLite 外键。
      (): AnySQLiteColumn => aiGenerations.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    uniqueIndex("ai_conversation_messages_sequence_unique").on(
      table.conversationId,
      table.sequence,
    ),
    index("ai_conversation_messages_conversation_sequence_idx").on(
      table.conversationId,
      table.sequence,
    ),
    index("ai_conversation_messages_generation_idx").on(table.generationId),
  ],
);

export const aiGenerations = sqliteTable(
  "ai_generations",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    retryOfGenerationId: text("retry_of_generation_id").references(
      (): AnySQLiteColumn => aiGenerations.id,
      { onDelete: "set null" },
    ),
    userMessageId: text("user_message_id")
      .notNull()
      .references(() => aiConversationMessages.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at"),
    errorCode: text("error_code"),
  },
  (table) => [
    index("ai_generations_owner_conversation_idx").on(
      table.ownerId,
      table.conversationId,
      table.startedAt,
      table.id,
    ),
    index("ai_generations_user_message_idx").on(table.userMessageId),
  ],
);

export const aiModelCallsRelations = relations(
  aiModelCalls,
  ({ one, many }) => ({
    conversation: one(aiConversations, {
      fields: [aiModelCalls.conversationId],
      references: [aiConversations.id],
    }),
    generation: one(aiGenerations, {
      fields: [aiModelCalls.generationId],
      references: [aiGenerations.id],
    }),
    toolExecutions: many(aiToolExecutions),
  }),
);

export const aiToolExecutionsRelations = relations(
  aiToolExecutions,
  ({ one }) => ({
    modelCall: one(aiModelCalls, {
      fields: [aiToolExecutions.aiCallId],
      references: [aiModelCalls.id],
    }),
  }),
);

export const aiConversationsRelations = relations(
  aiConversations,
  ({ one, many }) => ({
    owner: one(user, {
      fields: [aiConversations.ownerId],
      references: [user.id],
    }),
    messages: many(aiConversationMessages),
    generations: many(aiGenerations),
  }),
);

export const aiConversationMessagesRelations = relations(
  aiConversationMessages,
  ({ one }) => ({
    conversation: one(aiConversations, {
      fields: [aiConversationMessages.conversationId],
      references: [aiConversations.id],
    }),
    generation: one(aiGenerations, {
      fields: [aiConversationMessages.generationId],
      references: [aiGenerations.id],
    }),
  }),
);

export const aiGenerationsRelations = relations(
  aiGenerations,
  ({ one, many }) => ({
    conversation: one(aiConversations, {
      fields: [aiGenerations.conversationId],
      references: [aiConversations.id],
    }),
    owner: one(user, {
      fields: [aiGenerations.ownerId],
      references: [user.id],
    }),
    retryOf: one(aiGenerations, {
      fields: [aiGenerations.retryOfGenerationId],
      references: [aiGenerations.id],
      relationName: "retry_chain",
    }),
    userMessage: one(aiConversationMessages, {
      fields: [aiGenerations.userMessageId],
      references: [aiConversationMessages.id],
    }),
    messages: many(aiConversationMessages),
  }),
);
