-- Pronista §Sprint & Board — ย้ายการเลือก Preset จากตอนสร้าง Sprint ไปตอนกด "เริ่ม Sprint" (board_preset_id ว่างได้ระหว่าง planned)
-- D1 บังคับ foreign_keys=ON เสมอ (ไม่รับ PRAGMA defer_foreign_keys/foreign_keys=OFF) — rebuild ตาราง sprints ตรงๆ จะชน FK จาก tasks.sprint_id
-- ถ้ามีแถวอ้างอิงอยู่ ต้องเคลียร์ค่าไปพักไว้ก่อน แล้วค่อยคืนกลับหลัง rebuild เสร็จ
CREATE TABLE `__sprint_id_backup` AS SELECT `id` AS task_id, `sprint_id` FROM `tasks` WHERE `sprint_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `tasks` SET `sprint_id` = NULL;
--> statement-breakpoint
CREATE TABLE `__new_sprints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`board_preset_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`done_count` integer,
	`not_done_count` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sprints`("id", "project_id", "name", "start_date", "end_date", "board_preset_id", "status", "started_at", "completed_at", "done_count", "not_done_count", "created_by", "created_at") SELECT "id", "project_id", "name", "start_date", "end_date", "board_preset_id", "status", "started_at", "completed_at", "done_count", "not_done_count", "created_by", "created_at" FROM `sprints`;--> statement-breakpoint
DROP TABLE `sprints`;--> statement-breakpoint
ALTER TABLE `__new_sprints` RENAME TO `sprints`;--> statement-breakpoint
CREATE INDEX `sprints_project_idx` ON `sprints` (`project_id`,`status`);--> statement-breakpoint
UPDATE `tasks` SET `sprint_id` = (SELECT sprint_id FROM `__sprint_id_backup` WHERE task_id = tasks.id) WHERE id IN (SELECT task_id FROM `__sprint_id_backup`);
--> statement-breakpoint
DROP TABLE `__sprint_id_backup`;
