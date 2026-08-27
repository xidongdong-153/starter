CREATE TABLE `ai_run_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_run_events_run_sequence_uidx` ON `ai_run_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `ai_run_events_run_type_sequence_idx` ON `ai_run_events` (`run_id`,`type`,`sequence`);--> statement-breakpoint
CREATE TABLE `ai_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`kind` text NOT NULL,
	`attempt` integer NOT NULL,
	`outcome` text DEFAULT 'running' NOT NULL,
	`error_code` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `ai_run_turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_run_steps_run_started_idx` ON `ai_run_steps` (`run_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_run_steps_turn_started_idx` ON `ai_run_steps` (`turn_id`,`started_at`,`id`);--> statement-breakpoint
CREATE TABLE `ai_run_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`turn_index` integer NOT NULL,
	`outcome` text DEFAULT 'running' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_run_turns_run_started_idx` ON `ai_run_turns` (`run_id`,`started_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_run_turns_run_turn_uidx` ON `ai_run_turns` (`run_id`,`turn_index`);--> statement-breakpoint
CREATE TABLE `ai_structured_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`contract_name` text NOT NULL,
	`contract_version` text NOT NULL,
	`schema_hash` text NOT NULL,
	`render_kind` text NOT NULL,
	`value_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `ai_run_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_structured_outputs_run_created_idx` ON `ai_structured_outputs` (`run_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_structured_outputs_step_idx` ON `ai_structured_outputs` (`step_id`);--> statement-breakpoint
ALTER TABLE `ai_model_calls` ADD `turn_id` text REFERENCES ai_run_turns(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `ai_model_calls` ADD `step_id` text REFERENCES ai_run_steps(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `ai_model_calls_run_turn_step_idx` ON `ai_model_calls` (`run_id`,`turn_id`,`step_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `ai_tool_executions` ADD `run_id` text REFERENCES ai_agent_runs(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `ai_tool_executions` ADD `model_call_id` text REFERENCES ai_model_calls(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `ai_tool_executions` ADD `turn_id` text REFERENCES ai_run_turns(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `ai_tool_executions` ADD `step_id` text REFERENCES ai_run_steps(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `ai_tool_executions` ADD `tool_call_id` text;--> statement-breakpoint
ALTER TABLE `ai_tool_executions` ADD `tool_execution_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tool_executions_tool_execution_id_unique` ON `ai_tool_executions` (`tool_execution_id`);--> statement-breakpoint
CREATE INDEX `ai_tool_executions_run_step_idx` ON `ai_tool_executions` (`run_id`,`step_id`,`started_at`);