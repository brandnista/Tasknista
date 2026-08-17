CREATE TABLE `release_note_item_links` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`task_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `release_note_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `release_note_item_links_item_idx` ON `release_note_item_links` (`item_id`);--> statement-breakpoint
CREATE INDEX `release_note_item_links_task_idx` ON `release_note_item_links` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `release_note_item_links_uq_idx` ON `release_note_item_links` (`item_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `release_note_items` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`section` text,
	`text` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `project_releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `release_note_items_release_idx` ON `release_note_items` (`release_id`);--> statement-breakpoint
ALTER TABLE `project_releases` DROP COLUMN `notes`;