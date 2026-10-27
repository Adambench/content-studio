CREATE TABLE `reference_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`channel` text DEFAULT '' NOT NULL,
	`views` integer,
	`posted_at` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`step` text DEFAULT '' NOT NULL,
	`error` text,
	`measures` text,
	`read` text,
	`lines` text DEFAULT '[]' NOT NULL,
	`has_frames` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`measured_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reference_videos_key_idx` ON `reference_videos` (`platform`,`external_id`);--> statement-breakpoint
CREATE INDEX `reference_videos_created_idx` ON `reference_videos` (`created_at`);--> statement-breakpoint
ALTER TABLE `knowledge` ADD `reference_id` text REFERENCES reference_videos(id) ON DELETE set null;