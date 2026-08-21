PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_daily_report_items` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`task_id` text,
	`manual_title` text,
	`manual_minutes` integer,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `daily_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_daily_report_items`("id", "report_id", "task_id", "manual_title", "manual_minutes", "note", "sort_order", "created_at") SELECT "id", "report_id", "task_id", "manual_title", "manual_minutes", "note", "sort_order", "created_at" FROM `daily_report_items`;--> statement-breakpoint
DROP TABLE `daily_report_items`;--> statement-breakpoint
ALTER TABLE `__new_daily_report_items` RENAME TO `daily_report_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `daily_report_items_report_idx` ON `daily_report_items` (`report_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_report_items_uq_idx` ON `daily_report_items` (`report_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `__new_daily_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`report_date` text NOT NULL,
	`recipient_id` text,
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
INSERT INTO `__new_daily_reports`("id", "user_id", "report_date", "recipient_id", "status", "notes", "blocker_has_issue", "blocker_detail", "blocker_need_help_from", "submitted_at", "reviewed_at", "created_at") SELECT "id", "user_id", "report_date", "recipient_id", "status", "notes", "blocker_has_issue", "blocker_detail", "blocker_need_help_from", "submitted_at", "reviewed_at", "created_at" FROM `daily_reports`;--> statement-breakpoint
DROP TABLE `daily_reports`;--> statement-breakpoint
ALTER TABLE `__new_daily_reports` RENAME TO `daily_reports`;--> statement-breakpoint
CREATE INDEX `daily_reports_user_idx` ON `daily_reports` (`user_id`,`report_date`);--> statement-breakpoint
CREATE INDEX `daily_reports_recipient_idx` ON `daily_reports` (`recipient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_reports_user_date_uq_idx` ON `daily_reports` (`user_id`,`report_date`);