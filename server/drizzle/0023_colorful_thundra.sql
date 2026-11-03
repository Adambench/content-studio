CREATE TABLE `video_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`media_id` text,
	`version` integer,
	`at` real NOT NULL,
	`end` real,
	`text` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reply` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `video_notes_piece_idx` ON `video_notes` (`piece_id`);