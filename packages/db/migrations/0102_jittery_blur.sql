CREATE TABLE `personal_file_members` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `personal_files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_file_members_uq_idx` ON `personal_file_members` (`file_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `personal_files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`parent_id` text,
	`kind` text DEFAULT 'file' NOT NULL,
	`name` text NOT NULL,
	`r2_key` text,
	`mime` text,
	`size_bytes` integer,
	`content_markdown` text,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `personal_files_parent_idx` ON `personal_files` (`parent_id`);--> statement-breakpoint
CREATE INDEX `personal_files_owner_idx` ON `personal_files` (`owner_id`);