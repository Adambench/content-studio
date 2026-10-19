CREATE TABLE `ai_spend` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`kind` text NOT NULL,
	`task_id` text,
	`credits` real DEFAULT 0 NOT NULL,
	`dollars` real DEFAULT 0 NOT NULL,
	`piece_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_spend_created_idx` ON `ai_spend` (`created_at`);