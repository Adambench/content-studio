CREATE TABLE `moments` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`start` real NOT NULL,
	`end` real NOT NULL,
	`first_line` text DEFAULT '' NOT NULL,
	`hook_card` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`why` text DEFAULT '' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`scores` text,
	`captions` text,
	`halal_flags` text DEFAULT '[]' NOT NULL,
	`check_by_eye` text DEFAULT '[]' NOT NULL,
	`music` text,
	`frames` text,
	`status` text DEFAULT 'candidate' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`reject_reason` text,
	`piece_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `campaign_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `moments_source_idx` ON `moments` (`source_id`);--> statement-breakpoint
CREATE INDEX `moments_campaign_idx` ON `moments` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `moments_piece_idx` ON `moments` (`piece_id`);