CREATE TABLE `external_document_log_sow_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`log_id` text NOT NULL,
	`task_id` text NOT NULL,
	FOREIGN KEY (`log_id`) REFERENCES `external_document_logs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `external_doc_log_sow_log_idx` ON `external_document_log_sow_tasks` (`log_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_doc_log_sow_uq_idx` ON `external_document_log_sow_tasks` (`log_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `external_document_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`document_name` text NOT NULL,
	`external_url` text NOT NULL,
	`version` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`created_by` text NOT NULL,
	`reviewed_by` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `external_doc_logs_project_idx` ON `external_document_logs` (`project_id`);