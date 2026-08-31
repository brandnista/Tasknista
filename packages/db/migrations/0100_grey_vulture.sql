CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`registered_date` text,
	`expiry_date` text NOT NULL,
	`provider` text,
	`responsible_user_id` text,
	`project_id` text,
	`notified_tiers` text,
	`expired_notified_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`responsible_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `domains_expiry_idx` ON `domains` (`expiry_date`);--> statement-breakpoint
ALTER TABLE `notifications` ADD `domain_id` text REFERENCES domains(id);