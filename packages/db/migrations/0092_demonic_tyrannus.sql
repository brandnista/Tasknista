ALTER TABLE `notes` ADD `linked_kind` text;--> statement-breakpoint
ALTER TABLE `notes` ADD `linked_task_id` text;--> statement-breakpoint
ALTER TABLE `notes` ADD `linked_code` text;--> statement-breakpoint
ALTER TABLE `notes` ADD `linked_project_id` text REFERENCES projects(id);--> statement-breakpoint
ALTER TABLE `notes` ADD `linked_project_name` text;