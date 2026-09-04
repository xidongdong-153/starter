ALTER TABLE `ai_app_credentials` ADD `policy_json` text;--> statement-breakpoint
ALTER TABLE `ai_webhook_deliveries` ADD `event_id` text;--> statement-breakpoint
ALTER TABLE `ai_webhook_deliveries` ADD `sequence` integer;--> statement-breakpoint
ALTER TABLE `ai_webhook_deliveries` ADD `event_protocol_version` integer;--> statement-breakpoint
ALTER TABLE `ai_webhook_deliveries` ADD `claimed_at` integer;--> statement-breakpoint
ALTER TABLE `ai_webhook_deliveries` ADD `claim_expires_at` integer;