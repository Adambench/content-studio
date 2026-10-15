CREATE TABLE `edit_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`edit_id` text NOT NULL,
	`number` integer NOT NULL,
	`author` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`spec` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`edit_id`) REFERENCES `edits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edit_versions_edit_idx` ON `edit_versions` (`edit_id`);--> statement-breakpoint
CREATE TABLE `edits` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`name` text DEFAULT 'Main edit' NOT NULL,
	`working` text NOT NULL,
	`working_updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`head_version_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edits_piece_idx` ON `edits` (`piece_id`);--> statement-breakpoint
CREATE TABLE `renders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`edit_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`version_id` text,
	`version_number` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`stage` text DEFAULT 'Waiting' NOT NULL,
	`error` text,
	`media_id` text,
	`duration_ms` integer,
	`elapsed_ms` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edit_id`) REFERENCES `edits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `renders_edit_idx` ON `renders` (`edit_id`);--> statement-breakpoint
ALTER TABLE `media` ADD `proxy_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `edit_template` text;