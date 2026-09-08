CREATE TABLE `secret_vault_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`username` text,
	`password_enc` text,
	`url` text,
	`notes_enc` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `secret_vault_items_project_idx` ON `secret_vault_items` (`project_id`);--> statement-breakpoint
CREATE TABLE `vault_unlocks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `vault_unlocks_user_idx` ON `vault_unlocks` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `vault_pin_hash` text;