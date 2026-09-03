CREATE TABLE `ai_run_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`retry_reason` text,
	`owner_id` text NOT NULL,
	`fencing_token` integer NOT NULL,
	`error_code` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_run_attempts_status_check" CHECK("ai_run_attempts"."status" IN ('running', 'succeeded', 'failed', 'aborted', 'interrupted')),
	CONSTRAINT "ai_run_attempts_trigger_check" CHECK("ai_run_attempts"."trigger" IN ('initial', 'auto_retry')),
	CONSTRAINT "ai_run_attempts_attempt_no_check" CHECK("ai_run_attempts"."attempt_no" >= 1)
);
--> statement-breakpoint
CREATE INDEX `ai_run_attempts_run_started_idx` ON `ai_run_attempts` (`run_id`,`started_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_run_attempts_run_attempt_uidx` ON `ai_run_attempts` (`run_id`,`attempt_no`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`turn_id` text,
	`kind` text NOT NULL,
	`attempt` integer NOT NULL,
	`attempt_no` integer DEFAULT 1 NOT NULL,
	`outcome` text DEFAULT 'running' NOT NULL,
	`error_code` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `ai_run_turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ai_run_steps`("id", "run_id", "turn_id", "kind", "attempt", "attempt_no", "outcome", "error_code", "started_at", "finished_at") SELECT "id", "run_id", "turn_id", "kind", "attempt", 1, "outcome", "error_code", "started_at", "finished_at" FROM `ai_run_steps`;--> statement-breakpoint
DROP TABLE `ai_run_steps`;--> statement-breakpoint
ALTER TABLE `__new_ai_run_steps` RENAME TO `ai_run_steps`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_run_steps_run_started_idx` ON `ai_run_steps` (`run_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_run_steps_turn_started_idx` ON `ai_run_steps` (`turn_id`,`started_at`,`id`);--> statement-breakpoint
ALTER TABLE `ai_agent_runs` ADD `current_attempt_no` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_run_turns` ADD `attempt_no` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_tool_executions` ADD `idempotency_token` text;