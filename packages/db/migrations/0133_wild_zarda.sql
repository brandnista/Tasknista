ALTER TABLE `leave_requests` ADD `group_id` text;--> statement-breakpoint
CREATE INDEX `leave_requests_group_idx` ON `leave_requests` (`group_id`);