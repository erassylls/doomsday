import { calculateScore } from './scoring';
import { validateChecklist } from './rubric';
import type { Criterion, CriterionResult, Evaluation, Rating, ScoreReport } from './types';

export interface CalibrationOptions {
  /** Explicitly selected independent manual assessments. No automatic references. */
  referenceIds?: readonly string[];
  /** Exact model identifier; omit to select the latest compatible AI of any model. */
  model?: string;
  /** Exact saved checklist ID, not only its display version number. */
  checklistId?: string;
}

export interface CalibrationBreakdown {
  key: string;
  checklistId: string;
  checklistVersion: number;
  checklistName: string;
  criterionId: string;
  name: string;
  kind: Criterion['kind'];
  exactMatches: number;
  totalComparable: number;
  agreementPercent: number | null;
  naMismatches: number;
  /** Number of differing decisions for criteria whose kind is flag. */
  criticalFlagMismatches: number;
}

export interface CalibrationDifference {
  referenceId: string;
  aiId: string;
  conversationId: string;
  checklistId: string;
  checklistVersion: number;
  criterionId: string;
  name: string;
  kind: Criterion['kind'];
  aiValue: Rating;
  referenceValue: Rating;
  naMismatch: boolean;
  criticalFlagMismatch: boolean;
}

export interface CalibrationPair {
  referenceId: string;
  aiId: string;
  conversationId: string;
  checklistId: string;
  checklistVersion: number;
  checklistName: string;
  model: string;
  aiCreatedAt: string;
  referenceCreatedAt: string;
  referenceScore: number | null;
  aiScore: number | null;
  absoluteError: number | null;
  exactMatches: number;
  totalComparable: number;
  agreementPercent: number | null;
  naMismatches: number;
  criticalFlagMismatches: number;
}

export type CalibrationSkipReason =
  | 'reference_not_found'
  | 'ambiguous_reference_id'
  | 'reference_not_manual'
  | 'reference_filtered'
  | 'invalid_reference'
  | 'duplicate_reference'
  | 'no_ai'
  | 'no_ai_for_model'
  | 'checklist_mismatch'
  | 'transcript_mismatch'
  | 'criteria_mismatch'
  | 'invalid_ai';

export interface CalibrationUnmatched {
  referenceId: string;
  conversationId?: string;
  reason: CalibrationSkipReason;
  message: string;
}

export interface CalibrationReport {
  selectedReferenceCount: number;
  pairCount: number;
  exactMatches: number;
  totalComparable: number;
  /** Null means no criterion comparisons, never a fabricated 100%. */
  agreementPercent: number | null;
  /** Mean absolute total-score error, using only pairs with two numeric totals. */
  totalMae: number | null;
  totalScorePairs: number;
  naMismatches: number;
  criticalFlagMismatches: number;
  breakdown: CalibrationBreakdown[];
  differences: CalibrationDifference[];
  pairs: CalibrationPair[];
  unmatched: CalibrationUnmatched[];
}

/** Object key insertion order is irrelevant; array order and every field remain significant. */
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
  }
  throw new Error('The snapshot must contain only finite JSON values.');
}

function snapshot(evaluation: Evaluation): string | null {
  if (!evaluation || typeof evaluation.conversationId !== 'string' || !evaluation.conversationId
    || typeof evaluation.transcriptHash !== 'string' || !evaluation.transcriptHash
    || typeof evaluation.checklist?.id !== 'string' || !evaluation.checklist.id
    || validateChecklist(evaluation.checklist.criteria).length) return null;
  try { return canonical(evaluation.checklist.criteria); } catch { return null; }
}

function referenceGroup(evaluation: Evaluation): string {
  return JSON.stringify([evaluation.conversationId, evaluation.checklist.id, evaluation.transcriptHash]);
}

/** Fail closed on missing/duplicate/forbidden ratings or a stored score inconsistent with its ratings. */
function usableAssessment(criteria: Criterion[], results: CriterionResult[], score: ScoreReport): boolean {
  if (!score || (score.total !== null && (typeof score.total !== 'number' || !Number.isFinite(score.total)))) return false;
  try {
    const calculated = calculateScore(criteria, results);
    return calculated.total === score.total && calculated.critical === score.critical;
  } catch { return false; }
}

function percent(matches: number, compared: number): number | null {
  return compared > 0 ? 100 * matches / compared : null;
}

/**
 * Local descriptive comparison against explicitly selected working references.
 * This does not certify the references as organizer Ground Truth or prove independence.
 * Each reference context uses one latest compatible AI run. AI corrections from appeals
 * cannot improve these metrics: only initialResults and initialScore are compared.
 */
export function buildCalibrationReport(evaluations: Evaluation[], options: CalibrationOptions = {}): CalibrationReport {
  const referenceIds = [...new Set(options.referenceIds || [])];
  const report: CalibrationReport = {
    selectedReferenceCount: referenceIds.length, pairCount: 0,
    exactMatches: 0, totalComparable: 0, agreementPercent: null,
    totalMae: null, totalScorePairs: 0, naMismatches: 0, criticalFlagMismatches: 0,
    breakdown: [], differences: [], pairs: [], unmatched: [],
  };
  if (!referenceIds.length) return report;
  const byId = new Map<string, Evaluation[]>();
  for (const evaluation of evaluations) {
    if (!evaluation || typeof evaluation.id !== 'string') continue;
    const values = byId.get(evaluation.id) || [];
    values.push(evaluation);
    byId.set(evaluation.id, values);
  }
  const selected: { evaluation: Evaluation; snapshot: string }[] = [];
  const model = options.model?.trim() || undefined;
  const checklistFilter = options.checklistId || undefined;
  const skip = (referenceId: string, reason: CalibrationSkipReason, message: string, conversationId?: string) => {
    report.unmatched.push({ referenceId, reason, message, ...(conversationId ? { conversationId } : {}) });
  };
  for (const id of referenceIds) {
    const candidates = byId.get(id);
    if (!candidates?.length) { skip(id, 'reference_not_found', 'Выбранная экспертная оценка больше не доступна.'); continue; }
    if (candidates.length !== 1) { skip(id, 'ambiguous_reference_id', 'Один ID соответствует нескольким записям. Сначала устраните дубликаты.'); continue; }
    const reference = candidates[0];
    if (reference.source !== 'manual') {
      skip(id, 'reference_not_manual', 'Рабочим эталоном может быть только явно выбранная ручная оценка.', reference.conversationId);
      continue;
    }
    if (checklistFilter && reference.checklist?.id !== checklistFilter) {
      skip(id, 'reference_filtered', 'Экспертная оценка относится к другой выбранной версии чек-листа.', reference.conversationId);
      continue;
    }
    const signature = snapshot(reference);
    if (signature === null) {
      skip(id, 'invalid_reference', 'Экспертная оценка не содержит корректную версию правил или хеш транскрипта.', reference.conversationId);
      continue;
    }
    selected.push({ evaluation: reference, snapshot: signature });
  }
  const groupCounts = new Map<string, number>();
  for (const { evaluation } of selected) {
    const group = referenceGroup(evaluation);
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
  }
  const breakdowns = new Map<string, CalibrationBreakdown>();
  let absoluteErrorSum = 0;
  for (const { evaluation: reference, snapshot: referenceSnapshot } of selected) {
    const id = reference.id;
    const conversationId = reference.conversationId;
    if ((groupCounts.get(referenceGroup(reference)) || 0) > 1) {
      skip(id, 'duplicate_reference', 'Для одного диалога, чек-листа и транскрипта выбрано несколько экспертных оценок. Оставьте одну.', conversationId);
      continue;
    }
    if (!usableAssessment(reference.checklist.criteria, reference.results, reference.score)) {
      skip(id, 'invalid_reference', 'В экспертной оценке отсутствуют допустимые ответы по всем критериям или итог не соответствует ответам.', conversationId);
      continue;
    }
    const allAi = evaluations.filter((evaluation) => evaluation?.source === 'ai' && evaluation.conversationId === conversationId);
    const modelAi = model ? allAi.filter((evaluation) => evaluation.model === model) : allAi;
    if (!modelAi.length) {
      skip(id, model && allAi.length ? 'no_ai_for_model' : 'no_ai', model
        ? 'Нет AI-оценки этого диалога для выбранной модели и фильтров.'
        : 'Нет AI-оценки этого диалога для выбранных фильтров.', conversationId);
      continue;
    }
    const versionAi = modelAi.filter((evaluation) => evaluation.checklist?.id === reference.checklist.id);
    if (!versionAi.length) {
      skip(id, 'checklist_mismatch', 'AI и эксперт использовали разные сохранённые версии чек-листа.', conversationId);
      continue;
    }
    const transcriptAi = versionAi.filter((evaluation) => evaluation.transcriptHash === reference.transcriptHash);
    if (!transcriptAi.length) {
      skip(id, 'transcript_mismatch', 'Хеш транскрипта AI не совпадает с экспертной оценкой.', conversationId);
      continue;
    }
    const compatible = transcriptAi.filter((evaluation) => snapshot(evaluation) === referenceSnapshot);
    if (!compatible.length) {
      skip(id, 'criteria_mismatch', 'Снимки критериев различаются: совпадения ID чек-листа недостаточно.', conversationId);
      continue;
    }
    if (compatible.some((evaluation) => !Number.isFinite(Date.parse(evaluation.createdAt)))) {
      skip(id, 'invalid_ai', 'Некорректная дата AI-запуска не позволяет определить последний совместимый результат.', conversationId);
      continue;
    }
    const ai = [...compatible].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))[0];
    if (!usableAssessment(ai.checklist.criteria, ai.initialResults, ai.initialScore)) {
      skip(id, 'invalid_ai', 'Исходная AI-оценка неполна, содержит недопустимые ответы или несогласованный итог.', conversationId);
      continue;
    }
    const aiValues = new Map(ai.initialResults.map((result) => [result.criterionId, result.value]));
    const referenceValues = new Map(reference.results.map((result) => [result.criterionId, result.value]));
    const absoluteError = ai.initialScore.total === null || reference.score.total === null
      ? null : Math.abs(ai.initialScore.total - reference.score.total);
    const pair: CalibrationPair = {
      referenceId: id, aiId: ai.id, conversationId, checklistId: reference.checklist.id,
      checklistVersion: reference.checklist.version, checklistName: reference.checklist.name,
      model: ai.model, aiCreatedAt: ai.createdAt, referenceCreatedAt: reference.createdAt,
      referenceScore: reference.score.total, aiScore: ai.initialScore.total, absoluteError,
      exactMatches: 0, totalComparable: reference.checklist.criteria.length, agreementPercent: null,
      naMismatches: 0, criticalFlagMismatches: 0,
    };
    for (const criterion of reference.checklist.criteria) {
      const aiValue = aiValues.get(criterion.id)!;
      const referenceValue = referenceValues.get(criterion.id)!;
      const exact = aiValue === referenceValue;
      const naMismatch = (aiValue === 'na') !== (referenceValue === 'na');
      const criticalFlagMismatch = criterion.kind === 'flag' && !exact;
      const breakdownKey = canonical([reference.checklist.id, referenceSnapshot, criterion.id]);
      let breakdown = breakdowns.get(breakdownKey);
      if (!breakdown) {
        breakdown = {
          key: `criterion-${breakdowns.size + 1}`, checklistId: reference.checklist.id,
          checklistVersion: reference.checklist.version, checklistName: reference.checklist.name,
          criterionId: criterion.id, name: criterion.name, kind: criterion.kind,
          exactMatches: 0, totalComparable: 0, agreementPercent: null, naMismatches: 0, criticalFlagMismatches: 0,
        };
        breakdowns.set(breakdownKey, breakdown);
      }
      breakdown.totalComparable += 1;
      if (exact) { pair.exactMatches += 1; breakdown.exactMatches += 1; }
      if (naMismatch) { pair.naMismatches += 1; breakdown.naMismatches += 1; }
      if (criticalFlagMismatch) { pair.criticalFlagMismatches += 1; breakdown.criticalFlagMismatches += 1; }
      if (!exact) {
        report.differences.push({
          referenceId: id, aiId: ai.id, conversationId, checklistId: reference.checklist.id,
          checklistVersion: reference.checklist.version, criterionId: criterion.id, name: criterion.name, kind: criterion.kind,
          aiValue, referenceValue, naMismatch, criticalFlagMismatch,
        });
      }
    }
    pair.agreementPercent = percent(pair.exactMatches, pair.totalComparable);
    report.pairs.push(pair);
    report.exactMatches += pair.exactMatches;
    report.totalComparable += pair.totalComparable;
    report.naMismatches += pair.naMismatches;
    report.criticalFlagMismatches += pair.criticalFlagMismatches;
    if (absoluteError !== null) { absoluteErrorSum += absoluteError; report.totalScorePairs += 1; }
  }
  report.pairCount = report.pairs.length;
  report.agreementPercent = percent(report.exactMatches, report.totalComparable);
  report.totalMae = report.totalScorePairs > 0 ? absoluteErrorSum / report.totalScorePairs : null;
  report.breakdown = [...breakdowns.values()].map((item) => ({ ...item, agreementPercent: percent(item.exactMatches, item.totalComparable) }));
  return report;
}
