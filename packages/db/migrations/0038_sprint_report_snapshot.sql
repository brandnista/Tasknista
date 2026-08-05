-- Pronista §Sprint & Board — snapshot นับ done/not-done ตอนปิด sprint (task ไม่ done จะเด้งกลับ backlog, sprint_id เคลียร์)
ALTER TABLE `sprints` ADD `done_count` integer;
--> statement-breakpoint
ALTER TABLE `sprints` ADD `not_done_count` integer;
