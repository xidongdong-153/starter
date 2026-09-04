import { relations, sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { user } from '@api/modules/auth/auth.schema.js'

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })

export const aiAppCredentials = sqliteTable(
  'ai_app_credentials',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    /** JSON 序列化的 product_app capability policy；存量 NULL 表示拒绝运行面动作。 */
    policyJson: text('policy_json'),
    secretHash: text('secret_hash').notNull(),
    secretPrefix: text('secret_prefix').notNull(),
    status: text('status').notNull().default('active'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, {
        onDelete: 'restrict',
      }),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id, {
        onDelete: 'restrict',
      }),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    lastUsedAt: timestamp('last_used_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [
    index('ai_app_credentials_scope_idx').on(table.tenantId, table.projectId, table.status),
    index('ai_app_credentials_prefix_idx').on(table.secretPrefix),
    check('ai_app_credentials_status_check', sql`${table.status} IN ('active', 'revoked')`),
  ],
)

export const aiAppCredentialAuditEvents = sqliteTable(
  'ai_app_credential_audit_events',
  {
    id: text('id').primaryKey(),
    appId: text('app_id').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    requestId: text('request_id'),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('ai_app_credential_audit_app_idx').on(table.appId, table.createdAt),
    index('ai_app_credential_audit_created_idx').on(table.createdAt, table.id),
  ],
)

export const aiProviderConfigs = sqliteTable(
  'ai_provider_configs',
  {
    providerId: text('provider_id').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    credentialType: text('credential_type'),
    credentialHint: text('credential_hint'),
    payloadCiphertext: text('payload_ciphertext'),
    payloadIv: text('payload_iv'),
    payloadAuthTag: text('payload_auth_tag'),
    encryptionVersion: integer('encryption_version'),
    rowVersion: integer('row_version').notNull().default(0),
    configRevision: integer('config_revision').notNull().default(0),
    checkedConfigRevision: integer('checked_config_revision'),
    authStatus: text('auth_status').notNull().default('not_configured'),
    authSource: text('auth_source'),
    lastCheckedAt: timestamp('last_checked_at'),
    lastCheckErrorCode: text('last_check_error_code'),
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => [
    index('ai_provider_configs_enabled_idx').on(table.enabled),
    check(
      'ai_provider_payload_all_or_none',
      sql`(payload_ciphertext IS NULL AND payload_iv IS NULL AND payload_auth_tag IS NULL AND encryption_version IS NULL) OR (payload_ciphertext IS NOT NULL AND payload_iv IS NOT NULL AND payload_auth_tag IS NOT NULL AND encryption_version IS NOT NULL)`,
    ),
    check('ai_provider_credential_type', sql`credential_type IS NULL OR credential_type IN ('api_key', 'oauth')`),
  ],
)

export const aiCustomProviders = sqliteTable(
  'ai_custom_providers',
  {
    providerId: text('provider_id').primaryKey(),
    definitionJson: text('definition_json').notNull(),
    revision: integer('revision').notNull().default(1),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => [
    index('ai_custom_providers_updated_idx').on(table.updatedAt, table.providerId),
    check(
      'ai_custom_providers_id_check',
      sql`length(${table.providerId}) BETWEEN 1 AND 80 AND substr(${table.providerId}, 1, 1) BETWEEN 'a' AND 'z' AND ${table.providerId} NOT GLOB '*[^a-z0-9-]*'`,
    ),
    check('ai_custom_providers_definition_json_check', sql`json_valid(${table.definitionJson})`),
    check(
      'ai_custom_providers_definition_id_check',
      sql`json_extract(${table.definitionJson}, '$.providerId') = ${table.providerId}`,
    ),
    check(
      'ai_custom_providers_protocol_check',
      sql`json_extract(${table.definitionJson}, '$.protocol') IN ('openai-completions', 'openai-responses', 'anthropic-messages')`,
    ),
    check(
      'ai_custom_providers_models_check',
      sql`json_type(${table.definitionJson}, '$.models') = 'array' AND json_array_length(${table.definitionJson}, '$.models') BETWEEN 1 AND 200`,
    ),
    check(
      'ai_custom_providers_secret_check',
      sql`json_type(${table.definitionJson}, '$.apiKey') IS NULL AND json_type(${table.definitionJson}, '$.secret') IS NULL AND json_type(${table.definitionJson}, '$.credential') IS NULL`,
    ),
    check('ai_custom_providers_revision_check', sql`${table.revision} >= 1`),
  ],
)

export const aiModelCatalogs = sqliteTable('ai_model_catalogs', {
  providerId: text('provider_id').primaryKey(),
  modelsJson: text('models_json').notNull(),
  checkedAt: timestamp('checked_at'),
  lastModified: timestamp('last_modified'),
  etag: text('etag'),
  updatedAt: timestamp('updated_at').notNull(),
})

export const aiEnabledModels = sqliteTable(
  'ai_enabled_models',
  {
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    enabledAt: timestamp('enabled_at').notNull(),
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    primaryKey({ columns: [table.providerId, table.modelId] }),
    index('ai_enabled_models_provider_idx').on(table.providerId),
  ],
)

export const aiSystemPrompts = sqliteTable('ai_system_prompts', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  content: text('content').notNull(),
  /** 当前内容对应的 revision 行号；事实源在 ai_system_prompt_revisions。 */
  currentRevision: integer('current_revision').notNull().default(1),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  updatedBy: text('updated_by').references(() => user.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})

/**
 * System Prompt 版本链：每行不可变，主表 content 是 current_revision 指向内容的镜像。
 * 内容更新时追加新行并同事务刷新主表，历史 Run 按 revision 还原当时内容。
 */
export const aiSystemPromptRevisions = sqliteTable(
  'ai_system_prompt_revisions',
  {
    id: text('id').primaryKey(),
    promptId: text('prompt_id')
      .notNull()
      .references(() => aiSystemPrompts.id, {
        onDelete: 'cascade',
      }),
    revision: integer('revision').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('ai_system_prompt_revisions_prompt_revision_uidx').on(table.promptId, table.revision),
    check('ai_system_prompt_revisions_revision_check', sql`${table.revision} >= 1`),
  ],
)

export const aiPromptTemplates = sqliteTable(
  'ai_prompt_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    description: text('description').notNull().default(''),
    content: text('content').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => [index('ai_prompt_templates_enabled_sort_idx').on(table.enabled, table.sortOrder)],
)

export const aiSkills = sqliteTable(
  'ai_skills',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    description: text('description').notNull(),
    content: text('content').notNull(),
    /** 当前内容对应的 revision 行号；事实源在 ai_skill_revisions。 */
    currentRevision: integer('current_revision').notNull().default(1),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => [index('ai_skills_enabled_name_idx').on(table.enabled, table.name)],
)

/**
 * Skill 版本链：每行不可变，主表 content 是 current_revision 指向内容的镜像。
 * content 或 description 变化都会追加新行（两者都进入执行输入）。
 */
export const aiSkillRevisions = sqliteTable(
  'ai_skill_revisions',
  {
    id: text('id').primaryKey(),
    skillId: text('skill_id')
      .notNull()
      .references(() => aiSkills.id, {
        onDelete: 'cascade',
      }),
    revision: integer('revision').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('ai_skill_revisions_skill_revision_uidx').on(table.skillId, table.revision),
    check('ai_skill_revisions_revision_check', sql`${table.revision} >= 1`),
  ],
)

export const aiSettings = sqliteTable(
  'ai_settings',
  {
    id: text('id').primaryKey(),
    globalProviderId: text('global_provider_id'),
    globalModelId: text('global_model_id'),
    globalSystemPromptId: text('global_system_prompt_id').references(() => aiSystemPrompts.id, {
      onDelete: 'set null',
    }),
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (_table) => [
    check(
      'ai_settings_global_model_pair',
      sql`(global_provider_id IS NULL AND global_model_id IS NULL) OR (global_provider_id IS NOT NULL AND global_model_id IS NOT NULL)`,
    ),
  ],
)

export const userAiPreferences = sqliteTable(
  'user_ai_preferences',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (_table) => [
    check(
      'user_ai_preferences_model_pair',
      sql`(provider_id IS NULL AND model_id IS NULL) OR (provider_id IS NOT NULL AND model_id IS NOT NULL)`,
    ),
  ],
)

export const aiProviderConfigsRelations = relations(aiProviderConfigs, ({ one }) => ({
  updater: one(user, {
    fields: [aiProviderConfigs.updatedBy],
    references: [user.id],
  }),
}))

export const aiCustomProvidersRelations = relations(aiCustomProviders, ({ one }) => ({
  creator: one(user, {
    fields: [aiCustomProviders.createdBy],
    references: [user.id],
    relationName: 'custom_provider_creator',
  }),
  updater: one(user, {
    fields: [aiCustomProviders.updatedBy],
    references: [user.id],
    relationName: 'custom_provider_updater',
  }),
}))

export const aiEnabledModelsRelations = relations(aiEnabledModels, ({ one }) => ({
  updater: one(user, {
    fields: [aiEnabledModels.updatedBy],
    references: [user.id],
  }),
}))

export const aiSettingsRelations = relations(aiSettings, ({ one }) => ({
  updater: one(user, { fields: [aiSettings.updatedBy], references: [user.id] }),
}))

export const userAiPreferencesRelations = relations(userAiPreferences, ({ one }) => ({
  user: one(user, {
    fields: [userAiPreferences.userId],
    references: [user.id],
  }),
}))

export const aiAgentDefinitions = sqliteTable(
  'ai_agent_definitions',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('draft'),
    revision: integer('revision').notNull().default(1),
    configJson: text('config_json').notNull(),
    /** 该 Agent revision 引用的 System Prompt revision；config 无 prompt 时为 NULL。 */
    systemPromptRevision: integer('system_prompt_revision'),
    /** `{"<skillId>": <revision>}`；config 无技能时为 NULL。 */
    skillRevisionsJson: text('skill_revisions_json'),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => [
    index('ai_agent_definitions_status_updated_idx').on(table.status, table.updatedAt, table.id),
    check('ai_agent_definitions_status_check', sql`${table.status} IN ('draft', 'enabled', 'disabled')`),
    check('ai_agent_definitions_revision_check', sql`${table.revision} >= 1`),
    check('ai_agent_definitions_config_json_check', sql`json_valid(${table.configJson})`),
  ],
)

export const aiAgentSessions = sqliteTable(
  'ai_agent_sessions',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').references(() => user.id, {
      onDelete: 'cascade',
    }),
    principalKind: text('principal_kind').notNull().default('starter_user'),
    tenantId: text('tenant_id').notNull().default('starter'),
    projectId: text('project_id').notNull().default('starter'),
    externalUserId: text('external_user_id').notNull().default('starter'),
    appId: text('app_id').references(() => aiAppCredentials.id, {
      onDelete: 'restrict',
    }),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    title: text('title').notNull(),
    defaultAgentId: text('default_agent_id').references(() => aiAgentDefinitions.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => [
    index('ai_agent_sessions_owner_archived_updated_idx').on(
      table.ownerId,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
    index('ai_agent_sessions_scope_user_archived_idx').on(
      table.tenantId,
      table.projectId,
      table.externalUserId,
      table.archivedAt,
      table.updatedAt,
      table.id,
    ),
    index('ai_agent_sessions_app_idx').on(table.appId),
    index('ai_agent_sessions_default_agent_idx').on(table.defaultAgentId),
    check(
      'ai_agent_sessions_principal_check',
      sql`(${table.principalKind} = 'starter_user' AND ${table.ownerId} IS NOT NULL AND ${table.appId} IS NULL) OR (${table.principalKind} = 'product_app' AND ${table.ownerId} IS NULL AND ${table.appId} IS NOT NULL)`,
    ),
    check(
      'ai_agent_sessions_subject_pair_check',
      sql`(${table.subjectType} IS NULL AND ${table.subjectId} IS NULL) OR (${table.subjectType} IS NOT NULL AND ${table.subjectId} IS NOT NULL)`,
    ),
  ],
)

export const aiAgentRuns = sqliteTable(
  'ai_agent_runs',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => aiAgentSessions.id, { onDelete: 'cascade' }),
    /** 预设 Agent 启动时非空；内联配置启动为 NULL··，与 agentRevision 成对。 */
    agentId: text('agent_id').references(() => aiAgentDefinitions.id, {
      onDelete: 'restrict',
    }),
    lane: text('lane').notNull(),
    status: text('status').notNull(),
    agentRevision: integer('agent_revision'),
    snapshotJson: text('snapshot_json').notNull(),
    requestId: text('request_id').notNull(),
    /** startRun 幂等键，与 idempotencyScope 一起构成唯一约束；不带 key 的启动为 NULL。 */
    idempotencyKey: text('idempotency_key'),
    /** 幂等隔离 scope：kind|tenantId|projectId|principalId|externalUserId|subjectType|subjectId。 */
    idempotencyScope: text('idempotency_scope'),
    finalEntryId: text('final_entry_id'),
    errorCode: text('error_code'),
    /** acquire lane lease 时拿到的 fencing token；终态事务用它校验执行所有权。历史行为 NULL，跳过校验。 */
    executionFencingToken: integer('execution_fencing_token'),
    /** 当前执行 attempt 序号；auto retry 追加后同步递增。 */
    currentAttemptNo: integer('current_attempt_no').notNull().default(1),
    createdAt: timestamp('created_at').notNull(),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
  },
  (table) => [
    index('ai_agent_runs_session_created_idx').on(table.sessionId, table.createdAt, table.id),
    index('ai_agent_runs_session_lane_status_idx').on(table.sessionId, table.lane, table.status),
    index('ai_agent_runs_agent_created_idx').on(table.agentId, table.createdAt, table.id),
    index('ai_agent_runs_status_created_idx').on(table.status, table.createdAt, table.id),
    index('ai_agent_runs_request_idx').on(table.requestId),
    index('ai_agent_runs_finished_idx').on(table.finishedAt),
    uniqueIndex('ai_agent_runs_idempotency_unique')
      .on(table.idempotencyScope, table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    check(
      'ai_agent_runs_status_check',
      sql`${table.status} IN ('starting', 'running', 'completed', 'failed', 'aborted', 'interrupted')`,
    ),
    check('ai_agent_runs_revision_check', sql`${table.agentRevision} >= 1`),
    check('ai_agent_runs_agent_pair_check', sql`(${table.agentId} IS NULL) = (${table.agentRevision} IS NULL)`),
    check('ai_agent_runs_snapshot_json_check', sql`json_valid(${table.snapshotJson})`),
  ],
)

/**
 * Session lane 的执行所有权 lease：一行代表一个 lane 的当前持有者。
 * 排他与接管的权威数据源，进程内 ActiveRunRegistry 只是同进程快速路径。
 * 时间列是 epoch 毫秒整型（不用 timestamp mode）：条件 SQL 直接与 Date.now() 比较。
 * TTL 90s、续租 30s 是代码常量，见 run/lane-lease.ts，不提供环境变量。
 */
export const aiAgentLaneLeases = sqliteTable(
  'ai_agent_lane_leases',
  {
    sessionId: text('session_id').notNull(),
    lane: text('lane').notNull(),
    ownerId: text('owner_id').notNull(),
    /** 按 lane 单调递增，每次接管 +1；终态提交用它识别过期 owner。 */
    fencingToken: integer('fencing_token').notNull(),
    /** epoch 毫秒；小于当前时间视为过期，可被新 owner 接管。 */
    leaseUntil: integer('lease_until').notNull(),
    heartbeatAt: integer('heartbeat_at').notNull(),
    acquiredAt: integer('acquired_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.lane] }),
    check('ai_agent_lane_leases_fencing_token_check', sql`${table.fencingToken} >= 1`),
  ],
)

/**
 * Run 启动时固化的解析事实；Run 行创建后、executor 启动前写入。
 * 失败时 Run 按现有错误收尾落成 failed，不存在无 manifest 的 starting/running Run。
 */
export const aiRunResolvedManifests = sqliteTable(
  'ai_run_resolved_manifests',
  {
    runId: text('run_id')
      .primaryKey()
      .references(() => aiAgentRuns.id, {
        onDelete: 'cascade',
      }),
    manifestHash: text('manifest_hash').notNull(),
    /** aiRunResolvedManifestSchema 校验后的 JSON。 */
    manifestJson: text('manifest_json').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [check('ai_run_resolved_manifests_json_check', sql`json_valid(${table.manifestJson})`)],
)

/**
 * 一次 Run 的一次执行尝试。Attempt 1 在 startRun 创建（trigger=initial）；
 * auto retry 在原请求内追加（trigger=auto_retry，retry_reason 记录触发重试的
 * 上一轮错误码）。owner 与 fencing token 来自 acquire lane lease。
 */
export const aiRunAttempts = sqliteTable(
  'ai_run_attempts',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => aiAgentRuns.id, { onDelete: 'cascade' }),
    /** 从 1 递增；与 Run 行的 current_attempt_no 同步。 */
    attemptNo: integer('attempt_no').notNull(),
    status: text('status').notNull(),
    trigger: text('trigger').notNull(),
    /** auto_retry 时记录触发重试的上一轮错误码；initial 为 NULL。 */
    retryReason: text('retry_reason'),
    ownerId: text('owner_id').notNull(),
    fencingToken: integer('fencing_token').notNull(),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at').notNull(),
    finishedAt: timestamp('finished_at'),
  },
  (table) => [
    index('ai_run_attempts_run_started_idx').on(table.runId, table.startedAt, table.id),
    uniqueIndex('ai_run_attempts_run_attempt_uidx').on(table.runId, table.attemptNo),
    check(
      'ai_run_attempts_status_check',
      sql`${table.status} IN ('running', 'succeeded', 'failed', 'aborted', 'interrupted')`,
    ),
    check('ai_run_attempts_trigger_check', sql`${table.trigger} IN ('initial', 'auto_retry')`),
    check('ai_run_attempts_attempt_no_check', sql`${table.attemptNo} >= 1`),
  ],
)

export const aiRunTurns = sqliteTable(
  'ai_run_turns',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => aiAgentRuns.id, { onDelete: 'cascade' }),
    turnIndex: integer('turn_index').notNull(),
    /** 产生该 turn 的执行 attempt 序号；历史行回填 1。 */
    attemptNo: integer('attempt_no').notNull().default(1),
    outcome: text('outcome').notNull().default('running'),
    startedAt: timestamp('started_at').notNull(),
    finishedAt: timestamp('finished_at'),
  },
  (table) => [
    index('ai_run_turns_run_started_idx').on(table.runId, table.startedAt, table.id),
    uniqueIndex('ai_run_turns_run_turn_uidx').on(table.runId, table.turnIndex),
  ],
)

export const aiRunSteps = sqliteTable(
  'ai_run_steps',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => aiAgentRuns.id, { onDelete: 'cascade' }),
    /** 所属 turn；顶层 agent Step 不属于任何 turn，为 NULL。 */
    turnId: text('turn_id').references(() => aiRunTurns.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** 公开事件面的 step attempt 序号；当前与 attempt_no 同值。 */
    attempt: integer('attempt').notNull(),
    /** 产生该 step 的执行 attempt 序号；历史行回填 1。 */
    attemptNo: integer('attempt_no').notNull().default(1),
    outcome: text('outcome').notNull().default('running'),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at').notNull(),
    finishedAt: timestamp('finished_at'),
  },
  (table) => [
    index('ai_run_steps_run_started_idx').on(table.runId, table.startedAt, table.id),
    index('ai_run_steps_turn_started_idx').on(table.turnId, table.startedAt, table.id),
  ],
)

export const aiRunEvents = sqliteTable(
  'ai_run_events',
  {
    eventId: text('event_id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => aiAgentRuns.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    occurredAt: timestamp('occurred_at').notNull(),
  },
  (table) => [
    uniqueIndex('ai_run_events_run_sequence_uidx').on(table.runId, table.sequence),
    index('ai_run_events_run_type_sequence_idx').on(table.runId, table.type, table.sequence),
  ],
)

export const aiStructuredOutputs = sqliteTable(
  'ai_structured_outputs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => aiAgentRuns.id, { onDelete: 'cascade' }),
    stepId: text('step_id')
      .notNull()
      .references(() => aiRunSteps.id, { onDelete: 'cascade' }),
    contractName: text('contract_name').notNull(),
    contractVersion: text('contract_version').notNull(),
    schemaHash: text('schema_hash').notNull(),
    renderKind: text('render_kind').notNull(),
    /** emit 时刻的 contract 可见性；历史行为 NULL，读取时回退 registry 当前定义。 */
    visibility: text('visibility'),
    /** emit 时刻的输出模式；历史行为 NULL，读取时回退 registry 当前定义。 */
    mode: text('mode'),
    valueJson: text('value_json').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('ai_structured_outputs_run_created_idx').on(table.runId, table.createdAt, table.id),
    index('ai_structured_outputs_step_idx').on(table.stepId),
  ],
)

/**
 * Output Contract 的版本快照：define 时写入，历史 structured output 读取不依赖
 * 当前进程仍注册同名 contract。同 name+version 的定义视为不可变，重复写入忽略。
 */
export const aiOutputContractSnapshots = sqliteTable(
  'ai_output_contract_snapshots',
  {
    name: text('name').notNull(),
    version: text('version').notNull(),
    description: text('description').notNull(),
    schemaJson: text('schema_json').notNull(),
    renderKind: text('render_kind').notNull(),
    visibility: text('visibility').notNull(),
    mode: text('mode').notNull(),
    firstSeenAt: timestamp('first_seen_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.name, table.version] }),
    check('ai_output_contract_snapshots_json_check', sql`json_valid(${table.schemaJson})`),
    check('ai_output_contract_snapshots_visibility_check', sql`${table.visibility} IN ('product', 'admin')`),
    check('ai_output_contract_snapshots_mode_check', sql`${table.mode} IN ('optional', 'required')`),
  ],
)

export const aiModelCalls = sqliteTable(
  'ai_model_calls',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    userId: text('user_id').notNull(),
    appId: text('app_id'),
    tenantId: text('tenant_id').notNull().default('starter'),
    projectId: text('project_id').notNull().default('starter'),
    externalUserId: text('external_user_id'),
    principalKind: text('principal_kind').notNull().default('starter_user'),
    scenario: text('scenario').notNull(),
    runId: text('run_id').references(() => aiAgentRuns.id, {
      onDelete: 'set null',
    }),
    turnId: text('turn_id').references(() => aiRunTurns.id, {
      onDelete: 'set null',
    }),
    stepId: text('step_id').references(() => aiRunSteps.id, {
      onDelete: 'set null',
    }),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    api: text('api'),
    startedAt: timestamp('started_at').notNull(),
    timeoutMs: integer('timeout_ms').notNull().default(120_000),
    finishedAt: timestamp('finished_at'),
    durationMs: integer('duration_ms'),
    ttftMs: integer('ttft_ms'),
    chunkCount: integer('chunk_count'),
    responseModel: text('response_model'),
    responseId: text('response_id'),
    httpStatus: integer('http_status'),
    result: text('result').notNull(),
    stopReason: text('stop_reason'),
    errorCode: text('error_code'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    cacheWrite1hTokens: integer('cache_write_1h_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    totalTokens: integer('total_tokens'),
    costInput: real('cost_input'),
    costOutput: real('cost_output'),
    costCacheRead: real('cost_cache_read'),
    costCacheWrite: real('cost_cache_write'),
    costTotal: real('cost_total'),
    costCurrency: text('cost_currency'),
  },
  (table) => [
    index('ai_model_calls_run_turn_step_idx').on(table.runId, table.turnId, table.stepId, table.startedAt),
    index('ai_model_calls_scope_started_idx').on(
      table.tenantId,
      table.projectId,
      table.externalUserId,
      table.startedAt,
      table.id,
    ),
    index('ai_model_calls_user_started_idx').on(table.userId, table.startedAt),
    index('ai_model_calls_provider_model_started_idx').on(table.providerId, table.modelId, table.startedAt),
    index('ai_model_calls_result_started_idx').on(table.result, table.startedAt),
    index('ai_model_calls_request_started_idx').on(table.requestId, table.startedAt),
    index('ai_model_calls_run_started_idx').on(table.runId, table.startedAt, table.id),
    check('ai_model_calls_principal_kind_check', sql`${table.principalKind} IN ('starter_user', 'product_app')`),
    check(
      'ai_model_calls_scenario_check',
      sql`${table.scenario} IN ('model_test', 'agent_run', 'completion', 'legacy')`,
    ),
  ],
)

export const aiToolExecutions = sqliteTable(
  'ai_tool_executions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').references(() => aiAgentRuns.id, {
      onDelete: 'set null',
    }),
    modelCallId: text('model_call_id')
      .notNull()
      .references(() => aiModelCalls.id, { onDelete: 'cascade' }),
    turnId: text('turn_id').references(() => aiRunTurns.id, {
      onDelete: 'set null',
    }),
    stepId: text('step_id').references(() => aiRunSteps.id, {
      onDelete: 'set null',
    }),
    toolCallId: text('tool_call_id'),
    toolExecutionId: text('tool_execution_id').unique(),
    toolName: text('tool_name').notNull(),
    /** 历史记录与未注册 Tool 的 not_found 记录允许 null；新执行必须由应用层写精确版本。 */
    toolVersion: text('tool_version'),
    /** 稳定幂等 token：sha256(canonicalJson({runId, attemptNo, toolExecutionId}))；历史行为 NULL。 */
    idempotencyToken: text('idempotency_token'),
    startedAt: timestamp('started_at').notNull(),
    finishedAt: timestamp('finished_at'),
    durationMs: integer('duration_ms'),
    status: text('status').notNull(),
    timeoutMs: integer('timeout_ms').notNull(),
    errorCode: text('error_code'),
  },
  (table) => [
    index('ai_tool_executions_run_step_idx').on(table.runId, table.stepId, table.startedAt),
    index('ai_tool_executions_call_started_idx').on(table.modelCallId, table.startedAt, table.id),
    index('ai_tool_executions_status_started_idx').on(table.status, table.startedAt),
  ],
)

export const aiWebhookEndpoints = sqliteTable(
  'ai_webhook_endpoints',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => aiAppCredentials.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    signingSecretEncrypted: text('signing_secret_encrypted').notNull(),
    status: text('status').notNull(),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedBy: text('updated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    lastDeliveryAt: timestamp('last_delivery_at'),
  },
  (table) => [
    index('ai_webhook_endpoints_app_idx').on(table.appId),
    check('ai_webhook_endpoints_status_check', sql`${table.status} IN ('enabled', 'disabled')`),
  ],
)

export const aiWebhookDeliveries = sqliteTable(
  'ai_webhook_deliveries',
  {
    id: text('id').primaryKey(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => aiWebhookEndpoints.id, { onDelete: 'cascade' }),
    /** 冗余列，投递记录列表查询免 join 端点表。 */
    appId: text('app_id').notNull(),
    runId: text('run_id')
      .notNull()
      .references(() => aiAgentRuns.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    /** 入队时的 payload 快照，投递时原样发送。 */
    payloadJson: text('payload_json').notNull(),
    /** 对应 terminal RunEvent 的 identity；interrupted Run 没有事件时为 NULL。 */
    eventId: text('event_id'),
    sequence: integer('sequence'),
    eventProtocolVersion: integer('event_protocol_version'),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** 多实例 dispatcher 的条件领取信息。 */
    claimedAt: timestamp('claimed_at'),
    claimExpiresAt: timestamp('claim_expires_at'),
    /** null 表示立即可投。 */
    nextAttemptAt: timestamp('next_attempt_at'),
    lastResponseCode: integer('last_response_code'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    deliveredAt: timestamp('delivered_at'),
    deadAt: timestamp('dead_at'),
  },
  (table) => [
    index('ai_webhook_deliveries_endpoint_created_idx').on(table.endpointId, table.createdAt, table.id),
    index('ai_webhook_deliveries_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
    uniqueIndex('ai_webhook_deliveries_endpoint_run_uidx').on(table.endpointId, table.runId),
    check('ai_webhook_deliveries_status_check', sql`${table.status} IN ('pending', 'delivered', 'dead')`),
  ],
)

export const aiAttachments = sqliteTable(
  'ai_attachments',
  {
    id: text('id').primaryKey(),
    /** starter_user 时的归属用户；product_app 时为 NULL。 */
    ownerUserId: text('owner_user_id').references(() => user.id, {
      onDelete: 'cascade',
    }),
    /** product_app 时的归属应用；starter_user 时为 NULL。 */
    appId: text('app_id').references(() => aiAppCredentials.id, {
      onDelete: 'cascade',
    }),
    principalKind: text('principal_kind').notNull(),
    /** 可选的 Agent Session 归属，session 硬删除时级联删除附件行。 */
    sessionId: text('session_id').references(() => aiAgentSessions.id, {
      onDelete: 'cascade',
    }),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    /** 附件存储目录内的相对路径。 */
    storagePath: text('storage_path').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('ai_attachments_owner_idx').on(table.ownerUserId),
    index('ai_attachments_app_idx').on(table.appId),
    index('ai_attachments_session_idx').on(table.sessionId),
    check(
      'ai_attachments_principal_check',
      sql`(${table.principalKind} = 'starter_user' AND ${table.ownerUserId} IS NOT NULL AND ${table.appId} IS NULL) OR (${table.principalKind} = 'product_app' AND ${table.ownerUserId} IS NULL AND ${table.appId} IS NOT NULL)`,
    ),
    check(
      'ai_attachments_mime_check',
      sql`${table.mimeType} IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')`,
    ),
  ],
)

export const aiAgentDefinitionsRelations = relations(aiAgentDefinitions, ({ one, many }) => ({
  creator: one(user, {
    fields: [aiAgentDefinitions.createdBy],
    references: [user.id],
    relationName: 'agent_definition_creator',
  }),
  updater: one(user, {
    fields: [aiAgentDefinitions.updatedBy],
    references: [user.id],
    relationName: 'agent_definition_updater',
  }),
  sessions: many(aiAgentSessions),
  runs: many(aiAgentRuns),
}))

export const aiAgentSessionsRelations = relations(aiAgentSessions, ({ one, many }) => ({
  owner: one(user, {
    fields: [aiAgentSessions.ownerId],
    references: [user.id],
  }),
  defaultAgent: one(aiAgentDefinitions, {
    fields: [aiAgentSessions.defaultAgentId],
    references: [aiAgentDefinitions.id],
  }),
  runs: many(aiAgentRuns),
}))

export const aiAgentRunsRelations = relations(aiAgentRuns, ({ one, many }) => ({
  session: one(aiAgentSessions, {
    fields: [aiAgentRuns.sessionId],
    references: [aiAgentSessions.id],
  }),
  agent: one(aiAgentDefinitions, {
    fields: [aiAgentRuns.agentId],
    references: [aiAgentDefinitions.id],
  }),
  modelCalls: many(aiModelCalls),
  turns: many(aiRunTurns),
  steps: many(aiRunSteps),
  events: many(aiRunEvents),
  attempts: many(aiRunAttempts),
  structuredOutputs: many(aiStructuredOutputs),
}))

export const aiRunAttemptsRelations = relations(aiRunAttempts, ({ one }) => ({
  run: one(aiAgentRuns, {
    fields: [aiRunAttempts.runId],
    references: [aiAgentRuns.id],
  }),
}))

export const aiRunTurnsRelations = relations(aiRunTurns, ({ one, many }) => ({
  run: one(aiAgentRuns, {
    fields: [aiRunTurns.runId],
    references: [aiAgentRuns.id],
  }),
  steps: many(aiRunSteps),
}))

export const aiRunStepsRelations = relations(aiRunSteps, ({ one, many }) => ({
  run: one(aiAgentRuns, {
    fields: [aiRunSteps.runId],
    references: [aiAgentRuns.id],
  }),
  turn: one(aiRunTurns, {
    fields: [aiRunSteps.turnId],
    references: [aiRunTurns.id],
  }),
  modelCalls: many(aiModelCalls),
  structuredOutputs: many(aiStructuredOutputs),
}))

export const aiRunEventsRelations = relations(aiRunEvents, ({ one }) => ({
  run: one(aiAgentRuns, {
    fields: [aiRunEvents.runId],
    references: [aiAgentRuns.id],
  }),
}))

export const aiStructuredOutputsRelations = relations(aiStructuredOutputs, ({ one }) => ({
  run: one(aiAgentRuns, {
    fields: [aiStructuredOutputs.runId],
    references: [aiAgentRuns.id],
  }),
  step: one(aiRunSteps, {
    fields: [aiStructuredOutputs.stepId],
    references: [aiRunSteps.id],
  }),
}))

export const aiModelCallsRelations = relations(aiModelCalls, ({ one, many }) => ({
  run: one(aiAgentRuns, {
    fields: [aiModelCalls.runId],
    references: [aiAgentRuns.id],
  }),
  turn: one(aiRunTurns, {
    fields: [aiModelCalls.turnId],
    references: [aiRunTurns.id],
  }),
  step: one(aiRunSteps, {
    fields: [aiModelCalls.stepId],
    references: [aiRunSteps.id],
  }),
  toolExecutions: many(aiToolExecutions),
}))

export const aiAttachmentsRelations = relations(aiAttachments, ({ one }) => ({
  owner: one(user, {
    fields: [aiAttachments.ownerUserId],
    references: [user.id],
  }),
  app: one(aiAppCredentials, {
    fields: [aiAttachments.appId],
    references: [aiAppCredentials.id],
  }),
  session: one(aiAgentSessions, {
    fields: [aiAttachments.sessionId],
    references: [aiAgentSessions.id],
  }),
}))

export const aiToolExecutionsRelations = relations(aiToolExecutions, ({ one }) => ({
  modelCall: one(aiModelCalls, {
    fields: [aiToolExecutions.modelCallId],
    references: [aiModelCalls.id],
  }),
}))
