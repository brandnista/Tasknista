DROP INDEX `project_members_uq_idx`;--> statement-breakpoint
ALTER TABLE `project_members` ADD `role` text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_uq_idx` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
UPDATE `project_members` SET `role` = 'editor';--> statement-breakpoint
INSERT INTO `project_members` (`id`, `project_id`, `user_id`, `role`)
SELECT lower(hex(randomblob(16))), t.project_id, t.assignee_id, 'editor'
FROM `tasks` t
WHERE t.project_id IS NOT NULL
  AND t.assignee_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `project_members` pm
    WHERE pm.project_id = t.project_id AND pm.user_id = t.assignee_id
  )
GROUP BY t.project_id, t.assignee_id;