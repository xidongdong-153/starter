CREATE TABLE `ai_pipeline_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`steps_json` text NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_pipeline_definitions_status_check" CHECK("ai_pipeline_definitions"."status" IN ('draft', 'enabled', 'disabled')),
	CONSTRAINT "ai_pipeline_definitions_revision_check" CHECK("ai_pipeline_definitions"."revision" >= 1),
	CONSTRAINT "ai_pipeline_definitions_steps_json_check" CHECK(json_valid("ai_pipeline_definitions"."steps_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_pipeline_definitions_name_unique` ON `ai_pipeline_definitions` (`name`);--> statement-breakpoint
CREATE INDEX `ai_pipeline_definitions_status_updated_idx` ON `ai_pipeline_definitions` (`status`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `ai_pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL,
	`pipeline_revision` integer NOT NULL,
	`principal_kind` text DEFAULT 'starter_user' NOT NULL,
	`owner_id` text,
	`tenant_id` text DEFAULT 'starter' NOT NULL,
	`project_id` text DEFAULT 'starter' NOT NULL,
	`external_user_id` text DEFAULT 'starter' NOT NULL,
	`app_id` text,
	`subject_type` text,
	`subject_id` text,
	`session_id` text NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`steps_state_json` text NOT NULL,
	`final_output` text,
	`error_code` text,
	`request_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`pipeline_id`) REFERENCES `ai_pipeline_definitions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `ai_app_credentials`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `ai_agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_pipeline_runs_status_check" CHECK("ai_pipeline_runs"."status" IN ('pending', 'running', 'completed', 'failed', 'aborted')),
	CONSTRAINT "ai_pipeline_runs_revision_check" CHECK("ai_pipeline_runs"."pipeline_revision" >= 1),
	CONSTRAINT "ai_pipeline_runs_steps_state_json_check" CHECK(json_valid("ai_pipeline_runs"."steps_state_json")),
	CONSTRAINT "ai_pipeline_runs_principal_check" CHECK(("ai_pipeline_runs"."principal_kind" = 'starter_user' AND "ai_pipeline_runs"."owner_id" IS NOT NULL AND "ai_pipeline_runs"."app_id" IS NULL) OR ("ai_pipeline_runs"."principal_kind" = 'product_app' AND "ai_pipeline_runs"."owner_id" IS NULL AND "ai_pipeline_runs"."app_id" IS NOT NULL)),
	CONSTRAINT "ai_pipeline_runs_subject_pair_check" CHECK(("ai_pipeline_runs"."subject_type" IS NULL AND "ai_pipeline_runs"."subject_id" IS NULL) OR ("ai_pipeline_runs"."subject_type" IS NOT NULL AND "ai_pipeline_runs"."subject_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `ai_pipeline_runs_pipeline_created_idx` ON `ai_pipeline_runs` (`pipeline_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_pipeline_runs_status_created_idx` ON `ai_pipeline_runs` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_pipeline_runs_scope_user_created_idx` ON `ai_pipeline_runs` (`tenant_id`,`project_id`,`external_user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_pipeline_runs_app_idx` ON `ai_pipeline_runs` (`app_id`);