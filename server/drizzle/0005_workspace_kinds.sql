ALTER TABLE `workspaces` ADD `kind` text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `modules` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `niche` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `workspaces` SET `modules` = '["ideas","filming","grading","research"]';--> statement-breakpoint
UPDATE `media` SET `asset_type` = 'other' WHERE `asset_type` = 'music';--> statement-breakpoint
UPDATE `uploads` SET `asset_type` = 'other' WHERE `asset_type` = 'music';
