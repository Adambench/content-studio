CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`handle` text DEFAULT '' NOT NULL,
	`avatar_url` text,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer,
	`refresh_expires_at` integer,
	`scopes` text DEFAULT '' NOT NULL,
	`token_updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`status_message` text,
	`settings` text DEFAULT '{}' NOT NULL,
	`slots` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_external_idx` ON `accounts` (`workspace_id`,`platform`,`external_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`account_id` text,
	`platform` text NOT NULL,
	`account_label` text DEFAULT '' NOT NULL,
	`group_id` text NOT NULL,
	`format` text NOT NULL,
	`media_ids` text NOT NULL,
	`copy` text NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`scheduled_at` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`stage` text DEFAULT '' NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`remote` text DEFAULT '{}' NOT NULL,
	`external_id` text,
	`url` text,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `posts_status_idx` ON `posts` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `posts_workspace_idx` ON `posts` (`workspace_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `posts_piece_idx` ON `posts` (`piece_id`);