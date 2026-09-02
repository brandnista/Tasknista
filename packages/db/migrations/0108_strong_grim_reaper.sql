PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_meeting_external_invitees` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`member_id` text,
	`name` text NOT NULL,
	`email` text,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_meeting_external_invitees`("id", "meeting_id", "member_id", "name", "email") SELECT "id", "meeting_id", "member_id", "name", "email" FROM `meeting_external_invitees`;--> statement-breakpoint
DROP TABLE `meeting_external_invitees`;--> statement-breakpoint
ALTER TABLE `__new_meeting_external_invitees` RENAME TO `meeting_external_invitees`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_external_invitees_meeting_member_idx` ON `meeting_external_invitees` (`meeting_id`,`member_id`);