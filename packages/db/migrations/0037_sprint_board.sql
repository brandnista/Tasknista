-- Tasknista §Sprint & Board Management
ALTER TABLE `company_config` ADD `board_presets` text;

CREATE TABLE `sprints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`board_preset_id` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sprints_project_idx` ON `sprints` (`project_id`,`status`);
--> statement-breakpoint

ALTER TABLE `tasks` ADD `sprint_id` text REFERENCES sprints(id);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `sprint_status` text;
--> statement-breakpoint
CREATE INDEX `tasks_sprint_idx` ON `tasks` (`sprint_id`);
