ALTER TABLE `secret_vault_items` ADD `type` text DEFAULT 'website' NOT NULL;--> statement-breakpoint
ALTER TABLE `secret_vault_items` ADD `extra_fields_enc` text;