ALTER TABLE `campaigns` ADD `ended_at` integer;--> statement-breakpoint
UPDATE `campaigns` SET `ended_at` = `updated_at` WHERE `status` = 'ended';