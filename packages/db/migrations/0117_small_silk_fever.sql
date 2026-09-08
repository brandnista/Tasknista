CREATE TABLE `second_brain_links` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`message_text` text,
	`line_message_id` text NOT NULL,
	`line_user_id` text,
	`sender_display_name` text,
	`captured_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `second_brain_links_dedupe_idx` ON `second_brain_links` (`line_message_id`,`url`);