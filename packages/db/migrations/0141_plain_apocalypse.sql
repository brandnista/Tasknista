ALTER TABLE `projects` ADD `last_activity_at` integer;--> statement-breakpoint
-- Backfill: อัปเดตล่าสุด = เวลา audit ล่าสุดของ task ในโปรเจกต์ (นิยามเดียวกับที่ GET /projects เคยคำนวณสด) — รันครั้งเดียวตอน migrate
UPDATE `projects` SET `last_activity_at` = (SELECT max(`a`.`at`) FROM `audit_logs` `a` INNER JOIN `tasks` `t` ON `a`.`entity_id` = `t`.`id` WHERE `a`.`entity` = 'task' AND `t`.`project_id` = `projects`.`id`);
