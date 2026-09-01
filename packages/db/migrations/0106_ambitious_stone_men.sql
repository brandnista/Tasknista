PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`kind` text DEFAULT 'file' NOT NULL,
	`r2_key` text,
	`external_url` text,
	`name` text NOT NULL,
	`mime` text,
	`size_bytes` integer,
	`uploaded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_note_attachments`("id", "note_id", "kind", "r2_key", "external_url", "name", "mime", "size_bytes", "uploaded_by", "created_at") SELECT "id", "note_id", 'file', "r2_key", NULL, "name", "mime", "size_bytes", "uploaded_by", "created_at" FROM `note_attachments`;--> statement-breakpoint
DROP TABLE `note_attachments`;--> statement-breakpoint
ALTER TABLE `__new_note_attachments` RENAME TO `note_attachments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `note_attachments_note_idx` ON `note_attachments` (`note_id`);