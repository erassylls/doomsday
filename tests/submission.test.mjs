import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DEFAULT_CHECKLIST } = require('../.sites-runtime/test-build/rubric.js');
const { calculateScore } = require('../.sites-runtime/test-build/scoring.js');
const { buildSubmission, validateSubmission, checklistSubmissionIssues } = require('../.sites-runtime/test-build/submission.js');

// Entirely synthetic test fixtures. The values and 85.38 expected result are the PDF's structure example.
const transcript = [
  { id: 'client-early', speaker: 'client', text: 'Как изменить тему интерфейса?', timestamp: '00:00' },
  { id: 'bot-before', speaker: 'bot', text: 'Соединяю с оператором.', timestamp: '00:01' },
  { id: 'event-before', speaker: 'system', text: 'Оператор подключён.', timestamp: '00:02' },
  { id: 'operator-start', speaker: 'operator', text: 'Здравствуйте, меня зовут Анна.', timestamp: '00:03' },
  { id: 'operator-answer', speaker: 'operator', text: 'Откройте настройки оформления.', timestamp: '00:04' },
  { id: 'client-followup', speaker: 'client', text: 'Спасибо, получилось.', timestamp: '00:05' },
  { id: 'event-between', speaker: 'system', text: 'Статус обращения обновлён.', timestamp: '00:06' },
  { id: 'operator-close', speaker: 'operator', text: 'Могу помочь ещё? До свидания!', timestamp: '00:07' },
];
const hash = (messages) => createHash('sha256').update(JSON.stringify(messages)).digest('hex');
const ratings = [
  ['c1', 'yes', [4]], ['c2', 'na', [1]], ['c3', 'na', [1]], ['c4', 15, [5, 6]],
  ['c5', 'yes', [4, 5]], ['c6', 7, [5, 6]], ['c7', 'yes', [8]], ['c8', 'no', [4, 5, 6, 8]],
];
function makeEvaluation(conversation, overrides = {}) {
  const results = ratings.map(([criterionId, value, turns]) => ({
    criterionId, value, explanation: `Вымышленное обоснование ${criterionId}.`,
    evidence: turns.map((turn) => conversation.transcript[turn - 1].id), checkedRange: null, needsReview: false,
  }));
  const score = calculateScore(DEFAULT_CHECKLIST.criteria, results);
  return {
    id: `ai-${conversation.id}`, conversationId: conversation.id, checklist: structuredClone(DEFAULT_CHECKLIST),
    initialResults: structuredClone(results), results: structuredClone(results), initialScore: structuredClone(score), score,
    source: 'ai', model: 'synthetic-model-a', createdAt: '2026-11-07T10:00:00.000Z', updatedAt: '2026-11-07T10:00:00.000Z',
    usage: { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: null }, durationMs: 0, warnings: [],
    transcriptHash: hash(conversation.transcript),
    runConfig: { promptRevision: 'fixture', strictJson: true, verification: false, knowledgeHash: '', modelMode: 'external_api' },
    ...overrides,
  };
}
function fixture(dataset = 'prod') {
  const conversations = Array.from({ length: dataset === 'prod' ? 10 : 65 }, (_, index) => {
    const originalId = `original-${String(index + 1).padStart(3, '0')}`;
    return {
      id: `${dataset.toUpperCase()}-SYNTHETIC:${originalId}`, conversation_id: originalId, dataset_group_id: `${dataset.toUpperCase()}-SYNTHETIC`,
      channel: dataset === 'dev' && index >= 60 ? 'voice call' : 'agent chat', language: 'RU',
      transcript: structuredClone(transcript), audio_url: null, importedAt: '2026-11-07T09:00:00.000Z',
    };
  });
  return { conversations, evaluations: conversations.map((conversation) => makeEvaluation(conversation)), evaluationFailures: [] };
}
function input(state = fixture(), dataset = 'prod', extra = {}) {
  return { state, dataset, groupId: `${dataset.toUpperCase()}-SYNTHETIC`, teamName: 'Команда QA · тексеру', ...extra };
}
function makeFailure(conversation, overrides = {}) {
  return {
    id: `failure-${conversation.id}`, conversationId: conversation.id, checklistId: DEFAULT_CHECKLIST.id,
    model: 'synthetic-model-a', modelMode: 'external_api', error: 'Не удалось получить ответ модели.', code: 'AI_TIMEOUT',
    createdAt: '2026-11-07T11:00:00.000Z', transcriptHash: hash(conversation.transcript), ...overrides,
  };
}
const codes = (result) => result.issues.map((item) => item.code);

test('official JSON 1.0 preserves the original IDs, raw values, full turn positions and the PDF score of 85.38', async () => {
  const state = fixture();
  state.conversations[0].conversation_id = ' Original/Қазақша-001 ';
  const built = await buildSubmission(input(state));
  assert.equal(built.canExport, true);
  assert.deepEqual(built.issues, []);
  assert.equal(built.filePath, 'results/prod/results.json');
  assert.deepEqual(Object.keys(built.document), ['schema_version', 'team_name', 'model', 'results']);
  assert.equal(built.document.schema_version, '1.0');
  assert.equal(built.document.team_name, 'Команда QA · тексеру');
  assert.deepEqual(built.document.model, { mode: 'external_api', name: 'synthetic-model-a' });
  const row = built.document.results[0];
  assert.equal(row.conversation_id, ' Original/Қазақша-001 ');
  assert.deepEqual(row.criteria.map(({ criterion_id, value }) => [criterion_id, value]), [
    ['contact', true], ['discovery', null], ['identification', null], ['consultation', 15],
    ['empathy', true], ['dialogue', 7], ['closure', true], ['critical', false],
  ]);
  assert.deepEqual(row.criteria[0].evidence_turns, [4]); // A bot and event precede the operator.
  assert.deepEqual(row.criteria[7].evidence_turns, [4, 5, 6, 8]);
  assert.deepEqual(row.score, { final_score: 85.38, critical_flag: false });
  assert.equal(built.counts.ok, 10);
  assert.equal(built.counts.error, 0);
  assert.deepEqual(JSON.parse(built.json), built.document);
  assert.equal(Buffer.from(built.json, 'utf8').toString('utf8'), built.json);
  assert.deepEqual(validateSubmission(built.document, { dataset: 'prod', conversations: state.conversations }), { valid: true, issues: [], warnings: [] });
});

test('absence evidence expands a checked interval without dropping clients, bots or system events', async () => {
  const state = fixture();
  const result = state.evaluations[0].initialResults.find((item) => item.criterionId === 'c8');
  result.evidence = [];
  result.checkedRange = ['bot-before', 'event-between'];
  const built = await buildSubmission(input(state));
  assert.equal(built.canExport, true);
  assert.deepEqual(built.document.results[0].criteria.find((item) => item.criterion_id === 'critical').evidence_turns, [2, 3, 4, 5, 6, 7]);
});

test('submission uses immutable original AI results, ignores newer manual labels, and never mutates history', async () => {
  const state = fixture();
  state.evaluations[0].results.find((item) => item.criterionId === 'c4').value = 20;
  state.evaluations[0].results.find((item) => item.criterionId === 'c8').value = 'yes';
  state.evaluations[0].score = calculateScore(DEFAULT_CHECKLIST.criteria, state.evaluations[0].results);
  state.evaluations[0].updatedAt = '2026-11-07T23:00:00.000Z';
  state.evaluations.unshift(makeEvaluation(state.conversations[0], { id: 'newer-manual', source: 'manual', model: 'Эксперт', createdAt: '2026-11-07T12:00:00.000Z' }));
  const before = structuredClone(state);
  const built = await buildSubmission(input(state));
  assert.equal(built.canExport, true);
  assert.equal(built.rows[0].evaluationId, before.evaluations[1].id);
  assert.deepEqual(built.document.results[0].score, { final_score: 85.38, critical_flag: false });
  assert.equal(built.document.results[0].criteria.find((item) => item.criterion_id === 'consultation').value, 15);
  assert.ok(built.warnings.some((item) => item.code === 'ORIGINAL_AI_RESULTS'));
  assert.deepEqual(state, before);
});

test('every failed or unprocessed dialogue remains in a complete file with null score and an explicit reason', async () => {
  const state = fixture();
  state.evaluations = state.evaluations.slice(0, 9);
  state.evaluationFailures.push(makeFailure(state.conversations[0]));
  state.evaluations.push(makeEvaluation(state.conversations[9], { source: 'manual', model: 'Эксперт' }));
  const built = await buildSubmission(input(state));
  assert.equal(built.canExport, true);
  assert.deepEqual(built.counts, { expected: 10, total: 10, ok: 8, error: 2, unprocessed: 1, needsReview: 0, chats: 10, calls: 0 });
  assert.equal(built.document.results.length, 10);
  assert.deepEqual(built.document.results[0], {
    conversation_id: 'original-001', status: 'error', criteria: [], score: null, error: 'Не удалось получить ответ модели.',
  });
  assert.equal(built.rows[0].kind, 'failed');
  assert.equal(built.rows[9].kind, 'unprocessed');
  assert.match(built.document.results[9].error, /Ручная экспертная разметка/);
  assert.equal(built.document.results[9].score, null);
  assert.deepEqual(built.document.results[9].criteria, []);
  assert.ok(built.warnings.some((item) => item.code === 'PROCESSING_ERRORS'));
  assert.ok(built.warnings.some((item) => item.code === 'UNPROCESSED_DIALOGUES'));
});

test('the latest attempt wins, with a failure at an identical timestamp remaining visible', async () => {
  const state = fixture();
  const conversation = state.conversations[0];
  state.evaluationFailures.push(makeFailure(conversation));
  let built = await buildSubmission(input(state));
  assert.equal(built.rows[0].kind, 'failed');
  state.evaluations.push(makeEvaluation(conversation, { id: 'successful-retry', createdAt: '2026-11-07T12:00:00.000Z' }));
  built = await buildSubmission(input(state));
  assert.equal(built.rows[0].kind, 'ok');
  assert.equal(built.rows[0].evaluationId, 'successful-retry');
  state.evaluationFailures.push(makeFailure(conversation, { id: 'failure-at-same-time', createdAt: '2026-11-07T12:00:00.000Z' }));
  built = await buildSubmission(input(state));
  assert.equal(built.rows[0].kind, 'failed');
});

test('model provenance comes from actual selected outcomes and combines local/external runs as hybrid', async () => {
  const state = fixture();
  state.evaluations[0].model = 'synthetic-local-b';
  state.evaluations[0].runConfig.modelMode = 'local';
  state.evaluationFailures.push(makeFailure(state.conversations[1], { model: 'synthetic-failed-c' }));
  const built = await buildSubmission(input(state, 'prod', { unprocessedModel: { mode: 'local', name: 'must-not-override-runs' } }));
  assert.equal(built.canExport, true);
  assert.deepEqual(built.document.model, { mode: 'hybrid', name: 'synthetic-failed-c, synthetic-local-b, synthetic-model-a' });
  assert.ok(!built.json.includes('must-not-override-runs'));
});

test('missing historical model mode blocks export until the user explicitly confirms its provenance', async () => {
  const state = fixture();
  delete state.evaluations[0].runConfig;
  let built = await buildSubmission(input(state, 'prod', { legacyModelMode: 'external_api' }));
  assert.equal(built.needsLegacyMode, true);
  assert.equal(built.canExport, false);
  assert.equal(built.document, null);
  assert.ok(codes(built).includes('LEGACY_MODEL_MODE'));
  built = await buildSubmission(input(state, 'prod', { legacyModelMode: 'external_api', legacyModeConfirmed: true }));
  assert.equal(built.canExport, true);
  assert.equal(built.document.model.mode, 'external_api');
  assert.ok(built.warnings.some((item) => item.code === 'LEGACY_MODE_CONFIRMED'));
  assert.equal(state.evaluations[0].runConfig, undefined);
});

test('a group with no AI attempts does not invent a model or manual score', async () => {
  const state = fixture();
  state.evaluations = state.evaluations.map((evaluation) => ({ ...evaluation, source: 'manual', model: 'Эксперт' }));
  let built = await buildSubmission(input(state));
  assert.equal(built.document, null);
  assert.equal(built.canExport, false);
  assert.equal(built.counts.unprocessed, 10);
  assert.ok(codes(built).includes('MODEL_REQUIRED'));
  built = await buildSubmission(input(state, 'prod', { unprocessedModel: { mode: 'external_api', name: 'declared-unavailable-model' } }));
  assert.equal(built.canExport, true);
  assert.equal(built.document.results.length, 10);
  assert.ok(built.document.results.every((result) => result.status === 'error' && result.score === null && result.criteria.length === 0));
  assert.ok(built.warnings.some((item) => item.code === 'DECLARED_MODEL'));
});

test('a preflight error without a model stays in a file with nine valid AI results without changing model provenance', async () => {
  const state = fixture();
  state.evaluations.pop();
  state.evaluationFailures.push(makeFailure(state.conversations[9], {
    model: '', modelMode: 'local', code: 'MODEL_NOT_CONFIGURED', error: 'Выберите модель перед запуском AI-оценки.',
  }));
  const built = await buildSubmission(input(state));
  assert.equal(built.canExport, true);
  assert.deepEqual(built.document.model, { mode: 'external_api', name: 'synthetic-model-a' });
  assert.equal(built.counts.ok, 9);
  assert.equal(built.counts.error, 1);
  assert.equal(built.rows[9].kind, 'failed');
  assert.equal(built.document.results[9].score, null);
  assert.match(built.document.results[9].error, /Выберите модель/);
  assert.ok(built.warnings.some((item) => item.code === 'FAILURE_MODEL_UNAVAILABLE'));
  assert.ok(!codes(built).includes('RUN_MODEL_MISSING'));
});

test('an all-preflight-error group requires explicit model metadata and retains all ten errors after confirmation', async () => {
  const state = fixture();
  state.evaluations = [];
  state.evaluationFailures = state.conversations.map((conversation) => makeFailure(conversation, {
    model: '', modelMode: 'local', code: 'MODEL_NOT_CONFIGURED', error: 'Модель не настроена; вызов не выполнен.',
  }));
  let built = await buildSubmission(input(state));
  assert.equal(built.canExport, false);
  assert.equal(built.document, null);
  assert.deepEqual(built.models, []);
  assert.ok(codes(built).includes('MODEL_REQUIRED'));
  assert.equal(built.counts.error, 10);
  assert.equal(built.counts.unprocessed, 0);
  built = await buildSubmission(input(state, 'prod', { unprocessedModel: { mode: 'external_api', name: 'declared-unavailable-model' } }));
  assert.equal(built.canExport, true);
  assert.deepEqual(built.document.model, { mode: 'external_api', name: 'declared-unavailable-model' });
  assert.equal(built.document.results.length, 10);
  assert.ok(built.document.results.every((result) => result.status === 'error' && result.score === null && result.criteria.length === 0));
  assert.ok(built.warnings.some((item) => item.code === 'DECLARED_MODEL'));
  assert.equal(built.warnings.filter((item) => item.code === 'FAILURE_MODEL_UNAVAILABLE').length, 10);
});

test('missing model metadata on a successful evaluation cannot be hidden by an explicit error-file fallback', async () => {
  const state = fixture();
  state.evaluations.forEach((evaluation) => { evaluation.model = ''; });
  const built = await buildSubmission(input(state, 'prod', { unprocessedModel: { mode: 'external_api', name: 'must-not-mask-corrupted-provenance' } }));
  assert.equal(built.canExport, false);
  assert.equal(built.document, null);
  assert.ok(codes(built).includes('RUN_MODEL_MISSING'));
  assert.deepEqual(built.models, []);
});

test('DEV requires 60 chats and five calls, PROD requires exactly ten chats, and groups are never blended', async () => {
  const dev = fixture('dev');
  let built = await buildSubmission(input(dev, 'dev'));
  assert.equal(built.canExport, true);
  assert.equal(built.filePath, 'results/dev/results.json');
  assert.equal(built.counts.total, 65);
  dev.conversations[64].channel = 'agent chat';
  built = await buildSubmission(input(dev, 'dev'));
  assert.equal(built.canExport, false);
  assert.ok(codes(built).includes('DATASET_CHANNELS'));
  dev.conversations.pop();
  built = await buildSubmission(input(dev, 'dev'));
  assert.ok(codes(built).includes('DATASET_COUNT'));
  const prod = fixture();
  prod.conversations[9].dataset_group_id = 'OTHER';
  built = await buildSubmission(input(prod));
  assert.equal(built.counts.total, 9);
  assert.equal(built.canExport, false);
  prod.conversations[9].dataset_group_id = 'PROD-SYNTHETIC';
  prod.conversations[9].channel = 'voice call';
  built = await buildSubmission(input(prod));
  assert.ok(codes(built).includes('DATASET_CHANNELS'));
});

test('duplicate original IDs and source drift block a seemingly complete results array', async () => {
  const state = fixture();
  state.conversations[1].conversation_id = state.conversations[0].conversation_id;
  let built = await buildSubmission(input(state));
  assert.equal(built.counts.total, 10);
  assert.equal(built.canExport, false);
  assert.ok(codes(built).includes('SOURCE_ID_DUPLICATE'));
  assert.ok(codes(built).includes('RESULT_ID_DUPLICATE'));
  const changed = fixture();
  changed.conversations[0].transcript[0].text += ' Новый вопрос.';
  changed.evaluationFailures.push(makeFailure(changed.conversations[1], { transcriptHash: 'stale-hash' }));
  built = await buildSubmission(input(changed));
  assert.equal(built.canExport, false);
  assert.equal(built.rows[0].kind, 'invalid');
  assert.equal(built.rows[1].kind, 'invalid');
  assert.ok(codes(built).includes('TRANSCRIPT_MISMATCH'));
});

test('custom weights, forbidden N/A, modified scales or unknown IDs cannot pass as the official checklist', async () => {
  assert.deepEqual(checklistSubmissionIssues(DEFAULT_CHECKLIST), []);
  const changes = [
    (criteria) => { criteria[0].weight = 11; },
    (criteria) => { criteria[0].allowNA = true; criteria[0].naCondition = 'Вымышленное условие.'; },
    (criteria) => { criteria[5].levels[1].value = 8; },
    (criteria) => { criteria[1].id = 'different'; },
  ];
  for (const change of changes) {
    const state = fixture();
    change(state.evaluations[0].checklist.criteria);
    const built = await buildSubmission(input(state));
    assert.equal(built.canExport, false);
    assert.equal(built.rows[0].kind, 'invalid');
    assert.ok(built.rows[0].issues.some((item) => item.code.startsWith('CHECKLIST_')));
  }
});

test('invalid initial AI values, evidence or stored score block export instead of silently repairing a result', async () => {
  const changes = [
    (evaluation) => { evaluation.initialResults[0].value = 'na'; },
    (evaluation) => { evaluation.initialResults[5].value = 8; },
    (evaluation) => { evaluation.initialResults.pop(); },
    (evaluation) => { evaluation.initialResults[0].evidence = ['invented-source']; },
    (evaluation) => { evaluation.initialScore.total = 100; },
    (evaluation) => { evaluation.initialScore.critical = true; },
  ];
  for (const change of changes) {
    const state = fixture();
    change(state.evaluations[0]);
    const built = await buildSubmission(input(state));
    assert.equal(built.canExport, false);
    assert.equal(built.rows[0].kind, 'invalid');
    assert.equal(built.document.results[0].status, 'error');
    assert.equal(built.document.results[0].score, null);
    assert.ok(built.rows[0].issues.length > 0);
  }
});

test('a true critical flag stays separate from a valid score and review flags remain visible', async () => {
  const state = fixture();
  const evaluation = state.evaluations[0];
  evaluation.initialResults[7].value = 'yes';
  evaluation.initialResults[7].needsReview = true;
  evaluation.initialScore = calculateScore(DEFAULT_CHECKLIST.criteria, evaluation.initialResults);
  const built = await buildSubmission(input(state));
  assert.equal(built.canExport, true);
  assert.deepEqual(built.document.results[0].score, { final_score: 85.38, critical_flag: true });
  assert.equal(built.counts.needsReview, 1);
  assert.ok(built.warnings.some((item) => item.code === 'NEEDS_REVIEW'));
});

test('standalone validation rejects malformed values, extra fields, missing criteria and score inconsistencies', async () => {
  const built = await buildSubmission(input());
  const invalid = [
    [null, 'DOCUMENT_INVALID'], [[], 'DOCUMENT_INVALID'], [{}, 'MISSING_FIELDS'],
  ];
  const variants = [
    [(doc) => { doc.schema_version = 1; }, 'SCHEMA_VERSION'],
    [(doc) => { doc.team_name = ' '; }, 'TEAM_NAME'],
    [(doc) => { doc.extra = 'not-in-schema'; }, 'EXTRA_FIELDS'],
    [(doc) => { doc.model.mode = 'cloud'; }, 'MODEL_MODE'],
    [(doc) => { doc.model.name = ''; }, 'MODEL_NAME'],
    [(doc) => { doc.results[0].status = 'success'; }, 'RESULT_STATUS'],
    [(doc) => { doc.results[0].criteria[0].value = 'true'; }, 'CRITERION_VALUE'],
    [(doc) => { doc.results[0].criteria[0].value = null; }, 'CRITERION_VALUE'],
    [(doc) => { doc.results[0].criteria[5].value = 10.5; }, 'CRITERION_VALUE'],
    [(doc) => { doc.results[0].criteria[3].value = '15'; }, 'CRITERION_VALUE'],
    [(doc) => { doc.results[0].criteria[0].criterion_id = 'c1'; }, 'CRITERION_UNKNOWN'],
    [(doc) => { doc.results[0].criteria[1] = structuredClone(doc.results[0].criteria[0]); }, 'CRITERION_DUPLICATE'],
    [(doc) => { doc.results[0].criteria.pop(); }, 'CRITERION_MISSING'],
    [(doc) => { doc.results[0].criteria[0].rationale = ''; }, 'CRITERION_RATIONALE'],
    [(doc) => { doc.results[0].criteria[0].evidence_turns = [0]; }, 'EVIDENCE_TURNS'],
    [(doc) => { doc.results[0].criteria[0].evidence_turns = [4, 4]; }, 'EVIDENCE_DUPLICATE'],
    [(doc) => { doc.results[0].criteria[0].evidence_turns = [Number.MAX_SAFE_INTEGER + 1]; }, 'EVIDENCE_TURNS'],
    [(doc) => { doc.results[0].score.final_score = 85.384; }, 'FINAL_SCORE'],
    [(doc) => { doc.results[0].score.final_score = NaN; }, 'FINAL_SCORE'],
    [(doc) => { doc.results[0].score.final_score = 100; }, 'SCORE_FORMULA'],
    [(doc) => { doc.results[0].score.critical_flag = 'false'; }, 'CRITICAL_FLAG_TYPE'],
    [(doc) => { doc.results[0].score.critical_flag = true; }, 'CRITICAL_FLAG_MISMATCH'],
  ];
  for (const [change, code] of variants) { const doc = structuredClone(built.document); change(doc); invalid.push([doc, code]); }
  for (const [doc, code] of invalid) {
    const checked = validateSubmission(doc, { dataset: 'prod' });
    assert.equal(checked.valid, false, code);
    assert.ok(codes(checked).includes(code), `${code}: ${JSON.stringify(checked.issues)}`);
  }
});

test('standalone validation accepts original API transcripts without internal IDs and verifies exact membership and bounds', async () => {
  const state = fixture();
  const built = await buildSubmission(input(state));
  const source = state.conversations.map((conversation) => ({
    conversation_id: conversation.conversation_id, channel: conversation.channel,
    transcript: conversation.transcript.map(({ id, ...message }) => message),
  }));
  assert.equal(validateSubmission(built.document, { dataset: 'prod', conversations: source }).valid, true);
  const changed = structuredClone(built.document);
  changed.results[0].conversation_id = ' original-001';
  changed.results[1].criteria[0].evidence_turns = [9];
  let checked = validateSubmission(changed, { dataset: 'prod', conversations: source });
  assert.equal(checked.valid, false);
  assert.ok(codes(checked).includes('RESULT_ID_MISSING'));
  assert.ok(codes(checked).includes('RESULT_ID_UNEXPECTED'));
  assert.ok(codes(checked).includes('EVIDENCE_OUT_OF_RANGE'));
  checked = validateSubmission(built.document, { dataset: 'prod', expectedConversationIds: source.map((conversation) => conversation.conversation_id) });
  assert.equal(checked.valid, true);
  assert.deepEqual(checked.warnings.map((item) => item.code), ['EVIDENCE_UNVERIFIED']);
  checked = validateSubmission(built.document, { dataset: 'prod' });
  assert.equal(checked.valid, true);
  assert.deepEqual(checked.warnings.map((item) => item.code), ['IDS_UNVERIFIED', 'EVIDENCE_UNVERIFIED']);
});

test('error entries require empty criteria, null score and a reason, and still count toward the exact ten', async () => {
  const state = fixture();
  state.evaluationFailures.push(makeFailure(state.conversations[0]));
  const built = await buildSubmission(input(state));
  const variants = [
    [(doc) => { doc.results[0].criteria = [{ criterion_id: 'contact', value: false }]; }, 'ERROR_CRITERIA'],
    [(doc) => { doc.results[0].score = { final_score: 0, critical_flag: false }; }, 'ERROR_SCORE'],
    [(doc) => { doc.results[0].error = ''; }, 'ERROR_REASON'],
    [(doc) => { doc.results.pop(); }, 'RESULTS_COUNT'],
    [(doc) => { doc.results[1].conversation_id = doc.results[0].conversation_id; }, 'RESULT_ID_DUPLICATE'],
  ];
  for (const [change, code] of variants) {
    const doc = structuredClone(built.document); change(doc);
    const checked = validateSubmission(doc, { dataset: 'prod', conversations: state.conversations });
    assert.equal(checked.valid, false);
    assert.ok(codes(checked).includes(code));
  }
});
