CREATE TABLE `library_document_links` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`project_id` text,
	`task_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `library_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `library_document_links_doc_idx` ON `library_document_links` (`document_id`);--> statement-breakpoint
CREATE INDEX `library_document_links_task_idx` ON `library_document_links` (`task_id`);--> statement-breakpoint
CREATE INDEX `library_document_links_project_idx` ON `library_document_links` (`project_id`);--> statement-breakpoint
CREATE TABLE `library_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`external_url` text,
	`r2_key` text,
	`filename` text,
	`mime` text,
	`size_bytes` integer,
	`is_template` integer DEFAULT false NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `library_documents_folder_idx` ON `library_documents` (`folder_id`);--> statement-breakpoint
CREATE INDEX `library_documents_owner_idx` ON `library_documents` (`owner_id`);--> statement-breakpoint
CREATE TABLE `library_folder_members` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_folder_members_uq_idx` ON `library_folder_members` (`folder_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `library_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`icon` text,
	`owner_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `library_folders_parent_idx` ON `library_folders` (`parent_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `library_folders_owner_idx` ON `library_folders` (`owner_id`);