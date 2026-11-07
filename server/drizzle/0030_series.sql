CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`about` text DEFAULT '' NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `series_workspace_idx` ON `series` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `pieces` ADD `series_id` text REFERENCES series(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `pieces_series_idx` ON `pieces` (`series_id`);--> statement-breakpoint
-- A series was only a name on its episodes: each name on a page becomes a series, its premise from the Ideas card it
-- was (Phase 11's `format`), and its episodes point at it.
INSERT INTO `series` (`id`, `workspace_id`, `name`, `about`, `position`)
SELECT
  lower(substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-a' || substr(h, 18, 3) || '-' || substr(h, 21, 12)),
  `workspace_id`, `series`,
  coalesce((SELECT trim(`format`) FROM `ideas` WHERE `ideas`.`kind` = 'series' AND `ideas`.`workspace_id` = s.`workspace_id` AND trim(`ideas`.`title`) = s.`series` AND `ideas`.`deleted_at` IS NULL LIMIT 1), ''),
  `first`
FROM (SELECT hex(randomblob(16)) AS h, `workspace_id`, `series`, min(`created_at`) AS `first` FROM `pieces` WHERE `series` IS NOT NULL AND trim(`series`) != '' GROUP BY `workspace_id`, `series`) s;--> statement-breakpoint
UPDATE `pieces` SET `series_id` = (SELECT `id` FROM `series` WHERE `series`.`workspace_id` = `pieces`.`workspace_id` AND `series`.`name` = `pieces`.`series`)
WHERE `series` IS NOT NULL;
