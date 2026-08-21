CREATE TABLE `ai_app_credential_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`tenant_id` text NOT NULL,
	`project_id` text NOT NULL,
	`request_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_app_credential_audit_app_idx` ON `ai_app_credential_audit_events` (`app_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_app_credential_audit_created_idx` ON `ai_app_credential_audit_events` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `ai_app_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tenant_id` text NOT NULL,
	`project_id` text NOT NULL,
	`secret_hash` text NOT NULL,
	`secret_prefix` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_app_credentials_status_check" CHECK("ai_app_credentials"."status" IN ('active', 'revoked'))
);
--> statement-breakpoint
CREATE INDEX `ai_app_credentials_scope_idx` ON `ai_app_credentials` (`tenant_id`,`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `ai_app_credentials_prefix_idx` ON `ai_app_credentials` (`secret_prefix`);