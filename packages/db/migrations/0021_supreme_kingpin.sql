CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_members_uq_idx` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `company_config` ADD `product_statuses` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `category` text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `sprint` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `priority` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `tags` text;