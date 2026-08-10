CREATE TABLE `authorization_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`reason` text,
	`request_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `authorization_audit_created_at_idx` ON `authorization_audit_events` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `authorization_audit_actor_idx` ON `authorization_audit_events` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `authorization_audit_action_idx` ON `authorization_audit_events` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `authorization_audit_target_idx` ON `authorization_audit_events` (`target_id`,`created_at`);--> statement-breakpoint
INSERT INTO `permissions` (`id`, `key`, `resource`, `action`, `description`, `is_system`, `archived_at`, `created_at`, `updated_at`) VALUES
  ('019c3e00-0001-7000-8000-000000000008', 'authorization-audit:read', 'authorization-audit', 'read', '查看授权变更审计事件', true, NULL, 1786318416463, 1786318416463);
