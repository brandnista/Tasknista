-- Tasknista §2.12 — migrate ค่าสถานะเดิม todo/doing → non_start/on_processing ก่อนเปลี่ยนโครงตาราง (done คงเดิม)
UPDATE `tasks` SET `status` = 'non_start' WHERE `status` = 'todo';--> statement-breakpoint
UPDATE `tasks` SET `status` = 'on_processing' WHERE `status` = 'doing';--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`group_id` text,
	`code` text,
	`parent_id` text,
	`kind` text DEFAULT 'task' NOT NULL,
	`reporter_type` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`assignee_id` text,
	`status` text DEFAULT 'non_start' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`estimate_minutes` integer,
	`start_date` text,
	`due_date` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `task_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "project_id", "group_id", "code", "parent_id", "kind", "reporter_type", "sort_order", "title", "description", "assignee_id", "status", "priority", "estimate_minutes", "start_date", "due_date", "created_by", "created_at", "completed_at") SELECT "id", "project_id", "group_id", "code", "parent_id", "kind", "reporter_type", "sort_order", "title", "description", "assignee_id", "status", "priority", "estimate_minutes", "start_date", "due_date", "created_by", "created_at", "completed_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_group_idx` ON `tasks` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_idx` ON `tasks` (`assignee_id`,`status`);