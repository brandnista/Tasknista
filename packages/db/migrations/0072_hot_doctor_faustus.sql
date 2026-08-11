PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_epics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`workspace_id` text,
	`title` text NOT NULL,
	`code` text,
	`source_doc_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_doc_id`) REFERENCES `docs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_epics`("id", "project_id", "workspace_id", "title", "code", "source_doc_id", "sort_order", "created_at") SELECT "id", "project_id", NULL, "title", "code", "source_doc_id", "sort_order", "created_at" FROM `epics`;--> statement-breakpoint
DROP TABLE `epics`;--> statement-breakpoint
ALTER TABLE `__new_epics` RENAME TO `epics`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `epics_project_idx` ON `epics` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `epics_source_doc_idx` ON `epics` (`source_doc_id`);