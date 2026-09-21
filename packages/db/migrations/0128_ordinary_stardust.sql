ALTER TABLE `tasks` ADD `accepted_at` integer;
--> statement-breakpoint
UPDATE `tasks`
SET `accepted_at` = (
  SELECT MIN(`audit_logs`.`at`)
  FROM `audit_logs`
  WHERE `audit_logs`.`entity` = 'task'
    AND `audit_logs`.`entity_id` = `tasks`.`id`
    AND `audit_logs`.`action` = 'task.accept'
    AND `audit_logs`.`actor_id` = `tasks`.`assignee_id`
)
WHERE `accepted_at` IS NULL;
