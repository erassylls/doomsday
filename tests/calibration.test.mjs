import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DEFAULT_CHECKLIST } = require('../.sites-runtime/test-build/rubric.js');
const { calculateScore } = require('../.sites-runtime/test-build/scoring.js');
const { buildCalibrationReport } = require('../.sites-runtime/test-build/calibration.js');

function evaluation({
  id, source, conversationId = 'TEST:one', checklist = DEFAULT_CHECKLIST,
  hash = 'synthetic-transcript-hash', model = 'model-a', createdAt = '2026-11-07T10:00:00Z',
  initial = {}, final = {},
}) {
  const criteria = structuredClone(checklist.criteria);
  const initialResults = criteria.map((criterion) => ({
    criterionId: criterion.id,
    value: initial[criterion.id] ?? (criterion.kind === 'flag' ? 'no' : criterion.kind === 'scale' ? Math.max(...criterion.levels.map((level) => level.value)) : 'yes'),
    explanation: 'Синтетическая разметка для тестирования сравнения.',
    evidence: ['m1'], checkedRange: null, needsReview: false,
  }));
  const results = initialResults.map((result) => ({ ...structuredClone(result), value: final[result.criterionId] ?? result.value }));
  return {
    id, conversationId, checklist: { ...structuredClone(checklist), criteria },
    initialResults, results,
    initialScore: calculateScore(criteria, initialResults), score: calculateScore(criteria, results),
    source, model: source === 'manual' ? 'Эксперт' : model,
    createdAt, updatedAt: createdAt, durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: null }, warnings: [], transcriptHash: hash,
  };
}

test('no explicit references means zero pairs and null accuracy/MAE despite available manual assessments', () => {
  const ai = evaluation({ id: 'ai', source: 'ai' });
  const expert = evaluation({ id: 'expert', source: 'manual' });
  const report = buildCalibrationReport([ai, expert]);
  assert.equal(report.selectedReferenceCount, 0);
  assert.equal(report.pairCount, 0);
  assert.equal(report.totalComparable, 0);
  assert.equal(report.agreementPercent, null);
  assert.equal(report.totalMae, null);
  assert.deepEqual(report.unmatched, []);
  const missing = buildCalibrationReport([ai, expert], { referenceIds: ['unknown', 'ai'] });
  assert.equal(missing.pairCount, 0);
  assert.equal(missing.agreementPercent, null);
  assert.deepEqual(missing.unmatched.map((item) => item.reason), ['reference_not_found', 'reference_not_manual']);
});

test('comparison uses original AI values before appeal and final selected expert values without mutation', () => {
  const ai = evaluation({ id: 'ai', source: 'ai', initial: { c1: 'no' }, final: { c1: 'yes' } });
  const expert = evaluation({ id: 'expert', source: 'manual', initial: { c1: 'no' }, final: { c1: 'yes' } });
  const inputs = [ai, expert];
  const before = JSON.stringify(inputs);
  const report = buildCalibrationReport(inputs, { referenceIds: ['expert'] });
  assert.equal(report.pairCount, 1);
  assert.equal(report.totalComparable, 8);
  assert.equal(report.exactMatches, 7);
  assert.equal(report.agreementPercent, 87.5);
  assert.equal(report.totalMae, 10);
  assert.equal(report.pairs[0].aiScore, 90);
  assert.equal(report.pairs[0].referenceScore, 100);
  assert.deepEqual(report.differences.map((item) => [item.criterionId, item.aiValue, item.referenceValue]), [['c1', 'no', 'yes']]);
  assert.equal(JSON.stringify(inputs), before);
});

test('only one latest compatible AI run is counted and an exact model filter is respected', () => {
  const expert = evaluation({ id: 'expert', source: 'manual' });
  const old = evaluation({ id: 'old-a', source: 'ai', createdAt: '2026-11-07T09:00:00Z' });
  const latestA = evaluation({ id: 'latest-a', source: 'ai', createdAt: '2026-11-07T10:00:00Z', initial: { c1: 'no' } });
  const latestB = evaluation({ id: 'latest-b', source: 'ai', model: 'model-b', createdAt: '2026-11-07T11:00:00Z' });
  const values = [latestA, expert, latestB, old];
  const report = buildCalibrationReport(values, { referenceIds: ['expert'], model: 'model-a' });
  assert.equal(report.pairCount, 1);
  assert.equal(report.totalComparable, 8);
  assert.equal(report.pairs[0].aiId, 'latest-a');
  assert.equal(report.totalMae, 10);
  const anyModel = buildCalibrationReport(values, { referenceIds: ['expert'] });
  assert.equal(anyModel.pairs[0].aiId, 'latest-b');
  const unavailable = buildCalibrationReport(values, { referenceIds: ['expert'], model: 'not-used-model' });
  assert.equal(unavailable.pairCount, 0);
  assert.equal(unavailable.totalMae, null);
  assert.equal(unavailable.unmatched[0].reason, 'no_ai_for_model');
});

test('N/A is a distinct value and critical flag differences are visible even when total scores agree', () => {
  const ai = evaluation({ id: 'ai', source: 'ai', initial: { c2: 'na' } });
  const expert = evaluation({ id: 'expert', source: 'manual', initial: { c8: 'yes' } });
  const report = buildCalibrationReport([ai, expert], { referenceIds: ['expert'] });
  assert.equal(report.exactMatches, 6);
  assert.equal(report.totalComparable, 8);
  assert.equal(report.naMismatches, 1);
  assert.equal(report.criticalFlagMismatches, 1);
  assert.equal(report.totalMae, 0);
  assert.equal(report.differences.length, 2);
  assert.equal(report.breakdown.find((item) => item.criterionId === 'c2').naMismatches, 1);
  assert.equal(report.breakdown.find((item) => item.criterionId === 'c8').criticalFlagMismatches, 1);
  assert.equal(report.breakdown.find((item) => item.criterionId === 'c8').agreementPercent, 0);
});

test('different checklist IDs, transcript hashes and full criterion snapshots are never paired', () => {
  const expert = evaluation({ id: 'expert', source: 'manual' });
  for (const [reason, mutate] of [
    ['checklist_mismatch', (ai) => { ai.checklist.id = 'another-version'; }],
    ['transcript_mismatch', (ai) => { ai.transcriptHash = 'different-transcript'; }],
    ['criteria_mismatch', (ai) => { ai.checklist.criteria[0].description += ' Другое правило.'; }],
  ]) {
    const ai = evaluation({ id: 'ai', source: 'ai' });
    mutate(ai);
    const report = buildCalibrationReport([ai, expert], { referenceIds: ['expert'] });
    assert.equal(report.pairCount, 0, reason);
    assert.equal(report.agreementPercent, null, reason);
    assert.equal(report.unmatched[0].reason, reason);
  }
});

test('two selected manual references for one context are both skipped, while repeated identical selection is deduplicated', () => {
  const ai = evaluation({ id: 'ai', source: 'ai' });
  const one = evaluation({ id: 'expert-one', source: 'manual' });
  const two = evaluation({ id: 'expert-two', source: 'manual', initial: { c1: 'no' } });
  const report = buildCalibrationReport([ai, one, two], { referenceIds: ['expert-one', 'expert-two'] });
  assert.equal(report.selectedReferenceCount, 2);
  assert.equal(report.pairCount, 0);
  assert.equal(report.totalComparable, 0);
  assert.equal(report.totalMae, null);
  assert.deepEqual(report.unmatched.map((item) => item.reason), ['duplicate_reference', 'duplicate_reference']);
  const duplicateId = buildCalibrationReport([ai, one], { referenceIds: ['expert-one', 'expert-one'] });
  assert.equal(duplicateId.selectedReferenceCount, 1);
  assert.equal(duplicateId.pairCount, 1);
});

test('null score totals remain comparable by criteria but are excluded from the MAE denominator', () => {
  const nullableChecklist = {
    ...structuredClone(DEFAULT_CHECKLIST), id: 'nullable', version: 2,
    criteria: [structuredClone(DEFAULT_CHECKLIST.criteria[1]), structuredClone(DEFAULT_CHECKLIST.criteria[7])],
  };
  const aiNull = evaluation({ id: 'ai-null', source: 'ai', checklist: nullableChecklist, initial: { c2: 'na' } });
  const referenceNull = evaluation({ id: 'reference-null', source: 'manual', checklist: nullableChecklist, initial: { c2: 'na' } });
  const onlyNull = buildCalibrationReport([aiNull, referenceNull], { referenceIds: ['reference-null'] });
  assert.equal(onlyNull.pairCount, 1);
  assert.equal(onlyNull.totalComparable, 2);
  assert.equal(onlyNull.totalScorePairs, 0);
  assert.equal(onlyNull.totalMae, null);
  const aiNumeric = evaluation({ id: 'ai-numeric', source: 'ai', conversationId: 'TEST:two', initial: { c1: 'no' } });
  const referenceNumeric = evaluation({ id: 'reference-numeric', source: 'manual', conversationId: 'TEST:two' });
  const mixed = buildCalibrationReport([aiNull, referenceNull, aiNumeric, referenceNumeric], { referenceIds: ['reference-null', 'reference-numeric'] });
  assert.equal(mixed.pairCount, 2);
  assert.equal(mixed.totalComparable, 10);
  assert.equal(mixed.totalScorePairs, 1);
  assert.equal(mixed.totalMae, 10);
});

test('snapshot comparison ignores object property insertion order without discarding rule fields', () => {
  const ai = evaluation({ id: 'ai', source: 'ai' });
  const expert = evaluation({ id: 'expert', source: 'manual' });
  ai.checklist.criteria = ai.checklist.criteria.map((criterion) => Object.fromEntries(Object.entries(criterion).reverse()));
  const report = buildCalibrationReport([ai, expert], { referenceIds: ['expert'] });
  assert.equal(report.pairCount, 1);
  assert.equal(report.agreementPercent, 100);
  ai.checklist.criteria[1].naCondition += ' Дополнительное условие.';
  const changed = buildCalibrationReport([ai, expert], { referenceIds: ['expert'] });
  assert.equal(changed.pairCount, 0);
  assert.equal(changed.unmatched[0].reason, 'criteria_mismatch');
});

test('incomplete latest AI and inconsistent reference totals are skipped rather than hidden by older successful runs', () => {
  const expert = evaluation({ id: 'expert', source: 'manual' });
  const old = evaluation({ id: 'old', source: 'ai', createdAt: '2026-11-07T09:00:00Z' });
  const latest = evaluation({ id: 'latest', source: 'ai', createdAt: '2026-11-07T10:00:00Z' });
  latest.initialResults.pop();
  const report = buildCalibrationReport([old, latest, expert], { referenceIds: ['expert'] });
  assert.equal(report.pairCount, 0);
  assert.equal(report.unmatched[0].reason, 'invalid_ai');
  expert.score.total = 42;
  const invalidReference = buildCalibrationReport([old, expert], { referenceIds: ['expert'] });
  assert.equal(invalidReference.pairCount, 0);
  assert.equal(invalidReference.unmatched[0].reason, 'invalid_reference');
});
