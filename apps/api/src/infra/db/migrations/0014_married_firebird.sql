PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`principal_kind` text DEFAULT 'starter_user' NOT NULL,
	`tenant_id` text DEFAULT 'starter' NOT NULL,
	`project_id` text DEFAULT 'starter' NOT NULL,
	`external_user_id` text DEFAULT 'starter' NOT NULL,
	`app_id` text,
	`subject_type` text,
	`subject_id` text,
	`title` text NOT NULL,
	`default_agent_id` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `ai_app_credentials`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`default_agent_id`) REFERENCES `ai_agent_definitions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_agent_sessions_principal_check" CHECK(("__new_ai_agent_sessions"."principal_kind" = 'starter_user' AND "__new_ai_agent_sessions"."owner_id" IS NOT NULL AND "__new_ai_agent_sessions"."app_id" IS NULL) OR ("__new_ai_agent_sessions"."principal_kind" = 'product_app' AND "__new_ai_agent_sessions"."owner_id" IS NULL AND "__new_ai_agent_sessions"."app_id" IS NOT NULL)),
	CONSTRAINT "ai_agent_sessions_subject_pair_check" CHECK(("__new_ai_agent_sessions"."subject_type" IS NULL AND "__new_ai_agent_sessions"."subject_id" IS NULL) OR ("__new_ai_agent_sessions"."subject_type" IS NOT NULL AND "__new_ai_agent_sessions"."subject_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_ai_agent_sessions`("id", "owner_id", "principal_kind", "tenant_id", "project_id", "external_user_id", "app_id", "subject_type", "subject_id", "title", "default_agent_id", "archived_at", "created_at", "updated_at") SELECT "id", "owner_id", 'starter_user', 'starter', 'starter', "owner_id", NULL, NULL, NULL, "title", "default_agent_id", "archived_at", "created_at", "updated_at" FROM `ai_agent_sessions`;--> statement-breakpoint
DROP TABLE `ai_agent_sessions`;--> statement-breakpoint
ALTER TABLE `__new_ai_agent_sessions` RENAME TO `ai_agent_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_agent_sessions_owner_archived_updated_idx` ON `ai_agent_sessions` (`owner_id`,`archived_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_agent_sessions_scope_user_archived_idx` ON `ai_agent_sessions` (`tenant_id`,`project_id`,`external_user_id`,`archived_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_agent_sessions_app_idx` ON `ai_agent_sessions` (`app_id`);--> statement-breakpoint
CREATE INDEX `ai_agent_sessions_default_agent_idx` ON `ai_agent_sessions` (`default_agent_id`);