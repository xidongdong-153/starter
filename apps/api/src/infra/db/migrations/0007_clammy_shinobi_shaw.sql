CREATE TABLE `ai_model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scenario` text NOT NULL,
	`conversation_id` text,
	`generation_id` text,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`started_at` integer NOT NULL,
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
	FOREIGN KEY (`generation_id`) REFERENCES `ai_generations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_model_calls_started_idx` ON `ai_model_calls` (`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_user_started_idx` ON `ai_model_calls` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_provider_model_started_idx` ON `ai_model_calls` (`provider_id`,`model_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_result_started_idx` ON `ai_model_calls` (`result`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_request_started_idx` ON `ai_model_calls` (`request_id`,`started_at`);--> statement-breakpoint
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
CREATE INDEX `ai_tool_executions_call_started_idx` ON `ai_tool_executions` (`ai_call_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_tool_executions_status_started_idx` ON `ai_tool_executions` (`status`,`started_at`);--> statement-breakpoint
INSERT INTO `permissions` (`id`, `key`, `resource`, `action`, `description`, `is_system`, `archived_at`, `created_at`, `updated_at`) VALUES
('019c4200-0001-7000-8000-000000000012', 'ai:usage:read', 'ai', 'usage:read', '查看 AI 模型调用和工具执行审计', true, NULL, 1786694400000, 1786694400000);
