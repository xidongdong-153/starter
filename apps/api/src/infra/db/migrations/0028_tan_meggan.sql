CREATE TABLE `ai_agent_lane_leases` (
	`session_id` text NOT NULL,
	`lane` text NOT NULL,
	`owner_id` text NOT NULL,
	`fencing_token` integer NOT NULL,
	`lease_until` integer NOT NULL,
	`heartbeat_at` integer NOT NULL,
	`acquired_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `lane`),
	CONSTRAINT "ai_agent_lane_leases_fencing_token_check" CHECK("ai_agent_lane_leases"."fencing_token" >= 1)
);
--> statement-breakpoint
ALTER TABLE `ai_agent_runs` ADD `execution_fencing_token` integer;