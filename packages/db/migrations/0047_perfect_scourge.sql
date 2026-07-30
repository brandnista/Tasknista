CREATE TABLE `doc_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`url` text,
	`filename` text,
	`mime` text,
	`size_bytes` integer,
	`r2_key` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `docs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `doc_attachments_doc_idx` ON `doc_attachments` (`doc_id`);