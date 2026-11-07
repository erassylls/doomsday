CREATE TABLE `cqa_evaluation_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`checklist_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `cqa_conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checklist_id`) REFERENCES `cqa_checklists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cqa_failure_conversation_idx` ON `cqa_evaluation_failures` (`conversation_id`,`created_at`);