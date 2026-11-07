CREATE TABLE `cqa_appeals` (
	`id` text PRIMARY KEY NOT NULL,
	`evaluation_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`evaluation_id`) REFERENCES `cqa_evaluations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cqa_appeal_evaluation_idx` ON `cqa_appeals` (`evaluation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cqa_pending_appeal_idx` ON `cqa_appeals` (`evaluation_id`,`criterion_id`) WHERE "cqa_appeals"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `cqa_checklists` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cqa_checklist_version_idx` ON `cqa_checklists` (`version`);--> statement-breakpoint
CREATE TABLE `cqa_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_group_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cqa_conversation_group_idx` ON `cqa_conversations` (`dataset_group_id`);--> statement-breakpoint
CREATE TABLE `cqa_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`checklist_id` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_mutation_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `cqa_conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checklist_id`) REFERENCES `cqa_checklists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cqa_evaluation_conversation_idx` ON `cqa_evaluations` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `cqa_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
