CREATE TABLE `ai_enabled_models` (
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`enabled_at` integer NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`provider_id`, `model_id`),
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_enabled_models_provider_idx` ON `ai_enabled_models` (`provider_id`);--> statement-breakpoint
CREATE TABLE `ai_model_catalogs` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`models_json` text NOT NULL,
	`checked_at` integer,
	`last_modified` integer,
	`etag` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_provider_configs` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`credential_type` text,
	`credential_hint` text,
	`payload_ciphertext` text,
	`payload_iv` text,
	`payload_auth_tag` text,
	`encryption_version` integer,
	`row_version` integer DEFAULT 0 NOT NULL,
	`config_revision` integer DEFAULT 0 NOT NULL,
	`checked_config_revision` integer,
	`auth_status` text DEFAULT 'not_configured' NOT NULL,
	`auth_source` text,
	`last_checked_at` integer,
	`last_check_error_code` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_provider_payload_all_or_none" CHECK((payload_ciphertext IS NULL AND payload_iv IS NULL AND payload_auth_tag IS NULL AND encryption_version IS NULL) OR (payload_ciphertext IS NOT NULL AND payload_iv IS NOT NULL AND payload_auth_tag IS NOT NULL AND encryption_version IS NOT NULL)),
	CONSTRAINT "ai_provider_credential_type" CHECK(credential_type IS NULL OR credential_type IN ('api_key', 'oauth'))
);
--> statement-breakpoint
CREATE INDEX `ai_provider_configs_enabled_idx` ON `ai_provider_configs` (`enabled`);--> statement-breakpoint
CREATE TABLE `ai_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`global_provider_id` text,
	`global_model_id` text,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_settings_global_model_pair" CHECK((global_provider_id IS NULL AND global_model_id IS NULL) OR (global_provider_id IS NOT NULL AND global_model_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `user_ai_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`provider_id` text,
	`model_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_ai_preferences_model_pair" CHECK((provider_id IS NULL AND model_id IS NULL) OR (provider_id IS NOT NULL AND model_id IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `permissions` (`id`, `key`, `resource`, `action`, `description`, `is_system`, `archived_at`, `created_at`, `updated_at`) VALUES
  ('019c4200-0001-7000-8000-000000000010', 'ai:config:read', 'ai', 'config:read', '查看 AI Provider 和模型配置', true, NULL, 1786694400000, 1786694400000),
  ('019c4200-0001-7000-8000-000000000011', 'ai:config:manage', 'ai', 'config:manage', '管理 AI Provider 和模型配置', true, NULL, 1786694400000, 1786694400000);
