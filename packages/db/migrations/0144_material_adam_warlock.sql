ALTER TABLE `tasks` ADD `stg_passed_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `stg_passed_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `test_round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `stage_at` integer;--> statement-breakpoint
CREATE INDEX `tasks_assigned_by_idx` ON `tasks` (`assigned_by`,`status`);