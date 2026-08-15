import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
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

export const aiSettings = sqliteTable(
  "ai_settings",
  {
    id: text("id").primaryKey(),
    globalProviderId: text("global_provider_id"),
    globalModelId: text("global_model_id"),
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
