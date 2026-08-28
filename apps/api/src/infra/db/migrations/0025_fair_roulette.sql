ALTER TABLE `ai_agent_runs` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `ai_agent_runs` ADD `idempotency_scope` text;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_agent_runs_idempotency_unique` ON `ai_agent_runs` (`idempotency_scope`,`idempotency_key`) WHERE idempotency_key IS NOT NULL;