ALTER TABLE `video_notes` ADD `lesson_id` text REFERENCES knowledge(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `video_notes_lesson_idx` ON `video_notes` (`lesson_id`);