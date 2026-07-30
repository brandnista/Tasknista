CREATE TABLE `task_references` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`references_task_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`references_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_references_task_idx` ON `task_references` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_references_ref_idx` ON `task_references` (`references_task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_references_uq_idx` ON `task_references` (`task_id`,`references_task_id`);--> statement-breakpoint
ALTER TABLE `docs` ADD `doc_type` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `origin_doc_type` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `origin_code` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `origin_ref_code` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `origin_doc_id` text REFERENCES docs(id);--> statement-breakpoint
CREATE INDEX `tasks_origin_ref_idx` ON `tasks` (`origin_ref_code`);--> statement-breakpoint
CREATE INDEX `tasks_origin_code_idx` ON `tasks` (`project_id`,`origin_code`);