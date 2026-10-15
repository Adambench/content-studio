CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`piece_id` text NOT NULL,
	`name` text NOT NULL,
	`working` text NOT NULL,
	`working_updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`head_version_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `branches_piece_idx` ON `branches` (`piece_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`context_piece_id` text,
	`model` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `chat_messages` (`thread_id`);--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text DEFAULT 'New chat' NOT NULL,
	`sdk_session_id` text,
	`model` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threads_workspace_idx` ON `chat_threads` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `edit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`field` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`learned_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edit_events_workspace_idx` ON `edit_events` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_at` integer NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`piece_id` text,
	`kind` text NOT NULL,
	`asset_type` text,
	`source` text DEFAULT 'upload' NOT NULL,
	`original_name` text NOT NULL,
	`file_name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`duration_ms` integer,
	`width` integer,
	`height` integer,
	`has_thumb` integer DEFAULT false NOT NULL,
	`transcript_status` text DEFAULT 'none' NOT NULL,
	`transcript_text` text,
	`transcript_lang` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `media_workspace_idx` ON `media` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `media_piece_idx` ON `media` (`piece_id`);--> statement-breakpoint
CREATE TABLE `pieces` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`stage` text NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`active_branch_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pieces_workspace_idx` ON `pieces` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`number` integer NOT NULL,
	`parent_id` text,
	`author` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `versions_branch_idx` ON `versions` (`branch_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'violet' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`brand_guide` text DEFAULT '' NOT NULL,
	`voice_memory` text DEFAULT '' NOT NULL,
	`stages` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
