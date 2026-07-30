-- Tasknista §Sprint & Board — snapshot task point-in-time ตอนปิด sprint (ดู Detail Board ย้อนหลัง)
CREATE TABLE `sprint_task_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`sprint_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_code` text,
	`task_title` text NOT NULL,
	`status_id_at_close` text,
	`priority` text,
	`srs_ref_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sprint_task_snapshots_sprint_idx` ON `sprint_task_snapshots` (`sprint_id`);
