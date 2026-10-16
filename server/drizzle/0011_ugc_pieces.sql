ALTER TABLE `pieces` ADD `campaign_id` text REFERENCES campaigns(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `pieces_campaign_idx` ON `pieces` (`campaign_id`);
