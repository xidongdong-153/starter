PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`user_id` text NOT NULL,
	`app_id` text,
	`tenant_id` text DEFAULT 'starter' NOT NULL,
	`project_id` text DEFAULT 'starter' NOT NULL,
	`external_user_id` text,
	`principal_kind` text DEFAULT 'starter_user' NOT NULL,
	`scenario` text NOT NULL,
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
	FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_model_calls_principal_kind_check" CHECK("__new_ai_model_calls"."principal_kind" IN ('starter_user', 'product_app')),
	CONSTRAINT "ai_model_calls_scenario_check" CHECK("__new_ai_model_calls"."scenario" IN ('model_test', 'agent_run', 'legacy'))
);
--> statement-breakpoint
INSERT INTO `__new_ai_model_calls`("id", "request_id", "user_id", "app_id", "tenant_id", "project_id", "external_user_id", "principal_kind", "scenario", "run_id", "provider_id", "model_id", "started_at", "timeout_ms", "finished_at", "duration_ms", "result", "stop_reason", "error_code", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cache_write_1h_tokens", "reasoning_tokens", "total_tokens", "cost_input", "cost_output", "cost_cache_read", "cost_cache_write", "cost_total", "cost_currency") SELECT "id", "request_id", "user_id", NULL, 'starter', 'starter', NULL, 'starter_user', "scenario", "run_id", "provider_id", "model_id", "started_at", "timeout_ms", "finished_at", "duration_ms", "result", "stop_reason", "error_code", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cache_write_1h_tokens", "reasoning_tokens", "total_tokens", "cost_input", "cost_output", "cost_cache_read", "cost_cache_write", "cost_total", "cost_currency" FROM `ai_model_calls`;--> statement-breakpoint
DROP TABLE `ai_model_calls`;--> statement-breakpoint
ALTER TABLE `__new_ai_model_calls` RENAME TO `ai_model_calls`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_model_calls_scope_started_idx` ON `ai_model_calls` (`tenant_id`,`project_id`,`external_user_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_user_started_idx` ON `ai_model_calls` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_provider_model_started_idx` ON `ai_model_calls` (`provider_id`,`model_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_result_started_idx` ON `ai_model_calls` (`result`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_request_started_idx` ON `ai_model_calls` (`request_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_run_started_idx` ON `ai_model_calls` (`run_id`,`started_at`,`id`);