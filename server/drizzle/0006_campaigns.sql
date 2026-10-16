CREATE TABLE `campaign_pages` (
	`campaign_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`campaign_id`, `workspace_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_pages_workspace_idx` ON `campaign_pages` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `campaign_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`kind` text NOT NULL,
	`link` text,
	`title` text DEFAULT '' NOT NULL,
	`duration_ms` integer,
	`file_name` text,
	`size` integer,
	`status` text DEFAULT 'found' NOT NULL,
	`progress` real,
	`detail` text DEFAULT '' NOT NULL,
	`transcript_from` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_sources_campaign_idx` ON `campaign_sources` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`business_workspace_id` text,
	`link` text,
	`title` text DEFAULT '' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`type` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'reading' NOT NULL,
	`accepting` integer,
	`rate_per_1k` real,
	`payouts` text DEFAULT '[]' NOT NULL,
	`platforms` text DEFAULT '[]' NOT NULL,
	`budget_total` real,
	`budget_left` real,
	`deadline` integer,
	`rules_text` text DEFAULT '' NOT NULL,
	`rules_locked` integer DEFAULT false NOT NULL,
	`checklist` text DEFAULT '[]' NOT NULL,
	`requirements` text DEFAULT '' NOT NULL,
	`halal_verdict` text,
	`halal_reasons` text DEFAULT '[]' NOT NULL,
	`page_text` text DEFAULT '' NOT NULL,
	`read_at` integer,
	`read_note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`business_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
