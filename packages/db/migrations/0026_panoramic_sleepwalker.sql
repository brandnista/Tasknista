CREATE TABLE `task_custom_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_custom_fields_task_idx` ON `task_custom_fields` (`task_id`,`sort_order`);