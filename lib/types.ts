export type Speaker = 'client' | 'operator' | 'bot' | 'system';
export type Language = 'RU' | 'KZ' | 'EN';
export type ModelMode = 'local' | 'external_api' | 'hybrid';
export interface Message { id: string; timestamp: string; speaker: Speaker; text: string }
export interface Conversation {
  id: string; conversation_id: string; dataset_group_id: string;
  channel: 'agent chat' | 'voice call'; language: Language;
  transcript: Message[]; audio_url: string | null; importedAt: string;
}
export interface Level { value: number; label: string }
export interface Criterion {
  id: string; name: string; section: string; description: string;
  kind: 'boolean' | 'scale' | 'flag'; weight: number;
  allowNA: boolean; naCondition: string; levels: Level[];
}
export interface Checklist { id: string; name: string; version: number; criteria: Criterion[]; createdAt: string }
export type Rating = 'yes' | 'no' | 'na' | number;
export interface CriterionResult {
  criterionId: string; value: Rating; explanation: string;
  evidence: string[]; checkedRange: [string, string] | null; needsReview: boolean;
}
export interface ScoreItem {
  criterionId: string; applicable: boolean; raw: Rating; weight: number;
  effectiveWeight: number; points: number;
}
export interface ScoreReport {
  total: number | null; applicableWeight: number; critical: boolean;
  items: ScoreItem[]; sections: { name: string; score: number; possible: number }[];
}
export interface Usage { inputTokens: number; outputTokens: number; calls: number; costUsd: number | null }
export interface EvaluationRunConfig {
  promptRevision: string; strictJson: boolean; verification: boolean; knowledgeHash: string;
  modelMode?: ModelMode;
}
export interface Evaluation {
  id: string; conversationId: string; checklist: Checklist;
  initialResults: CriterionResult[]; results: CriterionResult[];
  initialScore: ScoreReport; score: ScoreReport;
  source: 'ai' | 'manual'; model: string; createdAt: string; updatedAt: string;
  usage: Usage; durationMs: number; warnings: string[]; transcriptHash: string;
  runConfig?: EvaluationRunConfig;
}
export interface EvaluationFailure {
  id: string; conversationId: string; checklistId: string;
  model: string; modelMode: ModelMode; error: string; code: string;
  createdAt: string; transcriptHash: string;
}
export interface Appeal {
  id: string; evaluationId: string; conversationId: string; criterionId: string;
  comment: string; status: 'pending' | 'confirmed' | 'changed';
  originalValue: Rating; proposedValue: Rating | null; finalValue: Rating | null;
  decisionReason: string | null; createdAt: string; resolvedAt: string | null;
}
export interface ProviderSettings {
  baseUrl: string; model: string; inputPrice: number | null; outputPrice: number | null;
  strictJson: boolean; verification: boolean; knowledge: string;
  modelMode?: ModelMode;
}
export interface AppState {
  conversations: Conversation[]; checklists: Checklist[]; activeChecklistId: string;
  evaluations: Evaluation[]; appeals: Appeal[]; settings: ProviderSettings;
  evaluationFailures?: EvaluationFailure[];
  providerConfigured: boolean; datasetConfigured: boolean;
}
export const DEFAULT_SETTINGS: ProviderSettings = {
  baseUrl: 'https://api.openai.com/v1', model: '', inputPrice: null, outputPrice: null,
  strictJson: true, verification: false, knowledge: '', modelMode: 'external_api',
};

/* HTTP contract:
 * GET  /api/state -> AppState (including persisted evaluationFailures)
 * POST /api/import {groupId:string} OR {payload:organizerResponse|records[],groupId?:string}
 *      -> {count:number,groupId:string}; original data never embedded in source.
 * POST /api/checklists {name,criteria} -> Checklist (new immutable version; active)
 * POST /api/settings ProviderSettings -> {ok:true}; API keys are NEVER stored here.
 * POST /api/evaluate {conversationId,checklistId?,apiKey?:string} -> Evaluation
 *      Failed attempts are stored separately with a reason; no zero/fake evaluation is created.
 * POST /api/manual {conversationId,checklistId?,results:CriterionResult[]} -> Evaluation
 * POST /api/appeals {evaluationId,criterionId,comment,proposedValue?:Rating} -> Appeal
 * POST /api/appeals/resolve {appealId,decision:'confirm'|'change',value?:Rating,reason:string,
 *      evidence?:string[],checkedRange?:[string,string]|null}
 *      -> {appeal:Appeal,evaluation:Evaluation}
 * errors: {error:string,code?:string} with non-2xx status.
 */
