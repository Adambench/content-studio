CREATE TABLE `notebook` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notebook_workspace_idx` ON `notebook` (`workspace_id`);