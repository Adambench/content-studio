ALTER TABLE `pieces` ADD `series` text;--> statement-breakpoint
ALTER TABLE `pieces` ADD `episode` integer;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `hidden` integer DEFAULT false NOT NULL;