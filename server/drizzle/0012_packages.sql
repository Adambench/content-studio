ALTER TABLE `chat_threads` ADD `piece_id` text REFERENCES pieces(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `threads_piece_idx` ON `chat_threads` (`piece_id`);--> statement-breakpoint
ALTER TABLE `media` ADD `suggestion` text;