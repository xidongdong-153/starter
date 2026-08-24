CREATE TABLE `ai_custom_providers` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`definition_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_custom_providers_id_check" CHECK(length("ai_custom_providers"."provider_id") BETWEEN 1 AND 80 AND substr("ai_custom_providers"."provider_id", 1, 1) BETWEEN 'a' AND 'z' AND "ai_custom_providers"."provider_id" NOT GLOB '*[^a-z0-9-]*'),
	CONSTRAINT "ai_custom_providers_definition_json_check" CHECK(json_valid("ai_custom_providers"."definition_json")),
	CONSTRAINT "ai_custom_providers_definition_id_check" CHECK(json_extract("ai_custom_providers"."definition_json", '$.providerId') = "ai_custom_providers"."provider_id"),
	CONSTRAINT "ai_custom_providers_protocol_check" CHECK(json_extract("ai_custom_providers"."definition_json", '$.protocol') IN ('openai-completions', 'openai-responses', 'anthropic-messages')),
	CONSTRAINT "ai_custom_providers_models_check" CHECK(json_type("ai_custom_providers"."definition_json", '$.models') = 'array' AND json_array_length("ai_custom_providers"."definition_json", '$.models') BETWEEN 1 AND 200),
	CONSTRAINT "ai_custom_providers_secret_check" CHECK(json_type("ai_custom_providers"."definition_json", '$.apiKey') IS NULL AND json_type("ai_custom_providers"."definition_json", '$.secret') IS NULL AND json_type("ai_custom_providers"."definition_json", '$.credential') IS NULL),
	CONSTRAINT "ai_custom_providers_revision_check" CHECK("ai_custom_providers"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `ai_custom_providers_updated_idx` ON `ai_custom_providers` (`updated_at`,`provider_id`);