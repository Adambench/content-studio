CREATE TABLE `account_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`day` text NOT NULL,
	`at` integer NOT NULL,
	`followers` integer,
	`views` integer,
	`likes` integer,
	`posts` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_stats_day_idx` ON `account_stats` (`workspace_id`,`platform`,`external_id`,`day`);--> statement-breakpoint
CREATE TABLE `post_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`at` integer NOT NULL,
	`views` integer,
	`likes` integer,
	`comments` integer,
	`shares` integer,
	`saves` integer,
	`reach` integer,
	`avg_watch_seconds` real,
	`avg_view_percent` real,
	`follows_gained` integer,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_stats_post_idx` ON `post_stats` (`post_id`,`at`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`trigger` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`model` text,
	`body` text,
	`voice_before` text,
	`voice_after` text,
	`digest` text DEFAULT '' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviews_workspace_idx` ON `reviews` (`workspace_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `stats_note` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `stats` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `stats_at` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `stats_note` text;