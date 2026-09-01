PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`agent_id` text,
	`lane` text NOT NULL,
	`status` text NOT NULL,
	`agent_revision` integer,
	`snapshot_json` text NOT NULL,
	`request_id` text NOT NULL,
	`idempotency_key` text,
	`idempotency_scope` text,
	`final_entry_id` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `ai_agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `ai_agent_definitions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_agent_runs_status_check" CHECK("__new_ai_agent_runs"."status" IN ('starting', 'running', 'completed', 'failed', 'aborted', 'interrupted')),
	CONSTRAINT "ai_agent_runs_revision_check" CHECK("__new_ai_agent_runs"."agent_revision" >= 1),
	CONSTRAINT "ai_agent_runs_agent_pair_check" CHECK(("__new_ai_agent_runs"."agent_id" IS NULL) = ("__new_ai_agent_runs"."agent_revision" IS NULL)),
	CONSTRAINT "ai_agent_runs_snapshot_json_check" CHECK(json_valid("__new_ai_agent_runs"."snapshot_json"))
);--> statement-breakpoint
INSERT INTO `__new_ai_agent_runs`("id", "session_id", "agent_id", "lane", "status", "agent_revision", "snapshot_json", "request_id", "idempotency_key", "idempotency_scope", "final_entry_id", "error_code", "created_at", "started_at", "finished_at") SELECT "id", "session_id", "agent_id", "lane", "status", "agent_revision", "snapshot_json", "request_id", "idempotency_key", "idempotency_scope", "final_entry_id", "error_code", "created_at", "started_at", "finished_at" FROM `ai_agent_runs`;--> statement-breakpoint
CREATE TABLE `__keep_ai_run_turns` AS SELECT * FROM `ai_run_turns`;--> statement-breakpoint
CREATE TABLE `__keep_ai_run_steps` AS SELECT * FROM `ai_run_steps`;--> statement-breakpoint
CREATE TABLE `__keep_ai_run_events` AS SELECT * FROM `ai_run_events`;--> statement-breakpoint
CREATE TABLE `__keep_ai_structured_outputs` AS SELECT * FROM `ai_structured_outputs`;--> statement-breakpoint
CREATE TABLE `__keep_ai_model_calls` AS SELECT * FROM `ai_model_calls`;--> statement-breakpoint
CREATE TABLE `__keep_ai_tool_executions` AS SELECT * FROM `ai_tool_executions`;--> statement-breakpoint
CREATE TABLE `__keep_ai_webhook_deliveries` AS SELECT * FROM `ai_webhook_deliveries`;--> statement-breakpoint
DROP TABLE `ai_tool_executions`;--> statement-breakpoint
DROP TABLE `ai_webhook_deliveries`;--> statement-breakpoint
DROP TABLE `ai_structured_outputs`;--> statement-breakpoint
DROP TABLE `ai_run_events`;--> statement-breakpoint
DROP TABLE `ai_run_steps`;--> statement-breakpoint
DROP TABLE `ai_model_calls`;--> statement-breakpoint
DROP TABLE `ai_run_turns`;--> statement-breakpoint
DROP TABLE `ai_agent_runs`;--> statement-breakpoint
ALTER TABLE `__new_ai_agent_runs` RENAME TO `ai_agent_runs`;--> statement-breakpoint
CREATE TABLE `ai_run_turns` ( `id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL, `turn_index` integer NOT NULL, `outcome` text DEFAULT 'running' NOT NULL, `started_at` integer NOT NULL, `finished_at` integer, FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `ai_run_turns` SELECT * FROM `__keep_ai_run_turns`;--> statement-breakpoint
DROP TABLE `__keep_ai_run_turns`;--> statement-breakpoint
CREATE TABLE `ai_run_steps` ( `id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL, `turn_id` text NOT NULL, `kind` text NOT NULL, `attempt` integer NOT NULL, `outcome` text DEFAULT 'running' NOT NULL, `error_code` text, `started_at` integer NOT NULL, `finished_at` integer, FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`turn_id`) REFERENCES `ai_run_turns`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `ai_run_steps` SELECT * FROM `__keep_ai_run_steps`;--> statement-breakpoint
DROP TABLE `__keep_ai_run_steps`;--> statement-breakpoint
CREATE TABLE `ai_run_events` ( `event_id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL, `sequence` integer NOT NULL, `type` text NOT NULL, `payload_json` text NOT NULL, `occurred_at` integer NOT NULL, FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `ai_run_events` SELECT * FROM `__keep_ai_run_events`;--> statement-breakpoint
DROP TABLE `__keep_ai_run_events`;--> statement-breakpoint
CREATE TABLE `ai_structured_outputs` ( `id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL, `step_id` text NOT NULL, `contract_name` text NOT NULL, `contract_version` text NOT NULL, `schema_hash` text NOT NULL, `render_kind` text NOT NULL, `value_json` text NOT NULL, `created_at` integer NOT NULL, FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`step_id`) REFERENCES `ai_run_steps`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `ai_structured_outputs` SELECT * FROM `__keep_ai_structured_outputs`;--> statement-breakpoint
DROP TABLE `__keep_ai_structured_outputs`;--> statement-breakpoint
CREATE TABLE `ai_model_calls` ( `id` text PRIMARY KEY NOT NULL, `request_id` text NOT NULL, `user_id` text NOT NULL, `app_id` text, `tenant_id` text DEFAULT 'starter' NOT NULL, `project_id` text DEFAULT 'starter' NOT NULL, `external_user_id` text, `principal_kind` text DEFAULT 'starter_user' NOT NULL, `scenario` text NOT NULL, `run_id` text, `turn_id` text, `step_id` text, `provider_id` text NOT NULL, `model_id` text NOT NULL, `api` text, `started_at` integer NOT NULL, `timeout_ms` integer DEFAULT 120000 NOT NULL, `finished_at` integer, `duration_ms` integer, `ttft_ms` integer, `chunk_count` integer, `response_model` text, `response_id` text, `http_status` integer, `result` text NOT NULL, `stop_reason` text, `error_code` text, `input_tokens` integer, `output_tokens` integer, `cache_read_tokens` integer, `cache_write_tokens` integer, `cache_write_1h_tokens` integer, `reasoning_tokens` integer, `total_tokens` integer, `cost_input` real, `cost_output` real, `cost_cache_read` real, `cost_cache_write` real, `cost_total` real, `cost_currency` text, FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE set null, FOREIGN KEY (`turn_id`) REFERENCES `ai_run_turns`(`id`) ON UPDATE no action ON DELETE set null, FOREIGN KEY (`step_id`) REFERENCES `ai_run_steps`(`id`) ON UPDATE no action ON DELETE set null, CONSTRAINT "ai_model_calls_principal_kind_check" CHECK("ai_model_calls"."principal_kind" IN ('starter_user', 'product_app')), CONSTRAINT "ai_model_calls_scenario_check" CHECK("ai_model_calls"."scenario" IN ('model_test', 'agent_run', 'completion', 'legacy'))
);--> statement-breakpoint
INSERT INTO `ai_model_calls` SELECT * FROM `__keep_ai_model_calls`;--> statement-breakpoint
DROP TABLE `__keep_ai_model_calls`;--> statement-breakpoint
CREATE TABLE `ai_tool_executions` ( `id` text PRIMARY KEY NOT NULL, `run_id` text, `model_call_id` text NOT NULL, `turn_id` text, `step_id` text, `tool_call_id` text, `tool_execution_id` text, `tool_name` text NOT NULL, `tool_version` text, `started_at` integer NOT NULL, `finished_at` integer, `duration_ms` integer, `status` text NOT NULL, `timeout_ms` integer NOT NULL, `error_code` text, FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE set null, FOREIGN KEY (`model_call_id`) REFERENCES `ai_model_calls`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`turn_id`) REFERENCES `ai_run_turns`(`id`) ON UPDATE no action ON DELETE set null, FOREIGN KEY (`step_id`) REFERENCES `ai_run_steps`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `ai_tool_executions` SELECT * FROM `__keep_ai_tool_executions`;--> statement-breakpoint
DROP TABLE `__keep_ai_tool_executions`;--> statement-breakpoint
CREATE TABLE `ai_webhook_deliveries` ( `id` text PRIMARY KEY NOT NULL, `endpoint_id` text NOT NULL, `app_id` text NOT NULL, `run_id` text NOT NULL, `event_type` text NOT NULL, `payload_json` text NOT NULL, `status` text DEFAULT 'pending' NOT NULL, `attempts` integer DEFAULT 0 NOT NULL, `next_attempt_at` integer, `last_response_code` integer, `last_error` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `delivered_at` integer, `dead_at` integer, FOREIGN KEY (`endpoint_id`) REFERENCES `ai_webhook_endpoints`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade, CONSTRAINT "ai_webhook_deliveries_status_check" CHECK("ai_webhook_deliveries"."status" IN ('pending', 'delivered', 'dead'))
);--> statement-breakpoint
INSERT INTO `ai_webhook_deliveries` SELECT * FROM `__keep_ai_webhook_deliveries`;--> statement-breakpoint
DROP TABLE `__keep_ai_webhook_deliveries`;--> statement-breakpoint
CREATE INDEX `ai_agent_runs_session_created_idx` ON `ai_agent_runs` (`session_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_agent_runs_session_lane_status_idx` ON `ai_agent_runs` (`session_id`,`lane`,`status`);--> statement-breakpoint
CREATE INDEX `ai_agent_runs_agent_created_idx` ON `ai_agent_runs` (`agent_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_agent_runs_status_created_idx` ON `ai_agent_runs` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_agent_runs_request_idx` ON `ai_agent_runs` (`request_id`);--> statement-breakpoint
CREATE INDEX `ai_agent_runs_finished_idx` ON `ai_agent_runs` (`finished_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_agent_runs_idempotency_unique` ON `ai_agent_runs` (`idempotency_scope`,`idempotency_key`) WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_run_turns_run_turn_uidx` ON `ai_run_turns` (`run_id`,`turn_index`);--> statement-breakpoint
CREATE INDEX `ai_run_turns_run_started_idx` ON `ai_run_turns` (`run_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_run_steps_run_started_idx` ON `ai_run_steps` (`run_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_run_steps_turn_started_idx` ON `ai_run_steps` (`turn_id`,`started_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_run_events_run_sequence_uidx` ON `ai_run_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `ai_run_events_run_type_sequence_idx` ON `ai_run_events` (`run_id`,`type`,`sequence`);--> statement-breakpoint
CREATE INDEX `ai_structured_outputs_run_created_idx` ON `ai_structured_outputs` (`run_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_structured_outputs_step_idx` ON `ai_structured_outputs` (`step_id`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_run_turn_step_idx` ON `ai_model_calls` (`run_id`,`turn_id`,`step_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_scope_started_idx` ON `ai_model_calls` (`tenant_id`,`project_id`,`external_user_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_user_started_idx` ON `ai_model_calls` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_provider_model_started_idx` ON `ai_model_calls` (`provider_id`,`model_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_result_started_idx` ON `ai_model_calls` (`result`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_request_started_idx` ON `ai_model_calls` (`request_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_model_calls_run_started_idx` ON `ai_model_calls` (`run_id`,`started_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tool_executions_tool_execution_id_unique` ON `ai_tool_executions` (`tool_execution_id`);--> statement-breakpoint
CREATE INDEX `ai_tool_executions_run_step_idx` ON `ai_tool_executions` (`run_id`,`step_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_tool_executions_call_started_idx` ON `ai_tool_executions` (`model_call_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_tool_executions_status_started_idx` ON `ai_tool_executions` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_webhook_deliveries_endpoint_created_idx` ON `ai_webhook_deliveries` (`endpoint_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_webhook_deliveries_status_next_attempt_idx` ON `ai_webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_webhook_deliveries_endpoint_run_uidx` ON `ai_webhook_deliveries` (`endpoint_id`,`run_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
