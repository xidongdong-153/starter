CREATE TABLE `ai_agent_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`config_json` text NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_agent_definitions_status_check" CHECK("ai_agent_definitions"."status" IN ('draft', 'enabled', 'disabled')),
	CONSTRAINT "ai_agent_definitions_revision_check" CHECK("ai_agent_definitions"."revision" >= 1),
	CONSTRAINT "ai_agent_definitions_config_json_check" CHECK(json_valid("ai_agent_definitions"."config_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_agent_definitions_name_unique` ON `ai_agent_definitions` (`name`);--> statement-breakpoint
CREATE INDEX `ai_agent_definitions_status_updated_idx` ON `ai_agent_definitions` (`status`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `ai_agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`lane` text NOT NULL,
	`status` text NOT NULL,
	`agent_revision` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`request_id` text NOT NULL,
	`final_entry_id` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `ai_agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `ai_agent_definitions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_agent_runs_status_check" CHECK("ai_agent_runs"."status" IN ('starting', 'running', 'completed', 'failed', 'aborted', 'interrupted')),
	CONSTRAINT "ai_agent_runs_revision_check" CHECK("ai_agent_runs"."agent_revision" >= 1),
	CONSTRAINT "ai_agent_runs_snapshot_json_check" CHECK(json_valid("ai_agent_runs"."snapshot_json"))
);
--> statement-breakpoint
CREATE INDEX `ai_agent_runs_session_created_idx` ON `ai_agent_runs` (`session_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_agent_runs_session_lane_status_idx` ON `ai_agent_runs` (`session_id`,`lane`,`status`);--> statement-breakpoint
CREATE INDEX `ai_agent_runs_agent_created_idx` ON `ai_agent_runs` (`agent_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_agent_runs_status_created_idx` ON `ai_agent_runs` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_agent_runs_request_idx` ON `ai_agent_runs` (`request_id`);--> statement-breakpoint
CREATE TABLE `ai_agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`default_agent_id` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_agent_id`) REFERENCES `ai_agent_definitions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_agent_sessions_owner_archived_updated_idx` ON `ai_agent_sessions` (`owner_id`,`archived_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_agent_sessions_default_agent_idx` ON `ai_agent_sessions` (`default_agent_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scenario` text NOT NULL,
	`conversation_id` text,
	`generation_id` text,
	`run_id` text,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`timeout_ms` integer DEFAULT 120000 NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`result` text NOT NULL,
	`stop_reason` text,
	`error_code` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`cache_write_1h_tokens` integer,
	`reasoning_tokens` integer,
	`total_tokens` integer,
	`cost_input` real,
	`cost_output` real,
	`cost_cache_read` real,
	`cost_cache_write` real,
	`cost_total` real,
	`cost_currency` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`generation_id`) REFERENCES `ai_generations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_model_calls_scenario_check" CHECK("__new_ai_model_calls"."scenario" IN ('model_test', 'conversation', 'agent_run')),
	CONSTRAINT "ai_model_calls_run_association_check" CHECK("__new_ai_model_calls"."run_id" IS NULL OR ("__new_ai_model_calls"."conversation_id" IS NULL AND "__new_ai_model_calls"."generation_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_ai_model_calls`("id", "request_id", "user_id", "scenario", "conversation_id", "generation_id", "run_id", "provider_id", "model_id", "started_at", "timeout_ms", "finished_at", "duration_ms", "result", "stop_reason", "error_code", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cache_write_1h_tokens", "reasoning_tokens", "total_tokens", "cost_input", "cost_output", "cost_cache_read", "cost_cache_write", "cost_total", "cost_currency") SELECT "id", "request_id", "user_id", "scenario", "conversation_id", "generation_id", NULL, "provider_id", "model_id", "started_at", "timeout_ms", "finished_at", "duration_ms", "result", "stop_reason", "error_code", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cache_write_1h_tokens", "reasoning_tokens", "total_tokens", "cost_input", "cost_output", "cost_cache_read", "cost_cache_write", "cost_total", "cost_currency" FROM `ai_model_calls`;--> statement-breakpoint
DROP TABLE `ai_model_calls`;--> statement-breakpoint
ALTER TABLE `__new_ai_model_calls` RENAME TO `ai_model_calls`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_model_calls_started_idx` ON `ai_model_calls` (`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_user_started_idx` ON `ai_model_calls` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_provider_model_started_idx` ON `ai_model_calls` (`provider_id`,`model_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_result_started_idx` ON `ai_model_calls` (`result`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_request_started_idx` ON `ai_model_calls` (`request_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_run_started_idx` ON `ai_model_calls` (`run_id`,`started_at`,`id`);
