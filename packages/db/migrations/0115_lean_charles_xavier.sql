CREATE TABLE `secret_vault_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `secret_vault_items` ADD `folder_id` text REFERENCES secret_vault_folders(id);--> statement-breakpoint
CREATE INDEX `secret_vault_items_folder_idx` ON `secret_vault_items` (`folder_id`);