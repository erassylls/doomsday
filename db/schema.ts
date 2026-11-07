import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Schema-only migrations own these tables. Request handlers never create tables.
export const conversations = sqliteTable('cqa_conversations', {
  id: text('id').primaryKey(),
  datasetGroupId: text('dataset_group_id').notNull(),
  contentHash: text('content_hash').notNull(),
  payload: text('payload').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('cqa_conversation_group_idx').on(table.datasetGroupId)]);

export const checklists = sqliteTable('cqa_checklists', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  payload: text('payload').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('cqa_checklist_version_idx').on(table.version)]);

export const evaluations = sqliteTable('cqa_evaluations', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  checklistId: text('checklist_id').notNull().references(() => checklists.id),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(0),
  lastMutationId: text('last_mutation_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('cqa_evaluation_conversation_idx').on(table.conversationId)]);

export const evaluationFailures = sqliteTable('cqa_evaluation_failures', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  checklistId: text('checklist_id').notNull().references(() => checklists.id),
  payload: text('payload').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('cqa_failure_conversation_idx').on(table.conversationId, table.createdAt)]);

export const appeals = sqliteTable('cqa_appeals', {
  id: text('id').primaryKey(),
  evaluationId: text('evaluation_id').notNull().references(() => evaluations.id),
  criterionId: text('criterion_id').notNull(),
  status: text('status').notNull(),
  payload: text('payload').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('cqa_appeal_evaluation_idx').on(table.evaluationId),
  uniqueIndex('cqa_pending_appeal_idx').on(table.evaluationId, table.criterionId)
    .where(sql`${table.status} = 'pending'`),
]);

export const settings = sqliteTable('cqa_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});
