CREATE TABLE `ai_output_contract_snapshots` (
	`name` text NOT NULL,
	`version` text NOT NULL,
	`description` text NOT NULL,
	`schema_json` text NOT NULL,
	`render_kind` text NOT NULL,
	`visibility` text NOT NULL,
	`mode` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	PRIMARY KEY(`name`, `version`),
	CONSTRAINT "ai_output_contract_snapshots_json_check" CHECK(json_valid("ai_output_contract_snapshots"."schema_json")),
	CONSTRAINT "ai_output_contract_snapshots_visibility_check" CHECK("ai_output_contract_snapshots"."visibility" IN ('product', 'admin')),
	CONSTRAINT "ai_output_contract_snapshots_mode_check" CHECK("ai_output_contract_snapshots"."mode" IN ('optional', 'required'))
);
--> statement-breakpoint
CREATE TABLE `ai_run_resolved_manifests` (
	`run_id` text PRIMARY KEY NOT NULL,
	`manifest_hash` text NOT NULL,
	`manifest_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_run_resolved_manifests_json_check" CHECK(json_valid("ai_run_resolved_manifests"."manifest_json"))
);
--> statement-breakpoint
CREATE TABLE `ai_skill_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `ai_skills`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_skill_revisions_revision_check" CHECK("ai_skill_revisions"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_skill_revisions_skill_revision_uidx` ON `ai_skill_revisions` (`skill_id`,`revision`);--> statement-breakpoint
CREATE TABLE `ai_system_prompt_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`prompt_id`) REFERENCES `ai_system_prompts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_system_prompt_revisions_revision_check" CHECK("ai_system_prompt_revisions"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_system_prompt_revisions_prompt_revision_uidx` ON `ai_system_prompt_revisions` (`prompt_id`,`revision`);--> statement-breakpoint
ALTER TABLE `ai_agent_definitions` ADD `system_prompt_revision` integer;--> statement-breakpoint
ALTER TABLE `ai_agent_definitions` ADD `skill_revisions_json` text;--> statement-breakpoint
ALTER TABLE `ai_skills` ADD `current_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_structured_outputs` ADD `visibility` text;--> statement-breakpoint
ALTER TABLE `ai_structured_outputs` ADD `mode` text;--> statement-breakpoint
ALTER TABLE `ai_system_prompts` ADD `current_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
INSERT INTO `ai_system_prompt_revisions` (`id`, `prompt_id`, `revision`, `content`, `created_at`)
  SELECT lower(hex(randomblob(16))), `id`, 1, `content`, `updated_at` FROM `ai_system_prompts`;--> statement-breakpoint
INSERT INTO `ai_skill_revisions` (`id`, `skill_id`, `revision`, `content`, `created_at`)
  SELECT lower(hex(randomblob(16))), `id`, 1, `content`, `updated_at` FROM `ai_skills`;--> statement-breakpoint
UPDATE `ai_agent_definitions`
  SET `system_prompt_revision` = (
    SELECT `current_revision` FROM `ai_system_prompts`
    WHERE `ai_system_prompts`.`id` = json_extract(`ai_agent_definitions`.`config_json`, '$.systemPromptId')
  )
  WHERE json_extract(`config_json`, '$.systemPromptId') IS NOT NULL;--> statement-breakpoint
UPDATE `ai_agent_definitions`
  SET `skill_revisions_json` = (
    SELECT json_group_object(`j`.`value`, `s`.`current_revision`)
    FROM json_each(`ai_agent_definitions`.`config_json`, '$.skillIds') AS `j`
    JOIN `ai_skills` AS `s` ON `s`.`id` = `j`.`value`
  )
  WHERE json_array_length(json_extract(`config_json`, '$.skillIds')) > 0;
