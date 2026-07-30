ALTER TABLE `company_config` ADD `cost_buffer_percent` integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `company_config` ADD `cost_margin_percent` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `estimate_net_working_days` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `cost_work_minutes_per_day` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `job_title` text;--> statement-breakpoint
ALTER TABLE `users` ADD `cost_per_day_satang` integer;