-- Pronista §merge (2026-07-03) — "เอกสาร" ดูดรวม "คลังเอกสาร" (item 3) เข้าเป็นเมนูเดียว
-- ไม่มีข้อมูลจริงอยู่ใน library_* (สร้างวันนี้ ทดสอบแล้วลบทิ้งหมด) จึงลบตารางได้เลยแบบปลอดภัย

ALTER TABLE `docs` ADD `kind` text DEFAULT 'page' NOT NULL;
--> statement-breakpoint
ALTER TABLE `docs` ADD `external_url` text;
--> statement-breakpoint
ALTER TABLE `docs` ADD `r2_key` text;
--> statement-breakpoint
ALTER TABLE `docs` ADD `filename` text;
--> statement-breakpoint
ALTER TABLE `docs` ADD `mime` text;
--> statement-breakpoint
ALTER TABLE `docs` ADD `size_bytes` integer;
--> statement-breakpoint
ALTER TABLE `docs` ADD `is_template` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `docs` ADD `owner_id` text REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE `docs` ADD `visibility` text DEFAULT 'team' NOT NULL;
--> statement-breakpoint
-- no-regression: ของเก่าทั้งหมด default 'team' อยู่แล้วจาก ALTER ด้านบน + เติม owner_id จาก created_by
UPDATE `docs` SET `owner_id` = `created_by` WHERE `owner_id` IS NULL;
--> statement-breakpoint
CREATE TABLE `doc_members` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `docs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_members_uq_idx` ON `doc_members` (`doc_id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `doc_links` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`project_id` text,
	`task_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `docs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `doc_links_doc_idx` ON `doc_links` (`doc_id`);
--> statement-breakpoint
CREATE INDEX `doc_links_task_idx` ON `doc_links` (`task_id`);
--> statement-breakpoint
CREATE INDEX `doc_links_project_idx` ON `doc_links` (`project_id`);
--> statement-breakpoint
DROP TABLE `library_folder_members`;
--> statement-breakpoint
DROP TABLE `library_document_links`;
--> statement-breakpoint
DROP TABLE `library_documents`;
--> statement-breakpoint
DROP TABLE `library_folders`;
