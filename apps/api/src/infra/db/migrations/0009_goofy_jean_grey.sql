CREATE TABLE `ai_prompt_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_prompt_templates_name_unique` ON `ai_prompt_templates` (`name`);--> statement-breakpoint
CREATE INDEX `ai_prompt_templates_enabled_sort_idx` ON `ai_prompt_templates` (`enabled`,`sort_order`);--> statement-breakpoint
CREATE TABLE `ai_system_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_system_prompts_name_unique` ON `ai_system_prompts` (`name`);--> statement-breakpoint
ALTER TABLE `ai_conversations` ADD `system_prompt_id` text REFERENCES ai_system_prompts(id);--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `global_system_prompt_id` text REFERENCES ai_system_prompts(id);