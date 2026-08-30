CREATE TABLE `ai_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`app_id` text,
	`principal_kind` text NOT NULL,
	`session_id` text,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`storage_path` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `ai_app_credentials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `ai_agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_attachments_principal_check" CHECK(("ai_attachments"."principal_kind" = 'starter_user' AND "ai_attachments"."owner_user_id" IS NOT NULL AND "ai_attachments"."app_id" IS NULL) OR ("ai_attachments"."principal_kind" = 'product_app' AND "ai_attachments"."owner_user_id" IS NULL AND "ai_attachments"."app_id" IS NOT NULL)),
	CONSTRAINT "ai_attachments_mime_check" CHECK("ai_attachments"."mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif'))
);
--> statement-breakpoint
CREATE INDEX `ai_attachments_owner_idx` ON `ai_attachments` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `ai_attachments_app_idx` ON `ai_attachments` (`app_id`);--> statement-breakpoint
CREATE INDEX `ai_attachments_session_idx` ON `ai_attachments` (`session_id`);