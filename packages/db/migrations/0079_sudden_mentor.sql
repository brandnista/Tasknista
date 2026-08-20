CREATE TABLE `estimate_extra_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`amount_satang` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `estimate_extra_costs_project_idx` ON `estimate_extra_costs` (`project_id`);--> statement-breakpoint
CREATE TABLE `estimate_group_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_type_id` text NOT NULL,
	`sub_task_type_id` text,
	`team_member_text` text,
	`cost_role_id` text,
	`estimate_minutes` integer,
	`buffer_percent` integer,
	`work_minutes_per_day` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `estimate_group_overrides_project_idx` ON `estimate_group_overrides` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estimate_group_overrides_uq_idx` ON `estimate_group_overrides` (`project_id`,`task_type_id`,`sub_task_type_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `quotation_satang` integer;