import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DEFAULT_CHECKLIST, validateChecklist } = require('../.sites-runtime/test-build/rubric.js');
const { calculateScore, validateResults } = require('../.sites-runtime/test-build/scoring.js');
const { EVALUATOR_REVISION, evaluateConversation, normalizeEvaluationOutput } = require('../.sites-runtime/test-build/evaluator.js');
const criteria = DEFAULT_CHECKLIST.criteria;
const messages = [
  { id: 'm1', timestamp: '2026-11-07T10:00:00Z', speaker: 'client', text: 'Здравствуйте, подскажите порядок обращения.' },
  { id: 'm2', timestamp: '2026-11-07T10:01:00Z', speaker: 'operator', text: 'Здравствуйте, меня зовут Анна. Обращение можно подать в личном кабинете.' },
  { id: 'm3', timestamp: '2026-11-07T10:02:00Z', speaker: 'operator', text: 'Чем ещё могу помочь? Всего доброго.' },
];
const makeResults = () => criteria.map((criterion) => ({
  criterionId: criterion.id,
  value: criterion.kind === 'flag' ? 'no' : criterion.kind === 'scale' ? Math.max(...criterion.levels.map((level) => level.value)) : 'yes',
  explanation: 'Экспертное обоснование со ссылкой на реплику.',
  evidence: ['m2'], checkedRange: ['m1', 'm3'], needsReview: false,
}));
const set = (results, id, value) => { results.find((result) => result.criterionId === id).value = value; return results; };
const makeAIOutput = (sourceCriteria = criteria) => ({
  results: sourceCriteria.map((criterion) => ({
    criterionId: criterion.id,
    groundedEvidence: [{ messageId: 'm2', quote: 'Здравствуйте, меня зовут Анна.' }],
    checkedRange: ['m1', 'm3'], explanation: 'Синтетическое обоснование для проверки контракта.',
    reviewReason: null,
    value: String(criterion.kind === 'flag' ? 'no' : criterion.kind === 'scale' ? Math.max(...criterion.levels.map((level) => level.value)) : 'yes'),
  })),
  warnings: [],
});
const providerResponse = (output, inputTokens = 100, outputTokens = 50) => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
}));

test('organizer rubric has the exact discrete scales, weights and separate flag', () => {
  assert.deepEqual(validateChecklist(criteria), []);
  assert.equal(criteria.length, 8);
  assert.equal(criteria.reduce((sum, criterion) => sum + criterion.weight, 0), 100);
  assert.deepEqual(criteria.find((criterion) => criterion.id === 'c4').levels.map((level) => level.value), [20, 15, 10, 5, 0]);
  assert.deepEqual(criteria.find((criterion) => criterion.id === 'c6').levels.map((level) => level.value), [10, 7, 4, 0]);
  assert.equal(criteria.find((criterion) => criterion.id === 'c8').weight, 0);
});

test('C6 score 7/10 is weighted to 10.5 of its 15 points', () => {
  const score = calculateScore(criteria, set(makeResults(), 'c6', 7));
  assert.equal(score.total, 95.5);
  assert.equal(score.items.find((item) => item.criterionId === 'c6').points, 10.5);
  assert.equal(score.applicableWeight, 100);
});

test('N/A removes weights and final score is rounded only after renormalization', () => {
  const results = makeResults();
  set(results, 'c2', 'na'); set(results, 'c3', 'na'); set(results, 'c7', 'na'); set(results, 'c4', 10);
  const score = calculateScore(criteria, results);
  assert.equal(score.applicableWeight, 60);
  assert.equal(score.total, 83.33);
  assert.equal(score.items.find((item) => item.criterionId === 'c2').effectiveWeight, 0);
  assert.equal(score.items.find((item) => item.criterionId === 'c4').effectiveWeight, 100 / 3);
  assert.ok(Math.abs(score.sections.reduce((sum, section) => sum + section.possible, 0) - 100) < 1e-10);
});

test('a critical flag is reported separately without lowering a perfect score', () => {
  const score = calculateScore(criteria, set(makeResults(), 'c8', 'yes'));
  assert.equal(score.total, 100);
  assert.equal(score.critical, true);
  assert.equal(score.items.find((item) => item.criterionId === 'c8').points, 0);
});

test('no applicable weighted criteria yields null, including when a flag is raised', () => {
  const custom = [
    { ...criteria[0], allowNA: true, naCondition: 'Действие не требуется.' },
    { ...criteria[7] },
  ];
  const score = calculateScore(custom, [
    { ...makeResults()[0], value: 'na' },
    { ...makeResults()[7], value: 'yes' },
  ]);
  assert.equal(score.total, null);
  assert.equal(score.applicableWeight, 0);
  assert.equal(score.critical, true);
  assert.equal(score.items.reduce((sum, item) => sum + item.points, 0), 0);
});

test('forbidden ratings and missing or repeated IDs never silently score', () => {
  assert.throws(() => calculateScore(criteria, set(makeResults(), 'c6', 8)), /не входит/);
  assert.throws(() => calculateScore(criteria, set(makeResults(), 'c1', 'na')), /N\/A запрещён/);
  assert.throws(() => calculateScore(criteria, set(makeResults(), 'c4', 'yes')), /не входит/);
  assert.throws(() => calculateScore(criteria, makeResults().slice(1)), /Отсутствует/);
  assert.throws(() => calculateScore(criteria, [...makeResults(), makeResults()[0]]), /повторяется/);
});

test('edited scales use their own maximum and weighting', () => {
  const custom = [{ ...criteria[5], id: 'custom', weight: 40, levels: [{ value: 5, label: 'Полное выполнение' }, { value: 2, label: 'Частичное выполнение' }, { value: 0, label: 'Не выполнено' }] }];
  const score = calculateScore(custom, [{ ...makeResults()[5], criterionId: 'custom', value: 2 }]);
  assert.equal(score.total, 40);
  assert.equal(score.applicableWeight, 40);
});

test('evidence validator rejects fabricated sources, backward ranges, empty explanations and absent anchors', () => {
  assert.deepEqual(validateResults(criteria, makeResults(), messages), []);
  const results = makeResults();
  results[0].evidence = ['fabricated'];
  results[1].checkedRange = ['m3', 'm1'];
  results[2].explanation = ' ';
  results[3].evidence = []; results[3].checkedRange = null;
  const errors = validateResults(criteria, results, messages);
  assert.ok(errors.some((error) => error.includes('существующие ID')));
  assert.ok(errors.some((error) => error.includes('порядке транскрипта')));
  assert.ok(errors.some((error) => error.includes('обоснование')));
  assert.ok(errors.some((error) => error.includes('проверенный диапазон')));
  assert.doesNotThrow(() => validateResults(criteria, [null, 'bad', {}, 7], messages));
});

test('an absent action or absence of a critical error may cite a checked interval', () => {
  const results = makeResults();
  set(results, 'c1', 'no');
  results[0].evidence = [];
  results[7].evidence = [];
  assert.deepEqual(validateResults(criteria, results, messages), []);
  results[0].checkedRange = null;
  assert.ok(validateResults(criteria, results, messages).length > 0);
});

test('schema-compatible numeric strings normalize only to actual configured levels', () => {
  const raw = makeAIOutput();
  raw.results[5].value = '7';
  const parsed = normalizeEvaluationOutput(raw, criteria, messages);
  assert.equal(parsed.results[5].value, 7);
  assert.deepEqual(validateResults(criteria, parsed.results, messages), []);
  raw.results[5].value = '8';
  assert.ok(validateResults(criteria, normalizeEvaluationOutput(raw, criteria, messages).results, messages).length > 0);
});

test('grounded evidence rejects invented text even when its message ID exists', () => {
  const raw = makeAIOutput();
  const sourceBefore = structuredClone(messages);
  const parsed = normalizeEvaluationOutput(raw, criteria, messages);
  assert.deepEqual(parsed.results[0].evidence, ['m2']);
  assert.ok(!('groundedEvidence' in parsed.results[0]));
  assert.deepEqual(messages, sourceBefore);

  raw.results[0].groundedEvidence[0].quote = 'Я выполнила идентификацию и проверила паспорт.';
  assert.throws(() => normalizeEvaluationOutput(raw, criteria, messages), /точной подстрокой сообщения m2/);
  raw.results[0].groundedEvidence[0] = { messageId: 'missing-id', quote: 'Здравствуйте, меня зовут Анна.' };
  assert.throws(() => normalizeEvaluationOutput(raw, criteria, messages), /несуществующее сообщение/);
  raw.results[0].groundedEvidence[0] = { messageId: 'm2', quote: ' ' };
  assert.throws(() => normalizeEvaluationOutput(raw, criteria, messages), /непустой точной цитатой/);
});

test('every quote is checked before duplicate message references are collapsed', () => {
  const raw = makeAIOutput();
  raw.results[0].groundedEvidence.push({ messageId: 'm2', quote: 'Обращение можно подать в личном кабинете.' });
  assert.deepEqual(normalizeEvaluationOutput(raw, criteria, messages).results[0].evidence, ['m2']);
  raw.results[0].groundedEvidence[1].quote = 'Идентификация успешно завершена.';
  assert.throws(() => normalizeEvaluationOutput(raw, criteria, messages), /точной подстрокой/);
});

test('a concrete review reason deterministically creates review status without changing the rating', () => {
  const raw = makeAIOutput();
  const reason = 'Нет проверенного регламента компании для подтверждения процедуры.';
  raw.results[3].reviewReason = reason;
  const parsed = normalizeEvaluationOutput(raw, criteria, messages);
  assert.equal(parsed.results[3].value, 20);
  assert.equal(parsed.results[3].needsReview, true);
  assert.ok(parsed.results[3].explanation.includes(reason));
  assert.ok(parsed.warnings.some((warning) => warning.includes('c4') && warning.includes(reason)));
  assert.equal(parsed.results[0].needsReview, false);
  raw.results[3].reviewReason = ' ';
  assert.throws(() => normalizeEvaluationOutput(raw, criteria, messages), /reviewReason/);
  delete raw.results[3].reviewReason;
  assert.throws(() => normalizeEvaluationOutput(raw, criteria, messages), /reviewReason/);
});

const conversation = { id: 'test', conversation_id: 'test', dataset_group_id: 'TEST', channel: 'agent chat', language: 'RU', transcript: messages, audio_url: null, importedAt: '2026-11-07T00:00:00Z' };
const settings = { baseUrl: 'https://provider.example/v1', model: 'test-model', inputPrice: 2, outputPrice: 4, strictJson: true, verification: false, knowledge: '' };

test('missing key or model does not call any provider', async () => {
  await assert.rejects(evaluateConversation(conversation, DEFAULT_CHECKLIST, settings, ''), /API-ключ/);
  await assert.rejects(evaluateConversation(conversation, DEFAULT_CHECKLIST, { ...settings, model: '' }, 'test-secret'), /Укажите модель/);
});

test('invalid AI output is repaired once and all call usage is counted', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    const output = makeAIOutput();
    if (requests.length === 1) output.results[5].value = '8';
    return providerResponse(output);
  };
  try {
    const evaluated = await evaluateConversation(conversation, DEFAULT_CHECKLIST, settings, 'test-secret');
    assert.equal(requests.length, 2);
    assert.equal(evaluated.usage.calls, 2);
    assert.equal(evaluated.usage.inputTokens, 200);
    assert.equal(evaluated.usage.outputTokens, 100);
    assert.equal(evaluated.usage.costUsd, 0.0008);
    assert.equal(requests[0].url, 'https://provider.example/v1/chat/completions');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer test-secret');
    assert.ok(requests.every((request) => request.options.redirect === 'manual'));
    assert.ok(!requests[0].options.body.includes('test-secret'));
    assert.equal(JSON.parse(requests[0].options.body).response_format.type, 'json_schema');
  } finally { globalThis.fetch = originalFetch; }
});

test('a provider redirect is rejected after one fetch without sending credentials to its destination', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const redirectTarget = 'https://redirect-destination.example/collect';
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    // 307 would preserve a POST and its credentials if redirect mode were follow.
    return new Response(JSON.stringify(makeAIOutput()), {
      status: 307, headers: { Location: redirectTarget },
    });
  };
  try {
    await assert.rejects(
      evaluateConversation(conversation, DEFAULT_CHECKLIST, { ...settings, verification: true }, 'test-secret'),
      (error) => {
        assert.equal(error.code, 'AI_REDIRECT_REJECTED');
        assert.deepEqual(error.usage, { calls: 1, inputTokens: 0, outputTokens: 0, costUsd: null });
        assert.ok(!('results' in error));
        return true;
      },
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://provider.example/v1/chat/completions');
    assert.equal(requests[0].options.redirect, 'manual');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer test-secret');
    assert.ok(requests.every((request) => request.url !== redirectTarget));
    assert.ok(!requests[0].options.body.includes('test-secret'));
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid AI output cannot cause unbounded repair or heuristic scoring', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"results":[],"warnings":[]}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  };
  try {
    await assert.rejects(evaluateConversation(conversation, DEFAULT_CHECKLIST, settings, 'test-secret'), /не прошёл проверку/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('verification is opt-in and absent prices do not produce invented cost', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return providerResponse(makeAIOutput(), 10, 5);
  };
  try {
    const result = await evaluateConversation(conversation, DEFAULT_CHECKLIST, { ...settings, verification: true, strictJson: false, inputPrice: null, outputPrice: null }, 'test-secret');
    assert.equal(result.usage.calls, 2);
    assert.equal(result.usage.costUsd, null);
    assert.ok(requests.every((request) => request.response_format.type === 'json_object'));
    assert.ok(requests.every((request) => !('temperature' in request)));
  } finally { globalThis.fetch = originalFetch; }
});

test('each strict-schema branch permits only its criterion ratings and puts facts before the verdict', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return providerResponse(makeAIOutput());
  };
  try {
    const evaluated = await evaluateConversation(conversation, DEFAULT_CHECKLIST, settings, 'test-secret');
    assert.equal(requests.length, 1);
    const schema = requests[0].response_format.json_schema.schema;
    const branch = (id) => schema.properties.results.items.anyOf.find((item) => item.properties.criterionId.enum[0] === id);
    assert.deepEqual(branch('c1').properties.value.enum, ['yes', 'no']);
    assert.deepEqual(branch('c4').properties.value.enum, ['20', '15', '10', '5', '0', 'na']);
    assert.deepEqual(branch('c6').properties.value.enum, ['10', '7', '4', '0']);
    assert.ok(!branch('c4').properties.value.enum.includes('7'));
    assert.ok(!branch('c6').properties.value.enum.includes('na'));
    for (const item of schema.properties.results.items.anyOf) {
      const keys = Object.keys(item.properties);
      assert.ok(keys.indexOf('groundedEvidence') < keys.indexOf('value'));
      assert.ok(keys.indexOf('explanation') < keys.indexOf('value'));
      assert.equal(item.additionalProperties, false);
      assert.deepEqual(new Set(item.required), new Set(keys));
    }
    assert.deepEqual(Object.keys(evaluated.results[0]).sort(), ['checkedRange', 'criterionId', 'evidence', 'explanation', 'needsReview', 'value']);
    assert.equal(JSON.parse(requests[0].messages[1].content).evaluatorRevision, EVALUATOR_REVISION);
    assert.equal(EVALUATOR_REVISION, 'cqa-2026-11-07.2');
  } finally { globalThis.fetch = originalFetch; }
});

test('a 100-criterion checklist stays within Structured Outputs schema budgets', async () => {
  const originalFetch = globalThis.fetch;
  const largeCriteria = Array.from({ length: 100 }, (_, index) => ({ ...criteria[0], id: `criterion_${index}`, name: `Критерий ${index + 1}` }));
  const largeChecklist = { ...DEFAULT_CHECKLIST, criteria: largeCriteria };
  let schema;
  globalThis.fetch = async (_url, options) => {
    schema = JSON.parse(options.body).response_format.json_schema.schema;
    return providerResponse(makeAIOutput(largeCriteria));
  };
  try {
    const evaluated = await evaluateConversation(conversation, largeChecklist, settings, 'test-secret');
    assert.equal(evaluated.results.length, 100);
    assert.equal(evaluated.usage.calls, 1);
    assert.equal(schema.properties.results.items.anyOf.length, 100);
    let properties = 0;
    let enumValues = 0;
    function count(node) {
      if (!node || typeof node !== 'object') return;
      if (node.properties) properties += Object.keys(node.properties).length;
      if (Array.isArray(node.enum)) enumValues += node.enum.length;
      Object.values(node).forEach((value) => { if (typeof value === 'object') count(value); });
    }
    count(schema);
    assert.ok(properties <= 5000);
    assert.ok(enumValues <= 1000);
    assert.ok(JSON.stringify(schema).length <= 100000);
  } finally { globalThis.fetch = originalFetch; }
});

test('an excessive enum budget fails before fetch and requires an explicit JSON-mode choice', async () => {
  const originalFetch = globalThis.fetch;
  const largeCriteria = Array.from({ length: 20 }, (_, index) => ({
    ...criteria[5], id: `scale_${index}`, name: `Шкала ${index + 1}`,
    levels: Array.from({ length: 50 }, (_, value) => ({ value, label: `Ступень ${value}` })),
  }));
  const largeChecklist = { ...DEFAULT_CHECKLIST, criteria: largeCriteria };
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return providerResponse(makeAIOutput(largeCriteria));
  };
  try {
    await assert.rejects(evaluateConversation(conversation, largeChecklist, settings, 'test-secret'), (error) => {
      assert.equal(error.code, 'INVALID_CHECKLIST');
      assert.match(error.message, /JSON-схема слишком велика/);
      return true;
    });
    assert.equal(requests.length, 0);
    const evaluated = await evaluateConversation(conversation, largeChecklist, { ...settings, strictJson: false }, 'test-secret');
    assert.equal(evaluated.results.length, 20);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].response_format.type, 'json_object');
  } finally { globalThis.fetch = originalFetch; }
});

test('verification is blind to the first answer and preserves its score plus uncertainty from both passes', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const output = makeAIOutput();
    if (requests.length === 1) {
      output.results[0].explanation = 'FIRST_PASS_MARKER';
      output.results[3].reviewReason = 'FIRST_KNOWLEDGE_GAP';
      output.results[5].value = '7';
      output.warnings.push('FIRST_WARNING');
      return providerResponse(output, 100, 30);
    }
    output.results[0].reviewReason = 'SECOND_AMBIGUITY';
    output.results[5].value = '10';
    output.warnings.push('SECOND_WARNING');
    return providerResponse(output, 70, 40);
  };
  try {
    const evaluated = await evaluateConversation(conversation, DEFAULT_CHECKLIST, { ...settings, verification: true }, 'test-secret');
    assert.equal(requests.length, 2);
    assert.ok(requests[1].messages.every((message) => message.role !== 'assistant'));
    const secondContext = JSON.stringify(requests[1].messages);
    assert.ok(!secondContext.includes('FIRST_PASS_MARKER'));
    assert.ok(!secondContext.includes('FIRST_KNOWLEDGE_GAP'));
    assert.ok(!secondContext.includes('FIRST_WARNING'));
    assert.deepEqual(JSON.parse(requests[1].messages[1].content).conversation.transcript, messages);
    const result = (id) => evaluated.results.find((item) => item.criterionId === id);
    assert.equal(result('c6').value, 7);
    assert.equal(result('c6').needsReview, true);
    assert.equal(calculateScore(criteria, evaluated.results).total, 95.5);
    assert.equal(result('c1').explanation, 'FIRST_PASS_MARKER');
    assert.equal(result('c1').needsReview, true);
    assert.equal(result('c4').needsReview, true);
    for (const warning of ['FIRST_WARNING', 'SECOND_WARNING', 'FIRST_KNOWLEDGE_GAP', 'SECOND_AMBIGUITY']) {
      assert.ok(evaluated.warnings.some((item) => item.includes(warning)));
    }
    assert.ok(evaluated.warnings.some((warning) => warning.includes('c6') && warning.includes('«7»') && warning.includes('«10»')));
    assert.deepEqual(evaluated.usage, { calls: 2, inputTokens: 170, outputTokens: 70, costUsd: 0.00062 });
  } finally { globalThis.fetch = originalFetch; }
});

test('the single repair budget is shared across both passes and failed verification reports all usage', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const output = makeAIOutput();
    if (requests.length === 1 || requests.length === 3) {
      output.results[0].groundedEvidence[0].quote = 'FABRICATED_QUOTE_NOT_IN_TRANSCRIPT';
    }
    return providerResponse(output);
  };
  try {
    await assert.rejects(evaluateConversation(conversation, DEFAULT_CHECKLIST, { ...settings, verification: true }, 'test-secret'), (error) => {
      assert.equal(error.code, 'AI_VALIDATION_FAILED');
      assert.match(error.message, /точной подстрокой/);
      assert.deepEqual(error.usage, { calls: 3, inputTokens: 300, outputTokens: 150, costUsd: 0.0012 });
      return true;
    });
    assert.equal(requests.length, 3);
    assert.ok(requests[1].messages.some((message) => message.role === 'assistant'));
    assert.ok(requests[2].messages.every((message) => message.role !== 'assistant'));
    assert.ok(!JSON.stringify(requests[2].messages).includes('FABRICATED_QUOTE_NOT_IN_TRANSCRIPT'));
  } finally { globalThis.fetch = originalFetch; }
});
