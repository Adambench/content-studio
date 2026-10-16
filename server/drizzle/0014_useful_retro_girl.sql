ALTER TABLE `campaign_sources` ADD `views` integer;--> statement-breakpoint
ALTER TABLE `campaign_sources` ADD `uploaded_at` integer;--> statement-breakpoint
ALTER TABLE `campaign_sources` ADD `creator` text;--> statement-breakpoint
ALTER TABLE `campaign_sources` ADD `viral` text DEFAULT '[]' NOT NULL;