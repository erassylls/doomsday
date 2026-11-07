import type { AppState, Checklist, Conversation, CriterionResult, Evaluation, EvaluationFailure, ModelMode } from './types';
import { calculateScore, validateResults } from './scoring';
import { validateChecklist } from './rubric';

/** Freedom Broker, «Приложение: сдача результатов», JSON 1.0, pages 1–3. */
export type SubmissionDataset = 'dev' | 'prod';
export type SubmissionValue = boolean | number | null;
export type SubmissionCriterionId = 'contact' | 'discovery' | 'identification' | 'consultation' | 'empathy' | 'dialogue' | 'closure' | 'critical';

export interface SubmissionCriterionRule {
  internalId: string; id: SubmissionCriterionId; name: string;
  weight: number; kind: 'boolean' | 'scale' | 'flag'; allowNA: boolean; levels: readonly number[];
}

export const SUBMISSION_CRITERIA: readonly SubmissionCriterionRule[] = [
  { internalId: 'c1', id: 'contact', name: 'Установление контакта', weight: 10, kind: 'boolean', allowNA: false, levels: [] },
  { internalId: 'c2', id: 'discovery', name: 'Выявление потребности', weight: 15, kind: 'boolean', allowNA: true, levels: [] },
  { internalId: 'c3', id: 'identification', name: 'Идентификация', weight: 20, kind: 'boolean', allowNA: true, levels: [] },
  { internalId: 'c4', id: 'consultation', name: 'Корректность и полнота', weight: 20, kind: 'scale', allowNA: true, levels: [0, 5, 10, 15, 20] },
  { internalId: 'c5', id: 'empathy', name: 'Эмпатия', weight: 15, kind: 'boolean', allowNA: false, levels: [] },
  { internalId: 'c6', id: 'dialogue', name: 'Ведение, скорость, грамотность', weight: 15, kind: 'scale', allowNA: false, levels: [0, 4, 7, 10] },
  { internalId: 'c7', id: 'closure', name: 'Завершение', weight: 5, kind: 'boolean', allowNA: true, levels: [] },
  { internalId: 'c8', id: 'critical', name: 'Грубые ошибки', weight: 0, kind: 'flag', allowNA: false, levels: [] },
];

export const SUBMISSION_DATASETS = {
  dev: { expected: 65, chats: 60, calls: 5, path: 'results/dev/results.json' },
  prod: { expected: 10, chats: 10, calls: 0, path: 'results/prod/results.json' },
} as const;

export interface SubmissionCriterion {
  criterion_id: SubmissionCriterionId; value: SubmissionValue;
  rationale: string; evidence_turns: number[];
}
export interface SubmissionOkResult {
  conversation_id: string; status: 'ok'; criteria: SubmissionCriterion[];
  score: { final_score: number; critical_flag: boolean };
}
export interface SubmissionErrorResult {
  conversation_id: string; status: 'error'; criteria: [];
  score: null; error: string;
}
export interface SubmissionDocument {
  schema_version: '1.0'; team_name: string;
  model: { mode: ModelMode; name: string };
  results: (SubmissionOkResult | SubmissionErrorResult)[];
}
export interface SubmissionIssue {
  code: string; message: string; conversationId?: string; criterionId?: string;
}
export interface SubmissionValidation {
  valid: boolean; issues: SubmissionIssue[]; warnings: SubmissionIssue[];
}
export interface SubmissionSourceConversation {
  conversation_id: string; channel: Conversation['channel']; transcript: readonly unknown[];
}
export interface SubmissionValidationOptions {
  dataset: SubmissionDataset;
  /** Supply the original imported group to verify IDs, channels, and evidence bounds. */
  conversations?: readonly SubmissionSourceConversation[];
  /** An alternative ID manifest, for tools that do not load transcripts. */
  expectedConversationIds?: readonly string[];
}
export interface SubmissionRow {
  id: string; conversationId: string; status: 'ok' | 'error';
  kind: 'ok' | 'failed' | 'unprocessed' | 'invalid';
  evaluationId?: string; model?: string; error?: string;
  needsReview: boolean; issues: SubmissionIssue[];
}
export interface SubmissionBuild {
  document: SubmissionDocument | null; json: string; filePath: string; canExport: boolean;
  issues: SubmissionIssue[]; warnings: SubmissionIssue[]; rows: SubmissionRow[];
  counts: { expected: number; total: number; ok: number; error: number; unprocessed: number; needsReview: number; chats: number; calls: number };
  models: string[]; needsLegacyMode: boolean;
}
export interface BuildSubmissionInput {
  state: Pick<AppState, 'conversations' | 'evaluations' | 'evaluationFailures'>;
  dataset: SubmissionDataset; groupId: string; teamName: string;
  /** Older runs did not save a deployment mode. A user must explicitly attest it. */
  legacyModelMode?: ModelMode; legacyModeConfirmed?: boolean;
  /** Only for an all-error file with no attributable model name. Never overrides recorded run metadata. */
  unprocessedModel?: { mode: ModelMode; name: string };
}

function issue(code: string, message: string, conversationId?: string, criterionId?: string): SubmissionIssue {
  return { code, message, ...(conversationId !== undefined ? { conversationId } : {}), ...(criterionId !== undefined ? { criterionId } : {}) };
}
function distinctIssues(items: SubmissionIssue[]): SubmissionIssue[] {
  const seen = new Set<string>();
  return items.filter((item) => { const key = JSON.stringify(item); if (seen.has(key)) return false; seen.add(key); return true; });
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function isMode(value: unknown): value is ModelMode { return value === 'local' || value === 'external_api' || value === 'hybrid'; }
function exactKeys(value: Record<string, unknown>, fields: readonly string[], label: string, issues: SubmissionIssue[], conversationId?: string, criterionId?: string): void {
  const missing = fields.filter((field) => !Object.prototype.hasOwnProperty.call(value, field));
  const extra = Object.keys(value).filter((field) => !fields.includes(field));
  if (missing.length) issues.push(issue('MISSING_FIELDS', `${label}: отсутствуют поля ${missing.join(', ')}.`, conversationId, criterionId));
  if (extra.length) issues.push(issue('EXTRA_FIELDS', `${label}: лишние поля ${extra.join(', ')} не входят в JSON 1.0.`, conversationId, criterionId));
}
function allowedSubmissionValue(rule: SubmissionCriterionRule, value: unknown): value is SubmissionValue {
  if (value === null) return rule.allowNA;
  return rule.kind === 'scale'
    ? typeof value === 'number' && Number.isFinite(value) && rule.levels.includes(value)
    : typeof value === 'boolean';
}

/** Only compatible official weights, scales, N/A permissions and the eight known IDs may be submitted. */
export function checklistSubmissionIssues(checklist: Checklist): SubmissionIssue[] {
  if (!checklist || !Array.isArray(checklist.criteria)) return [issue('CHECKLIST_INVALID', 'В оценке отсутствует снимок чек-листа.')];
  const issues = validateChecklist(checklist.criteria).map((message) => issue('CHECKLIST_INVALID', message));
  if (checklist.criteria.length !== SUBMISSION_CRITERIA.length) issues.push(issue('CHECKLIST_COUNT', 'Для сдачи нужны ровно восемь официальных критериев.'));
  const rules = new Map(SUBMISSION_CRITERIA.map((rule) => [rule.internalId, rule]));
  for (const criterion of checklist.criteria) {
    if (!criterion || typeof criterion !== 'object') continue;
    const rule = rules.get(criterion.id);
    if (!rule) { issues.push(issue('CHECKLIST_UNKNOWN_CRITERION', `Критерий ${String(criterion.id)} не имеет официального кода для сдачи.`)); continue; }
    const levels = Array.isArray(criterion.levels) ? criterion.levels.map((level) => level?.value).sort((a, b) => a - b) : [];
    if (criterion.kind !== rule.kind || criterion.weight !== rule.weight || criterion.allowNA !== rule.allowNA || JSON.stringify(levels) !== JSON.stringify(rule.levels)) {
      issues.push(issue('CHECKLIST_INCOMPATIBLE', `${rule.id}: тип, вес, разрешение N/A и шкала должны совпадать с приложением JSON 1.0.`, undefined, rule.id));
    }
  }
  for (const rule of SUBMISSION_CRITERIA) if (!checklist.criteria.some((criterion) => criterion?.id === rule.internalId)) {
    issues.push(issue('CHECKLIST_MISSING_CRITERION', `В чек-листе отсутствует ${rule.id} (${rule.internalId}).`, undefined, rule.id));
  }
  return distinctIssues(issues);
}

function sourceIssues(conversations: readonly SubmissionSourceConversation[], dataset: SubmissionDataset): SubmissionIssue[] {
  const issues: SubmissionIssue[] = [];
  const spec = SUBMISSION_DATASETS[dataset];
  const seen = new Set<string>();
  for (const conversation of conversations) {
    if (!isText(conversation.conversation_id)) issues.push(issue('SOURCE_ID_INVALID', 'В исходном наборе найден пустой conversation_id.'));
    if (seen.has(conversation.conversation_id)) issues.push(issue('SOURCE_ID_DUPLICATE', `В исходном наборе повторяется conversation_id «${conversation.conversation_id}».`, conversation.conversation_id));
    seen.add(conversation.conversation_id);
    if (!Array.isArray(conversation.transcript) || !conversation.transcript.length) issues.push(issue('SOURCE_TRANSCRIPT_EMPTY', 'Отсутствует исходный массив транскрипта.', conversation.conversation_id));
  }
  if (conversations.length !== spec.expected) issues.push(issue('DATASET_COUNT', `${dataset.toUpperCase()}: нужно ${spec.expected} диалогов, загружено ${conversations.length}.`));
  const chats = conversations.filter((conversation) => conversation.channel === 'agent chat').length;
  const calls = conversations.filter((conversation) => conversation.channel === 'voice call').length;
  if (chats !== spec.chats || calls !== spec.calls || chats + calls !== conversations.length) {
    issues.push(issue('DATASET_CHANNELS', `${dataset.toUpperCase()}: нужны ${spec.chats} чатов и ${spec.calls} звонков; сейчас ${chats} и ${calls}.`));
  }
  return distinctIssues(issues);
}

function officialScore(criteria: Map<string, SubmissionCriterion>): number {
  let weight = 0;
  let points = 0;
  for (const rule of SUBMISSION_CRITERIA) {
    const value = criteria.get(rule.id)!.value;
    if (rule.kind === 'flag' || value === null) continue;
    weight += rule.weight;
    const fraction = typeof value === 'number' ? value / Math.max(...rule.levels) : value ? 1 : 0;
    points += rule.weight * fraction;
  }
  return Math.round((100 * points / weight + Number.EPSILON) * 100) / 100;
}

/** Validate an imported results.json without trusting TypeScript types or silently coercing values. */
export function validateSubmission(value: unknown, options: SubmissionValidationOptions): SubmissionValidation {
  const issues: SubmissionIssue[] = [];
  const warnings: SubmissionIssue[] = [];
  const finish = (): SubmissionValidation => ({ valid: issues.length === 0, issues: distinctIssues(issues), warnings: distinctIssues(warnings) });
  if (options.dataset !== 'dev' && options.dataset !== 'prod') {
    issues.push(issue('DATASET_INVALID', 'Выберите назначение файла: DEV или PROD.')); return finish();
  }
  if (!isObject(value)) { issues.push(issue('DOCUMENT_INVALID', 'JSON должен содержать один объект, а не массив или отдельное значение.')); return finish(); }
  exactKeys(value, ['schema_version', 'team_name', 'model', 'results'], 'Файл', issues);
  if (value.schema_version !== '1.0') issues.push(issue('SCHEMA_VERSION', 'schema_version должен быть строкой «1.0».'));
  if (!isText(value.team_name)) issues.push(issue('TEAM_NAME', 'Укажите непустой team_name.'));
  if (!isObject(value.model)) issues.push(issue('MODEL_INVALID', 'model должен быть объектом с mode и name.'));
  else {
    exactKeys(value.model, ['mode', 'name'], 'model', issues);
    if (!isMode(value.model.mode)) issues.push(issue('MODEL_MODE', 'model.mode: разрешены local, external_api или hybrid.'));
    if (!isText(value.model.name)) issues.push(issue('MODEL_NAME', 'В model.name нужны названия фактически использованных моделей.'));
  }
  if (!Array.isArray(value.results)) { issues.push(issue('RESULTS_INVALID', 'results должен быть массивом.')); return finish(); }
  const spec = SUBMISSION_DATASETS[options.dataset];
  if (value.results.length !== spec.expected) issues.push(issue('RESULTS_COUNT', `${options.dataset.toUpperCase()}: в results должно быть ровно ${spec.expected} записей, включая ошибки; найдено ${value.results.length}.`));

  const sourceById = new Map(options.conversations?.map((conversation) => [conversation.conversation_id, conversation]));
  if (options.conversations) issues.push(...sourceIssues(options.conversations, options.dataset));
  const expectedIds = options.expectedConversationIds || options.conversations?.map((conversation) => conversation.conversation_id);
  if (expectedIds) {
    if (expectedIds.some((id) => !isText(id))) issues.push(issue('MANIFEST_ID_INVALID', 'В списке исходных ID есть пустое значение.'));
    if (new Set(expectedIds).size !== expectedIds.length) issues.push(issue('MANIFEST_ID_DUPLICATE', 'Список исходных ID содержит повторы.'));
    if (expectedIds.length !== spec.expected) issues.push(issue('MANIFEST_COUNT', `Для ${options.dataset.toUpperCase()} список исходных ID должен содержать ${spec.expected} записей.`));
    if (options.conversations) {
      const fromConversations = new Set(options.conversations.map((conversation) => conversation.conversation_id));
      if (expectedIds.length !== options.conversations.length || expectedIds.some((id) => !fromConversations.has(id))) issues.push(issue('MANIFEST_SOURCE_MISMATCH', 'Список ожидаемых ID не совпадает с исходными диалогами.'));
    }
  }
  const expected = expectedIds ? new Set(expectedIds) : null;
  const seenIds = new Set<string>();
  let errorCount = 0;
  let hasOk = false;
  for (const [index, raw] of value.results.entries()) {
    if (!isObject(raw)) { issues.push(issue('RESULT_INVALID', `Запись ${index + 1} должна быть объектом.`)); continue; }
    const id = typeof raw.conversation_id === 'string' ? raw.conversation_id : undefined;
    if (!isText(raw.conversation_id)) issues.push(issue('RESULT_ID_INVALID', `Запись ${index + 1}: нужен исходный conversation_id.`, id));
    else {
      if (seenIds.has(raw.conversation_id)) issues.push(issue('RESULT_ID_DUPLICATE', `conversation_id «${raw.conversation_id}» встречается более одного раза.`, id));
      seenIds.add(raw.conversation_id);
      if (expected && !expected.has(raw.conversation_id)) issues.push(issue('RESULT_ID_UNEXPECTED', 'conversation_id отсутствует в исходном наборе. Сохраните ID без изменений.', id));
    }
    if (raw.status === 'error') {
      errorCount++;
      exactKeys(raw, ['conversation_id', 'status', 'criteria', 'score', 'error'], 'Ошибка обработки', issues, id);
      if (!Array.isArray(raw.criteria) || raw.criteria.length !== 0) issues.push(issue('ERROR_CRITERIA', 'Для status=error нужен пустой criteria: [].', id));
      if (raw.score !== null) issues.push(issue('ERROR_SCORE', 'Для status=error score должен быть null, а не нулём.', id));
      if (!isText(raw.error)) issues.push(issue('ERROR_REASON', 'Для status=error нужна непустая причина в error.', id));
      continue;
    }
    if (raw.status !== 'ok') { issues.push(issue('RESULT_STATUS', 'status должен быть «ok» или «error».', id)); continue; }
    hasOk = true;
    exactKeys(raw, ['conversation_id', 'status', 'criteria', 'score'], 'Оценка', issues, id);
    const validCriteria = new Map<string, SubmissionCriterion>();
    const seenCriteria = new Set<string>();
    if (!Array.isArray(raw.criteria)) issues.push(issue('CRITERIA_INVALID', 'criteria должен быть массивом восьми критериев.', id));
    else {
      if (raw.criteria.length !== SUBMISSION_CRITERIA.length) issues.push(issue('CRITERIA_COUNT', 'Для status=ok нужны все восемь критериев, каждый ровно один раз.', id));
      for (const criterion of raw.criteria) {
        if (!isObject(criterion)) { issues.push(issue('CRITERION_INVALID', 'Каждый критерий должен быть объектом.', id)); continue; }
        const criterionId = typeof criterion.criterion_id === 'string' ? criterion.criterion_id : undefined;
        const rule = SUBMISSION_CRITERIA.find((item) => item.id === criterionId);
        exactKeys(criterion, ['criterion_id', 'value', 'rationale', 'evidence_turns'], 'Критерий', issues, id, criterionId);
        if (!rule) { issues.push(issue('CRITERION_UNKNOWN', `Неизвестный criterion_id: ${String(criterion.criterion_id)}.`, id, criterionId)); continue; }
        if (seenCriteria.has(rule.id)) issues.push(issue('CRITERION_DUPLICATE', `${rule.id}: критерий повторяется.`, id, rule.id));
        seenCriteria.add(rule.id);
        if (!allowedSubmissionValue(rule, criterion.value)) issues.push(issue('CRITERION_VALUE', `${rule.id}: неверное значение или тип. Используйте официальные boolean/null и ступени шкалы.`, id, rule.id));
        else validCriteria.set(rule.id, criterion as unknown as SubmissionCriterion);
        if (!isText(criterion.rationale)) issues.push(issue('CRITERION_RATIONALE', `${rule.id}: нужно краткое непустое обоснование.`, id, rule.id));
        if (!Array.isArray(criterion.evidence_turns) || criterion.evidence_turns.length === 0 || criterion.evidence_turns.some((turn) => !Number.isSafeInteger(turn) || turn < 1)) {
          issues.push(issue('EVIDENCE_TURNS', `${rule.id}: evidence_turns должен содержать целые номера исходных реплик, начиная с 1.`, id, rule.id));
        } else {
          if (new Set(criterion.evidence_turns).size !== criterion.evidence_turns.length) issues.push(issue('EVIDENCE_DUPLICATE', `${rule.id}: номер подтверждающей реплики повторяется.`, id, rule.id));
          const conversation = id === undefined ? undefined : sourceById.get(id);
          if (conversation && Array.isArray(conversation.transcript) && criterion.evidence_turns.some((turn) => turn > conversation.transcript.length)) issues.push(issue('EVIDENCE_OUT_OF_RANGE', `${rule.id}: номер реплики выходит за исходный транскрипт.`, id, rule.id));
        }
      }
      for (const rule of SUBMISSION_CRITERIA) if (!seenCriteria.has(rule.id)) issues.push(issue('CRITERION_MISSING', `Отсутствует критерий ${rule.id}.`, id, rule.id));
    }
    if (!isObject(raw.score)) issues.push(issue('SCORE_INVALID', 'Для status=ok нужен score с final_score и critical_flag.', id));
    else {
      exactKeys(raw.score, ['final_score', 'critical_flag'], 'score', issues, id);
      const total = raw.score.final_score;
      if (typeof total !== 'number' || !Number.isFinite(total) || total < 0 || total > 100 || Math.abs(total * 100 - Math.round(total * 100)) > 1e-8) {
        issues.push(issue('FINAL_SCORE', 'final_score должен быть числом от 0 до 100, округлённым до двух знаков.', id));
      } else if (validCriteria.size === SUBMISSION_CRITERIA.length && Math.abs(total - officialScore(validCriteria)) > 1e-9) {
        issues.push(issue('SCORE_FORMULA', `final_score не совпадает с официальной формулой; ожидается ${officialScore(validCriteria)}.`, id));
      }
      if (typeof raw.score.critical_flag !== 'boolean') issues.push(issue('CRITICAL_FLAG_TYPE', 'critical_flag должен быть boolean.', id));
      else if (validCriteria.has('critical') && raw.score.critical_flag !== validCriteria.get('critical')!.value) issues.push(issue('CRITICAL_FLAG_MISMATCH', 'critical_flag должен совпадать с value критерия critical.', id, 'critical'));
    }
  }
  if (expected) for (const id of expected) if (!seenIds.has(id)) issues.push(issue('RESULT_ID_MISSING', 'В results пропущен диалог из исходного набора; добавьте оценку или status=error.', id));
  if (errorCount) warnings.push(issue('PROCESSING_ERRORS', `В файле ${errorCount} записей status=error. Они сохраняют ID и причину, но не являются успешными оценками.`));
  if (!expectedIds) warnings.push(issue('IDS_UNVERIFIED', 'Без исходного списка ID нельзя подтвердить, что файл содержит именно выданный набор.'));
  if (hasOk && !options.conversations) warnings.push(issue('EVIDENCE_UNVERIFIED', 'Без исходных транскриптов нельзя проверить верхнюю границу evidence_turns.'));
  return finish();
}

async function transcriptHash(conversation: Conversation): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(conversation.transcript)));
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function latest<T extends { id: string; createdAt: string }>(items: readonly T[]): T | undefined {
  return [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];
}
function errorResult(conversation: Conversation, reason: string): SubmissionErrorResult {
  return { conversation_id: conversation.conversation_id, status: 'error', criteria: [], score: null, error: reason };
}
function evidenceTurns(result: CriterionResult, conversation: Conversation): number[] {
  const positions = new Map(conversation.transcript.map((message, index) => [message.id, index + 1]));
  if (result.evidence.length) return [...new Set(result.evidence.map((id) => positions.get(id)!))].sort((a, b) => a - b);
  // Absence is anchored to the entire checked interval; original client/bot/event positions remain intact.
  const [first, last] = result.checkedRange!.map((id) => positions.get(id)!);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/** Build the official file from immutable original AI outcomes, including every imported conversation. */
export async function buildSubmission(input: BuildSubmissionInput): Promise<SubmissionBuild> {
  const { dataset, groupId } = input;
  const spec = SUBMISSION_DATASETS[dataset];
  const conversations = input.state.conversations.filter((conversation) => conversation.dataset_group_id === groupId)
    .sort((a, b) => a.conversation_id < b.conversation_id ? -1 : a.conversation_id > b.conversation_id ? 1 : 0);
  const issues = sourceIssues(conversations, dataset);
  const warnings: SubmissionIssue[] = [];
  const internalIds = new Set<string>();
  for (const conversation of conversations) {
    if (!isText(conversation.id) || internalIds.has(conversation.id)) issues.push(issue('SOURCE_INTERNAL_ID_INVALID', 'Внутренние ID диалогов должны быть непустыми и уникальными.', conversation.conversation_id));
    internalIds.add(conversation.id);
    if (Array.isArray(conversation.transcript) && (conversation.transcript.some((message) => !message || !isText(message.id)) || new Set(conversation.transcript.map((message) => message?.id)).size !== conversation.transcript.length)) {
      issues.push(issue('SOURCE_MESSAGE_ID_INVALID', 'ID реплик исходного транскрипта должны быть непустыми и уникальными.', conversation.conversation_id));
    }
  }
  if (!groupId) issues.unshift(issue('GROUP_REQUIRED', 'Выберите загруженный набор для этого файла.'));
  else if (!conversations.length) issues.unshift(issue('GROUP_EMPTY', `В наборе «${groupId}» нет диалогов. Импортируйте выданный набор.`));
  const teamName = typeof input.teamName === 'string' ? input.teamName.trim() : '';
  if (!teamName) issues.push(issue('TEAM_NAME', 'Укажите название команды для team_name.'));
  const outcomes = conversations.map((conversation) => {
    const evaluations = input.state.evaluations.filter((evaluation) => evaluation.conversationId === conversation.id && evaluation.source === 'ai');
    const failures = (input.state.evaluationFailures || []).filter((failure) => failure.conversationId === conversation.id);
    for (const outcome of [...evaluations, ...failures]) if (!Number.isFinite(Date.parse(outcome.createdAt))) {
      issues.push(issue('RUN_DATE_INVALID', 'Нельзя определить последний запуск: неверная дата сохранённой попытки.', conversation.conversation_id));
    }
    const evaluation = latest(evaluations);
    const failure = latest(failures);
    return { conversation, evaluation: failure && (!evaluation || Date.parse(failure.createdAt) >= Date.parse(evaluation.createdAt)) ? undefined : evaluation, failure: failure && (!evaluation || Date.parse(failure.createdAt) >= Date.parse(evaluation.createdAt)) ? failure : undefined };
  });

  const models = new Set<string>();
  const modes = new Set<ModelMode>();
  let needsLegacyMode = false;
  let modelMetadataMissing = false;
  const attempted = outcomes.filter((outcome) => outcome.evaluation || outcome.failure);
  for (const { conversation, evaluation, failure } of attempted) {
    const outcome = (evaluation || failure)!;
    if (isText(outcome.model)) models.add(outcome.model.trim());
    else if (failure) {
      // A preparation failure can occur before a model is selected or called.
      // It remains an error row, but its missing model/mode must not contaminate other runs.
      warnings.push(issue('FAILURE_MODEL_UNAVAILABLE', 'В неуспешной попытке не указана модель. Диалог сохранён как ошибка; эта попытка не определяет model.name или model.mode файла.', conversation.conversation_id));
      continue;
    } else { modelMetadataMissing = true; issues.push(issue('RUN_MODEL_MISSING', 'В сохранённом AI-запуске отсутствует фактическое название модели.', conversation.conversation_id)); }
    const mode = evaluation ? evaluation.runConfig?.modelMode : failure?.modelMode;
    if (isMode(mode)) modes.add(mode);
    else if (mode === undefined) {
      needsLegacyMode = true;
      if (input.legacyModeConfirmed === true && isMode(input.legacyModelMode)) modes.add(input.legacyModelMode);
      else { modelMetadataMissing = true; issues.push(issue('LEGACY_MODEL_MODE', 'У раннего запуска не сохранён режим модели. Укажите и подтвердите фактический режим для этих запусков.', conversation.conversation_id)); }
    } else { modelMetadataMissing = true; issues.push(issue('RUN_MODEL_MODE_INVALID', 'У сохранённого AI-запуска недопустимый режим модели.', conversation.conversation_id)); }
  }
  if (!models.size && attempted.every((outcome) => !outcome.evaluation)) {
    if (input.unprocessedModel && isMode(input.unprocessedModel.mode) && isText(input.unprocessedModel.name)) {
      models.add(input.unprocessedModel.name.trim()); modes.add(input.unprocessedModel.mode);
      warnings.push(issue('DECLARED_MODEL', 'Название модели указано пользователем: в сохранённых попытках нет названия. В этом файле все диалоги имеют status=error.'));
    } else {
      modelMetadataMissing = true;
      issues.push(issue('MODEL_REQUIRED', 'Не удалось определить модель из сохранённых AI-попыток. Выполните оценку либо явно укажите модель для файла с ошибками обработки.'));
    }
  }
  if (needsLegacyMode && input.legacyModeConfirmed && isMode(input.legacyModelMode)) warnings.push(issue('LEGACY_MODE_CONFIRMED', 'Режим ранних запусков указан по подтверждению пользователя; исторические записи не изменены.'));

  const rowsAndResults = await Promise.all(outcomes.map(async ({ conversation, evaluation, failure }): Promise<{ row: SubmissionRow; result: SubmissionOkResult | SubmissionErrorResult }> => {
    const row: SubmissionRow = {
      id: conversation.id, conversationId: conversation.conversation_id, status: 'error', kind: 'unprocessed', needsReview: false, issues: [],
      ...(evaluation ? { evaluationId: evaluation.id } : {}), ...((evaluation || failure) ? { model: (evaluation || failure)!.model } : {}),
    };
    const reject = (reason: string, kind: SubmissionRow['kind']): { row: SubmissionRow; result: SubmissionErrorResult } => ({ row: { ...row, kind, error: reason }, result: errorResult(conversation, reason) });
    const outcome: Evaluation | EvaluationFailure | undefined = evaluation || failure;
    if (!outcome) {
      const hasManual = input.state.evaluations.some((item) => item.conversationId === conversation.id && item.source === 'manual');
      return reject(hasManual ? 'AI-оценка не выполнена. Ручная экспертная разметка не подменяет результат системы.' : 'AI-оценка не выполнена: для этого диалога нет сохранённой попытки.', 'unprocessed');
    }
    try {
      if (!outcome.transcriptHash || outcome.transcriptHash !== await transcriptHash(conversation)) row.issues.push(issue('TRANSCRIPT_MISMATCH', 'Сохранённая попытка относится к другому транскрипту. Оцените текущий исходный диалог заново.', conversation.conversation_id));
    } catch {
      row.issues.push(issue('TRANSCRIPT_HASH_UNAVAILABLE', 'Не удалось проверить отпечаток исходного транскрипта.', conversation.conversation_id));
    }
    if (failure) {
      if (!isText(failure.error)) row.issues.push(issue('FAILURE_REASON_MISSING', 'У неуспешной попытки отсутствует причина ошибки.', conversation.conversation_id));
      if (row.issues.length) return reject(row.issues.map((item) => item.message).join(' '), 'invalid');
      return reject(failure.error, 'failed');
    }
    const ai = evaluation!;
    row.issues.push(...checklistSubmissionIssues(ai.checklist).map((item) => ({ ...item, conversationId: conversation.conversation_id })));
    if (ai.checklist && Array.isArray(ai.checklist.criteria) && Array.isArray(conversation.transcript)) {
      row.issues.push(...validateResults(ai.checklist.criteria, ai.initialResults, conversation.transcript).map((message) => issue('AI_RESULT_INVALID', message, conversation.conversation_id)));
    }
    row.needsReview = Array.isArray(ai.initialResults) && ai.initialResults.some((result) => result?.needsReview === true);
    if (row.issues.length) return reject(row.issues.map((item) => item.message).join(' '), 'invalid');
    const computed = calculateScore(ai.checklist.criteria, ai.initialResults);
    if (!ai.initialScore || computed.total === null || computed.total !== ai.initialScore.total || computed.critical !== ai.initialScore.critical || computed.applicableWeight !== ai.initialScore.applicableWeight) {
      row.issues.push(issue('INITIAL_SCORE_MISMATCH', 'Исходный сохранённый балл не совпадает с расчётом по исходным AI-оценкам и официальным весам.', conversation.conversation_id));
      return reject(row.issues[0].message, 'invalid');
    }
    const resultsById = new Map(ai.initialResults.map((result) => [result.criterionId, result]));
    const criteria = SUBMISSION_CRITERIA.map((rule): SubmissionCriterion => {
      const result = resultsById.get(rule.internalId)!;
      return {
        criterion_id: rule.id,
        value: result.value === 'yes' ? true : result.value === 'no' ? false : result.value === 'na' ? null : result.value,
        rationale: result.explanation,
        evidence_turns: evidenceTurns(result, conversation),
      };
    });
    return {
      row: { ...row, status: 'ok', kind: 'ok' },
      result: { conversation_id: conversation.conversation_id, status: 'ok', criteria, score: { final_score: computed.total!, critical_flag: computed.critical } },
    };
  }));
  const rows = rowsAndResults.map((item) => item.row);
  issues.push(...rows.flatMap((row) => row.issues));
  const counts = {
    expected: spec.expected, total: conversations.length, ok: rows.filter((row) => row.status === 'ok').length,
    error: rows.filter((row) => row.status === 'error').length, unprocessed: rows.filter((row) => row.kind === 'unprocessed').length,
    needsReview: rows.filter((row) => row.needsReview).length,
    chats: conversations.filter((conversation) => conversation.channel === 'agent chat').length,
    calls: conversations.filter((conversation) => conversation.channel === 'voice call').length,
  };
  if (counts.unprocessed) warnings.push(issue('UNPROCESSED_DIALOGUES', `${counts.unprocessed} диалогов ещё не прошли AI-оценку. Их ID сохранены со status=error и явной причиной.`));
  if (counts.needsReview) warnings.push(issue('NEEDS_REVIEW', `${counts.needsReview} исходных AI-оценок помечены для проверки. Выгрузка сохраняет исходные значения до апелляций.`));
  if (outcomes.some(({ evaluation }) => evaluation && JSON.stringify(evaluation.initialResults) !== JSON.stringify(evaluation.results))) warnings.push(issue('ORIGINAL_AI_RESULTS', 'Для сдачи используются исходные AI-результаты. Исправления по апелляциям и ручная разметка в них не подмешиваются.'));
  const modelNames = [...models].sort();
  const modelMode: ModelMode | undefined = modes.size > 1 || modes.has('hybrid') ? 'hybrid' : [...modes][0];
  const document: SubmissionDocument | null = modelMetadataMissing || !modelMode || !modelNames.length ? null : {
    schema_version: '1.0', team_name: teamName, model: { mode: modelMode, name: modelNames.join(', ') }, results: rowsAndResults.map((item) => item.result),
  };
  if (document) {
    const validation = validateSubmission(document, { dataset, conversations });
    issues.push(...validation.issues); warnings.push(...validation.warnings);
  } else if (counts.error) warnings.push(issue('PROCESSING_ERRORS', `В файле ${counts.error} записей status=error. Они сохраняют ID и причину, но не являются успешными оценками.`));
  const uniqueIssues = distinctIssues(issues);
  return {
    document, json: document ? JSON.stringify(document, null, 2) + '\n' : '', filePath: spec.path,
    canExport: document !== null && uniqueIssues.length === 0, issues: uniqueIssues, warnings: distinctIssues(warnings),
    rows, counts, models: modelNames, needsLegacyMode,
  };
}
