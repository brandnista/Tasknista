CREATE TABLE `leave_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`leave_type_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`approver_id` text,
	`decided_by` text,
	`decided_at` integer,
	`reject_reason` text,
	`calendar_event_id` text,
	`attachment_r2_key` text,
	`attachment_filename` text,
	`attachment_mime` text,
	`attachment_size_bytes` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`calendar_event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `leave_requests_user_idx` ON `leave_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `leave_requests_approver_idx` ON `leave_requests` (`approver_id`,`status`);--> statement-breakpoint
CREATE TABLE `leave_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`requires_reason` integer DEFAULT true NOT NULL,
	`requires_attachment` integer DEFAULT false NOT NULL,
	`quota_days_by_role` text,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
