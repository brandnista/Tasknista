CREATE TABLE `daily_report_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `daily_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_report_recipients_report_recipient_uq_idx` ON `daily_report_recipients` (`report_id`,`recipient_id`);--> statement-breakpoint
CREATE INDEX `daily_report_recipients_recipient_idx` ON `daily_report_recipients` (`recipient_id`);