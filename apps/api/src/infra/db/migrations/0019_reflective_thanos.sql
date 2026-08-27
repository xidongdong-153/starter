ALTER TABLE `ai_model_calls` ADD `api` text;--> statement-breakpoint
ALTER TABLE `ai_model_calls` ADD `ttft_ms` integer;--> statement-breakpoint
ALTER TABLE `ai_model_calls` ADD `chunk_count` integer;--> statement-breakpoint
ALTER TABLE `ai_model_calls` ADD `response_model` text;--> statement-breakpoint
ALTER TABLE `ai_model_calls` ADD `response_id` text;--> statement-breakpoint
ALTER TABLE `ai_model_calls` ADD `http_status` integer;