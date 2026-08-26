CREATE TABLE `chat_channel_members` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_read_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_channel_members_channel_user_idx` ON `chat_channel_members` (`channel_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `chat_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`project_id` text,
	`name` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_channels_project_idx` ON `chat_channels` (`project_id`);--> statement-breakpoint
CREATE TABLE `chat_message_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`r2_key` text,
	`external_url` text,
	`filename` text NOT NULL,
	`mime` text,
	`size_bytes` integer,
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_message_attachments_message_idx` ON `chat_message_attachments` (`message_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`body` text NOT NULL,
	`parent_message_id` text,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_messages_channel_idx` ON `chat_messages` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `meeting_action_items` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`text` text NOT NULL,
	`task_id` text,
	`done` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `meeting_action_items_meeting_idx` ON `meeting_action_items` (`meeting_id`);--> statement-breakpoint
CREATE TABLE `meeting_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_participants_meeting_user_idx` ON `meeting_participants` (`meeting_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`meeting_type` text DEFAULT 'other' NOT NULL,
	`project_id` text,
	`sprint_id` text,
	`organizer_id` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`external_meeting_url` text,
	`agenda` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organizer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `meetings_start_idx` ON `meetings` (`start_at`);--> statement-breakpoint
CREATE INDEX `meetings_project_idx` ON `meetings` (`project_id`);