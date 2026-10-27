CREATE TABLE `knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`topic` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'you' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`seed_key` text,
	`seed_title` text,
	`seed_body` text,
	`position` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_topic_idx` ON `knowledge` (`topic`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_seed_idx` ON `knowledge` (`seed_key`);--> statement-breakpoint
ALTER TABLE `edit_versions` ADD `quality` text;