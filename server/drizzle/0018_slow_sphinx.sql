CREATE TABLE `tool_finds` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`adds` text DEFAULT '' NOT NULL,
	`risks` text DEFAULT '[]' NOT NULL,
	`licence` text,
	`stars` integer DEFAULT 0 NOT NULL,
	`upstream_at` integer,
	`score` integer DEFAULT 0 NOT NULL,
	`install` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_finds_url_idx` ON `tool_finds` (`url`);--> statement-breakpoint
CREATE TABLE `tool_uses` (
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `name`)
);
