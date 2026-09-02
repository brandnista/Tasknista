CREATE TABLE `meeting_external_invitees` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`member_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_external_invitees_meeting_member_idx` ON `meeting_external_invitees` (`meeting_id`,`member_id`);