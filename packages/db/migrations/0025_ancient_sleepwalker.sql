ALTER TABLE `tasks` ADD `kind` text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `reporter_type` text;