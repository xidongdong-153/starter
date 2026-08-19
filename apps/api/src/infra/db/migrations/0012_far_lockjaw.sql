CREATE TABLE `__keep_tool_executions` AS SELECT * FROM `ai_tool_executions`;--> statement-breakpoint
DROP TABLE `ai_tool_executions`;--> statement-breakpoint
DROP TABLE `ai_generations`;--> statement-breakpoint
DROP TABLE `ai_conversation_messages`;--> statement-breakpoint
DROP TABLE `ai_conversations`;--> statement-breakpoint
CREATE TABLE `__new_ai_model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`user_id` text NOT NULL,
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
	CONSTRAINT "ai_model_calls_scenario_check" CHECK("__new_ai_model_calls"."scenario" IN ('model_test', 'agent_run', 'legacy'))
);
--> statement-breakpoint
INSERT INTO `__new_ai_model_calls`("id", "request_id", "user_id", "scenario", "run_id", "provider_id", "model_id", "started_at", "timeout_ms", "finished_at", "duration_ms", "result", "stop_reason", "error_code", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cache_write_1h_tokens", "reasoning_tokens", "total_tokens", "cost_input", "cost_output", "cost_cache_read", "cost_cache_write", "cost_total", "cost_currency") SELECT "id", "request_id", "user_id", CASE "scenario" WHEN 'conversation' THEN 'legacy' ELSE "scenario" END, "run_id", "provider_id", "model_id", "started_at", "timeout_ms", "finished_at", "duration_ms", "result", "stop_reason", "error_code", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cache_write_1h_tokens", "reasoning_tokens", "total_tokens", "cost_input", "cost_output", "cost_cache_read", "cost_cache_write", "cost_total", "cost_currency" FROM `ai_model_calls`;--> statement-breakpoint
DROP TABLE `ai_model_calls`;--> statement-breakpoint
ALTER TABLE `__new_ai_model_calls` RENAME TO `ai_model_calls`;--> statement-breakpoint
CREATE TABLE `ai_tool_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`ai_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`status` text NOT NULL,
	`timeout_ms` integer NOT NULL,
	`error_code` text,
	FOREIGN KEY (`ai_call_id`) REFERENCES `ai_model_calls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `ai_tool_executions` SELECT * FROM `__keep_tool_executions`;--> statement-breakpoint
DROP TABLE `__keep_tool_executions`;--> statement-breakpoint
CREATE INDEX `ai_model_calls_started_idx` ON `ai_model_calls` (`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_user_started_idx` ON `ai_model_calls` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_provider_model_started_idx` ON `ai_model_calls` (`provider_id`,`model_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_result_started_idx` ON `ai_model_calls` (`result`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_request_started_idx` ON `ai_model_calls` (`request_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_run_started_idx` ON `ai_model_calls` (`run_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_tool_executions_call_started_idx` ON `ai_tool_executions` (`ai_call_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_tool_executions_status_started_idx` ON `ai_tool_executions` (`status`,`started_at`);
