ALTER TABLE `company_config` ADD `task_types` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `task_type` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `sub_task_type` text;