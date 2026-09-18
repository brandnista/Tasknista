ALTER TABLE `docs` ADD `source` text;--> statement-breakpoint
ALTER TABLE `docs` ADD `drive_file_id` text;--> statement-breakpoint
ALTER TABLE `docs` ADD `source_task_attachment_id` text REFERENCES task_attachments(id) ON DELETE SET NULL;