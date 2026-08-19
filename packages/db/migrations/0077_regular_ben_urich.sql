CREATE TABLE `changelog_item_links` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`task_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `changelog_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `changelog_item_links_item_idx` ON `changelog_item_links` (`item_id`);--> statement-breakpoint
CREATE INDEX `changelog_item_links_task_idx` ON `changelog_item_links` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `changelog_item_links_uq_idx` ON `changelog_item_links` (`item_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `changelog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`changelog_id` text NOT NULL,
	`category` text NOT NULL,
	`text` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`changelog_id`) REFERENCES `project_changelogs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `changelog_items_changelog_idx` ON `changelog_items` (`changelog_id`);--> statement-breakpoint
CREATE TABLE `project_changelogs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`changelog_no` integer NOT NULL,
	`title` text NOT NULL,
	`entry_date` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_changelogs_project_idx` ON `project_changelogs` (`project_id`);