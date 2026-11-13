CREATE TABLE `carousel_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`number` integer NOT NULL,
	`author` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`media_ids` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `carousel_versions_piece_idx` ON `carousel_versions` (`piece_id`);