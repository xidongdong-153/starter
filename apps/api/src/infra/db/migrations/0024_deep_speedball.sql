CREATE TABLE `ai_webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`app_id` text NOT NULL,
	`run_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_response_code` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`delivered_at` integer,
	`dead_at` integer,
	FOREIGN KEY (`endpoint_id`) REFERENCES `ai_webhook_endpoints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_webhook_deliveries_status_check" CHECK("ai_webhook_deliveries"."status" IN ('pending', 'delivered', 'dead'))
);
--> statement-breakpoint
CREATE INDEX `ai_webhook_deliveries_endpoint_created_idx` ON `ai_webhook_deliveries` (`endpoint_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_webhook_deliveries_status_next_attempt_idx` ON `ai_webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_webhook_deliveries_endpoint_run_uidx` ON `ai_webhook_deliveries` (`endpoint_id`,`run_id`);--> statement-breakpoint
CREATE TABLE `ai_webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`url` text NOT NULL,
	`signing_secret_encrypted` text NOT NULL,
	`status` text NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_delivery_at` integer,
	FOREIGN KEY (`app_id`) REFERENCES `ai_app_credentials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_webhook_endpoints_status_check" CHECK("ai_webhook_endpoints"."status" IN ('enabled', 'disabled'))
);
--> statement-breakpoint
CREATE INDEX `ai_webhook_endpoints_app_idx` ON `ai_webhook_endpoints` (`app_id`);--> statement-breakpoint
CREATE INDEX `ai_agent_runs_finished_idx` ON `ai_agent_runs` (`finished_at`);