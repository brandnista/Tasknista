ALTER TABLE `tasks` ADD `cost_role_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `estimate_selected` integer DEFAULT false NOT NULL;