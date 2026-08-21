CREATE TABLE `daily_report_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `daily_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `daily_report_comments_report_idx` ON `daily_report_comments` (`report_id`);--> statement-breakpoint
CREATE TABLE `daily_report_items` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`task_id` text NOT NULL,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `daily_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `daily_report_items_report_idx` ON `daily_report_items` (`report_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_report_items_uq_idx` ON `daily_report_items` (`report_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `daily_report_plan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`task_id` text,
	`note` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `daily_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `daily_report_plan_items_report_idx` ON `daily_report_plan_items` (`report_id`);--> statement-breakpoint
CREATE TABLE `daily_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`report_date` text NOT NULL,
	`recipient_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`blocker_has_issue` integer DEFAULT false NOT NULL,
	`blocker_detail` text,
	`blocker_need_help_from` text,
	`submitted_at` integer,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `daily_reports_user_idx` ON `daily_reports` (`user_id`,`report_date`);--> statement-breakpoint
CREATE INDEX `daily_reports_recipient_idx` ON `daily_reports` (`recipient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_reports_user_date_uq_idx` ON `daily_reports` (`user_id`,`report_date`);--> statement-breakpoint
ALTER TABLE `notifications` ADD `daily_report_id` text REFERENCES daily_reports(id);--> statement-breakpoint
ALTER TABLE `users` ADD `manager_id` text REFERENCES users(id);