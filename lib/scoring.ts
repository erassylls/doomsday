import type { Criterion, CriterionResult, Message, Rating, ScoreItem, ScoreReport } from './types';
import { validateChecklist } from './rubric';

export function isAllowedRating(criterion: Criterion, value: unknown): value is Rating {
  if (value === 'na') return criterion.allowNA;
  if (criterion.kind === 'boolean' || criterion.kind === 'flag') return value === 'yes' || value === 'no';
  return typeof value === 'number' && Number.isFinite(value) && criterion.levels.some((level) => level.value === value);
}

function validateRatingSet(criteria: Criterion[], results: unknown): string[] {
  if (!Array.isArray(results)) return ['Результаты должны быть массивом.'];
  const errors: string[] = [];
  const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const seen = new Set<string>();
  results.forEach((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push('Неверный формат результата критерия.'); return; }
    const item = raw as CriterionResult;
    const criterion = byId.get(item.criterionId);
    if (!criterion) { errors.push(`Неизвестный ID критерия: ${String(item.criterionId).slice(0, 100)}.`); return; }
    if (seen.has(item.criterionId)) errors.push(`Результат ${item.criterionId} повторяется.`);
    seen.add(item.criterionId);
    if (!isAllowedRating(criterion, item.value)) {
      errors.push(`${criterion.id}: оценка не входит в разрешённые значения критерия${item.value === 'na' ? ' (N/A запрещён)' : ''}.`);
    }
  });
  for (const criterion of criteria) if (!seen.has(criterion.id)) errors.push(`Отсутствует результат ${criterion.id}.`);
  return errors;
}

/** Validate evidence against the actual immutable transcript before an AI/manual save. */
export function validateResults(criteria: Criterion[], results: unknown, messages: Message[]): string[] {
  const errors = [...validateChecklist(criteria), ...validateRatingSet(criteria, results)];
  if (!Array.isArray(results)) return errors;
  const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const positions = new Map(messages.map((message, index) => [message.id, index]));
  if (positions.size !== messages.length) errors.push('В транскрипте повторяются ID сообщений.');
  for (const raw of results) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as CriterionResult;
    const criterion = byId.get(item.criterionId);
    if (!criterion) continue;
    const prefix = `${criterion.id}`;
    if (typeof item.explanation !== 'string' || !item.explanation.trim() || item.explanation.length > 12000) {
      errors.push(`${prefix}: требуется непустое обоснование до 12 000 символов.`);
    }
    if (typeof item.needsReview !== 'boolean') errors.push(`${prefix}: поле needsReview должно быть логическим.`);
    const evidenceValid = Array.isArray(item.evidence) && item.evidence.every((id) => typeof id === 'string' && positions.has(id));
    if (!evidenceValid) errors.push(`${prefix}: ссылки должны содержать только существующие ID сообщений.`);
    if (Array.isArray(item.evidence) && new Set(item.evidence).size !== item.evidence.length) errors.push(`${prefix}: повторяющиеся ссылки на сообщения.`);
    let rangeValid = false;
    if (item.checkedRange !== null) {
      rangeValid = Array.isArray(item.checkedRange) && item.checkedRange.length === 2
        && item.checkedRange.every((id) => typeof id === 'string' && positions.has(id))
        && positions.get(item.checkedRange[0])! <= positions.get(item.checkedRange[1])!;
      if (!rangeValid) errors.push(`${prefix}: checkedRange должен содержать два существующих ID в порядке транскрипта либо null.`);
    }
    const hasEvidence = evidenceValid && item.evidence.length > 0;
    if (!hasEvidence && !rangeValid) errors.push(`${prefix}: укажите подтверждающие сообщения или проверенный диапазон.`);
    // A missing action has no positive citation: the checked interval supplies its source.
    // Incorrect actions may instead be demonstrated by a concrete utterance.
    // A positive observation must be backed by a concrete source, not only an absence scan.
    if (item.value === 'yes' && !hasEvidence) errors.push(`${prefix}: для «Да» нужна ссылка на конкретное сообщение.`);
  }
  return [...new Set(errors)];
}

/** Deterministic organizer formula. N/A renormalizes weights; critical flags never change the score. */
export function calculateScore(criteria: Criterion[], results: CriterionResult[]): ScoreReport {
  const errors = [...validateChecklist(criteria), ...validateRatingSet(criteria, results)];
  if (errors.length) throw new Error(`Оценка не рассчитана: ${errors.slice(0, 5).join(' ')}`);
  const byId = new Map(results.map((result) => [result.criterionId, result]));
  const applicableWeight = criteria.reduce((sum, criterion) => {
    const result = byId.get(criterion.id)!;
    return sum + (criterion.kind !== 'flag' && result.value !== 'na' ? criterion.weight : 0);
  }, 0);
  const items: ScoreItem[] = criteria.map((criterion) => {
    const raw = byId.get(criterion.id)!.value;
    const applicable = raw !== 'na';
    const effectiveWeight = applicable && criterion.kind !== 'flag' && applicableWeight > 0
      ? 100 * criterion.weight / applicableWeight : 0;
    const fraction = criterion.kind === 'scale' && typeof raw === 'number'
      ? raw / Math.max(...criterion.levels.map((level) => level.value)) : raw === 'yes' ? 1 : 0;
    return { criterionId: criterion.id, applicable, raw, weight: criterion.weight, effectiveWeight, points: effectiveWeight * fraction };
  });
  const sectionMap = new Map<string, { name: string; score: number; possible: number }>();
  criteria.forEach((criterion, index) => {
    if (criterion.kind === 'flag' || criterion.weight === 0) return;
    const section = sectionMap.get(criterion.section) ?? { name: criterion.section, score: 0, possible: 0 };
    section.score += items[index].points;
    section.possible += items[index].effectiveWeight;
    sectionMap.set(criterion.section, section);
  });
  const rawTotal = items.reduce((sum, item) => sum + item.points, 0);
  return {
    total: applicableWeight > 0 ? Math.round((rawTotal + Number.EPSILON) * 100) / 100 : null,
    applicableWeight,
    critical: criteria.some((criterion) => criterion.kind === 'flag' && byId.get(criterion.id)!.value === 'yes'),
    items,
    sections: [...sectionMap.values()],
  };
}
