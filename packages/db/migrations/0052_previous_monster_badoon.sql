CREATE TABLE `epics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`code` text,
	`source_doc_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_doc_id`) REFERENCES `docs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `epics_project_idx` ON `epics` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `epics_source_doc_idx` ON `epics` (`source_doc_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `epic_id` text REFERENCES epics(id);--> statement-breakpoint
CREATE INDEX `tasks_epic_idx` ON `tasks` (`epic_id`);