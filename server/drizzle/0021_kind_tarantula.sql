CREATE TABLE `page_styles` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`error` text,
	`built_at` integer,
	`built_from` text DEFAULT '' NOT NULL,
	`built_body` text DEFAULT '' NOT NULL,
	`reference_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `reference_videos` ADD `ingredients` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `reference_videos` ADD `note` text DEFAULT '' NOT NULL;