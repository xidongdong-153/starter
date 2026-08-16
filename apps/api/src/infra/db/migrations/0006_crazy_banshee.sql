CREATE TABLE `ai_conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`content_json` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`stop_reason` text,
	`error_code` text,
	`generation_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `ai_generations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_conversation_messages_sequence_unique` ON `ai_conversation_messages` (`conversation_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `ai_conversation_messages_conversation_sequence_idx` ON `ai_conversation_messages` (`conversation_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `ai_conversation_messages_generation_idx` ON `ai_conversation_messages` (`generation_id`);--> statement-breakpoint
CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`active_generation_id` text,
	`last_provider_id` text,
	`last_model_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_owner_updated_idx` ON `ai_conversations` (`owner_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_conversations_owner_active_idx` ON `ai_conversations` (`owner_id`,`active_generation_id`);--> statement-breakpoint
CREATE TABLE `ai_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`status` text NOT NULL,
	`retry_of_generation_id` text,
	`user_message_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error_code` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`retry_of_generation_id`) REFERENCES `ai_generations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_message_id`) REFERENCES `ai_conversation_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_generations_owner_conversation_idx` ON `ai_generations` (`owner_id`,`conversation_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_generations_user_message_idx` ON `ai_generations` (`user_message_id`);