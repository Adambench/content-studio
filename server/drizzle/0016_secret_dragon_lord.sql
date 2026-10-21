CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`position` real DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'idea' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`script` text DEFAULT '' NOT NULL,
	`format` text DEFAULT '' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL,
	`url` text,
	`research_item_id` text,
	`media_id` text,
	`piece_id` text,
	`by` text DEFAULT 'you' NOT NULL,
	`assist` text,
	`seen_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`research_item_id`) REFERENCES `research_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ideas_workspace_idx` ON `ideas` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `ideas_parent_idx` ON `ideas` (`parent_id`);--> statement-breakpoint
CREATE INDEX `ideas_piece_idx` ON `ideas` (`piece_id`);--> statement-breakpoint
ALTER TABLE `research_items` ADD `transcript` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `uploads` ADD `idea_id` text;