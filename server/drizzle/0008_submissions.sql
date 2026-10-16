CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`platform` text NOT NULL,
	`url` text NOT NULL,
	`status` text DEFAULT 'to_submit' NOT NULL,
	`submitted_at` integer,
	`views` integer,
	`earnings` real,
	`earnings_from` text,
	`note` text DEFAULT '' NOT NULL,
	`checked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_post_idx` ON `submissions` (`post_id`);--> statement-breakpoint
CREATE INDEX `submissions_campaign_idx` ON `submissions` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `budget_checked_at` integer;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `budget_warned_at` integer;