PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_second_brain_links` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'article' NOT NULL,
	`source` text DEFAULT 'line' NOT NULL,
	`url` text,
	`note` text,
	`problem` text,
	`solution_text` text,
	`message_text` text,
	`line_message_id` text,
	`line_user_id` text,
	`sender_display_name` text,
	`created_by_user_id` text,
	`captured_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_second_brain_links`("id", "kind", "source", "url", "note", "problem", "solution_text", "message_text", "line_message_id", "line_user_id", "sender_display_name", "created_by_user_id", "captured_at", "updated_at", "deleted_at") SELECT "id", 'article', 'line', "url", NULL, NULL, NULL, "message_text", "line_message_id", "line_user_id", "sender_display_name", NULL, "captured_at", "captured_at", "deleted_at" FROM `second_brain_links`;--> statement-breakpoint
DROP TABLE `second_brain_links`;--> statement-breakpoint
ALTER TABLE `__new_second_brain_links` RENAME TO `second_brain_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `second_brain_links_dedupe_idx` ON `second_brain_links` (`line_message_id`,`url`);