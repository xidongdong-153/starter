CREATE TABLE `__new_ai_tool_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`model_call_id` text NOT NULL,
	`turn_id` text,
	`step_id` text,
	`tool_call_id` text,
	`tool_execution_id` text,
	`tool_name` text NOT NULL,
	`tool_version` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`status` text NOT NULL,
	`timeout_ms` integer NOT NULL,
	`error_code` text,
	FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`model_call_id`) REFERENCES `ai_model_calls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `ai_run_turns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`step_id`) REFERENCES `ai_run_steps`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_ai_tool_executions`("id", "run_id", "model_call_id", "turn_id", "step_id", "tool_call_id", "tool_execution_id", "tool_name", "tool_version", "started_at", "finished_at", "duration_ms", "status", "timeout_ms", "error_code") SELECT "id", "run_id", COALESCE("model_call_id", "ai_call_id"), "turn_id", "step_id", "tool_call_id", "tool_execution_id", "tool_name", "tool_version", "started_at", "finished_at", "duration_ms", "status", "timeout_ms", "error_code" FROM `ai_tool_executions`;--> statement-breakpoint
DROP TABLE `ai_tool_executions`;--> statement-breakpoint
ALTER TABLE `__new_ai_tool_executions` RENAME TO `ai_tool_executions`;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tool_executions_tool_execution_id_unique` ON `ai_tool_executions` (`tool_execution_id`);--> statement-breakpoint
CREATE INDEX `ai_tool_executions_run_step_idx` ON `ai_tool_executions` (`run_id`,`step_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_tool_executions_call_started_idx` ON `ai_tool_executions` (`model_call_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_tool_executions_status_started_idx` ON `ai_tool_executions` (`status`,`started_at`);