CREATE TABLE `research_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`day` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`body` text,
	`sweep` text DEFAULT '' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `research_briefs_workspace_idx` ON `research_briefs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `research_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`channel` text DEFAULT '' NOT NULL,
	`channel_url` text,
	`title` text DEFAULT '' NOT NULL,
	`views` integer,
	`channel_median` integer,
	`score` real,
	`posted_at` integer,
	`hook` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`keyword` text,
	`media_id` text,
	`analysis` text,
	`analysis_status` text DEFAULT 'none' NOT NULL,
	`analysis_error` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_items_key_idx` ON `research_items` (`workspace_id`,`platform`,`external_id`);--> statement-breakpoint
CREATE INDEX `research_items_score_idx` ON `research_items` (`workspace_id`,`score`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `research` text DEFAULT '{}' NOT NULL;