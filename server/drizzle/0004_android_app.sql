CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`piece_id` text,
	`asset_type` text,
	`source` text DEFAULT 'upload' NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`media_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD `kind` text DEFAULT 'webpush' NOT NULL;--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD `session_id` text REFERENCES sessions(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `sessions` ADD `kind` text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `name` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_seen_at` integer;--> statement-breakpoint
UPDATE `sessions` SET `kind` = 'desktop' WHERE `user_agent` = 'Content Studio desktop app';
