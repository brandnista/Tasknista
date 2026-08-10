CREATE TABLE `workspace_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_projects_unique` ON `workspace_projects` (`workspace_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `__new_sprints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`workspace_id` text,
	`name` text,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`goal` text,
	`board_preset_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`done_count` integer,
	`not_done_count` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sprints`("id", "project_id", "workspace_id", "name", "start_date", "end_date", "goal", "board_preset_id", "status", "started_at", "completed_at", "done_count", "not_done_count", "created_by", "created_at") SELECT "id", "project_id", "workspace_id", "name", "start_date", "end_date", "goal", "board_preset_id", "status", "started_at", "completed_at", "done_count", "not_done_count", "created_by", "created_at" FROM `sprints`;--> statement-breakpoint
DROP TABLE `sprints`;--> statement-breakpoint
ALTER TABLE `__new_sprints` RENAME TO `sprints`;--> statement-breakpoint
CREATE INDEX `sprints_project_idx` ON `sprints` (`project_id`,`status`);