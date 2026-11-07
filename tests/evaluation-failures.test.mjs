import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { DEFAULT_CHECKLIST } = require('../.sites-runtime/test-build/rubric.js');
const { DEFAULT_SETTINGS } = require('../.sites-runtime/test-build/types.js');
const evaluator = require('../.sites-runtime/test-build/evaluator.js');
const compiledStore = ts.transpileModule(readFileSync(new URL('../lib/server-store.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const syntheticKey = 'test-synthetic-key-not-a-real-credential';

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function syntheticRecord(conversationId = 'synthetic-001') {
  return {
    conversation_id: conversationId, language: 'RU', channel: 'agent chat', audio_url: null,
    transcript: [
      { timestamp: '00:00', speaker: 'client', text: 'Здравствуйте, как сменить тему?' },
      { timestamp: '00:01', speaker: 'operator', text: 'Здравствуйте! Я Анна. Тема находится в настройках.' },
    ],
  };
}

async function fixture({ conversationId = 'synthetic-001', model = 'synthetic-model', mode = 'local' } = {}) {
  // Run the actual migration SQL in an isolated, in-memory SQLite database.
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('../drizzle/', import.meta.url);
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(name, directory), 'utf8'));
  }
  let failFailureWrites = false;
  const db = {
    prepare(sql) {
      return {
        parameters: [],
        bind(...parameters) { this.parameters = parameters; return this; },
        async first() { return sqlite.prepare(sql).get(...this.parameters) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.parameters) }; },
        async run() {
          if (failFailureWrites && /INSERT INTO cqa_evaluation_failures/.test(sql)) throw new Error('Synthetic storage outage');
          const outcome = sqlite.prepare(sql).run(...this.parameters);
          return { meta: { changes: Number(outcome.changes) } };
        },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const outcomes = [];
        for (const statement of statements) outcomes.push(await statement.run());
        sqlite.exec('COMMIT');
        return outcomes;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const calls = [];
  const logs = [];
  let behavior = async () => ({
    results: DEFAULT_CHECKLIST.criteria.map((criterion) => ({
      criterionId: criterion.id,
      value: criterion.kind === 'flag' ? 'no' : criterion.kind === 'scale' ? Math.max(...criterion.levels.map((level) => level.value)) : 'yes',
      explanation: 'Синтетический результат для проверки сохранения.', evidence: ['m0002'],
      checkedRange: ['m0001', 'm0002'], needsReview: false,
    })),
    usage: { calls: 1, inputTokens: 30, outputTokens: 20, costUsd: null }, durationMs: 10, warnings: [],
  });
  const module = { exports: {} };
  const scopedRequire = (specifier) => {
    if (specifier === 'cloudflare:workers') return { env: { DB: db } };
    if (specifier === './evaluator') return {
      ...evaluator,
      async evaluateConversation(conversation, checklist, settings, key) {
        calls.push({ conversationId: conversation.id, model: settings.model, mode: settings.modelMode });
        return behavior(conversation, checklist, settings, key);
      },
    };
    if (specifier.startsWith('./')) return require(`../.sites-runtime/test-build/${specifier.slice(2)}.js`);
    return require(specifier);
  };
  new Function('exports', 'require', 'module', 'console', compiledStore)(
    module.exports, scopedRequire, module, { error: (...parts) => logs.push(parts) },
  );
  const request = (path, body) => new Request(`https://cqa.example/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const api = module.exports;
  await api.importDataset(request('api/import', { groupId: 'QA_SYNTHETIC_TEST', payload: [syntheticRecord(conversationId)] }));
  await api.saveSettings(request('api/settings', { ...DEFAULT_SETTINGS, model, modelMode: mode }));
  return {
    ...api, sqlite, calls, logs, request,
    internalId: `QA_SYNTHETIC_TEST:${conversationId}`,
    evaluationRequest(extra = {}) {
      return request('api/evaluate', { conversationId: `QA_SYNTHETIC_TEST:${conversationId}`, apiKey: syntheticKey, ...extra });
    },
    failWith(fn) { behavior = fn; },
    disableFailureWrites() { failFailureWrites = true; },
    close() { sqlite.close(); },
  };
}

test('successful AI runs retain the chosen model mode after later settings changes', async (t) => {
  const setup = await fixture({ mode: 'local' }); t.after(() => setup.close());
  const result = await setup.runEvaluation(setup.evaluationRequest());
  assert.equal(result.source, 'ai');
  assert.equal(result.model, 'synthetic-model');
  assert.equal(result.runConfig.modelMode, 'local');
  assert.equal(setup.calls.length, 1);
  await setup.saveSettings(setup.request('api/settings', { modelMode: 'hybrid', model: 'later-model' }));
  const state = await setup.loadState();
  assert.equal(state.settings.modelMode, 'hybrid');
  assert.equal(state.evaluations[0].runConfig.modelMode, 'local');
  assert.equal(state.evaluations[0].model, 'synthetic-model');
  assert.deepEqual(state.evaluationFailures, []);
  assert.ok(!JSON.stringify(state).includes(syntheticKey));
});

test('a failed model attempt survives state reload without a fabricated score or raw provider content', async (t) => {
  const setup = await fixture({ mode: 'hybrid' }); t.after(() => setup.close());
  const rawProviderText = `Invalid JSON: private synthetic reply; key=${syntheticKey}; https://provider.example/?sig=synthetic-secret`;
  setup.failWith(async () => { throw new evaluator.EvaluationError(rawProviderText, 'AI_VALIDATION_FAILED'); });
  await assert.rejects(setup.runEvaluation(setup.evaluationRequest()), (error) => {
    assert.equal(error.status, 422); assert.equal(error.code, 'AI_VALIDATION_FAILED');
    assert.ok(!error.message.includes(syntheticKey)); return true;
  });
  const state = await setup.loadState();
  assert.equal(setup.calls.length, 1);
  assert.deepEqual(state.evaluations, []);
  assert.equal(state.evaluationFailures.length, 1);
  const failure = state.evaluationFailures[0];
  assert.equal(failure.conversationId, setup.internalId);
  assert.equal(failure.checklistId, DEFAULT_CHECKLIST.id);
  assert.equal(failure.model, 'synthetic-model');
  assert.equal(failure.modelMode, 'hybrid');
  assert.equal(failure.code, 'AI_VALIDATION_FAILED');
  assert.equal(failure.transcriptHash, await digest(state.conversations[0].transcript));
  assert.match(failure.error, /не прошёл проверку/);
  assert.ok(Number.isFinite(Date.parse(failure.createdAt)));
  assert.ok(!JSON.stringify(failure).includes(syntheticKey));
  assert.ok(!JSON.stringify(failure).includes('private synthetic reply'));
  assert.ok(!JSON.stringify(failure).includes('synthetic-secret'));
  assert.equal('score' in failure, false);
});

test('a later successful retry preserves both the failure history and the new AI result', async (t) => {
  const setup = await fixture(); t.after(() => setup.close());
  const successful = await setup.runEvaluation(setup.evaluationRequest());
  setup.failWith(async () => { throw new evaluator.EvaluationError('Synthetic timeout', 'AI_TIMEOUT'); });
  await assert.rejects(setup.runEvaluation(setup.evaluationRequest()), { code: 'AI_TIMEOUT' });
  setup.failWith(async () => ({
    results: structuredClone(successful.initialResults), usage: successful.usage, durationMs: 1, warnings: [],
  }));
  const retry = await setup.runEvaluation(setup.evaluationRequest());
  const state = await setup.loadState();
  assert.equal(state.evaluationFailures.length, 1);
  assert.equal(state.evaluations.length, 2);
  assert.ok(state.evaluations.some((item) => item.id === retry.id));
  assert.ok(Date.parse(retry.createdAt) >= Date.parse(state.evaluationFailures[0].createdAt));
  assert.equal(state.evaluationFailures[0].code, 'AI_TIMEOUT');
});

for (const missing of ['key', 'model']) {
  test(`a missing ${missing} is recorded as a preparation failure without calling a model`, async (t) => {
    const setup = await fixture({ model: missing === 'model' ? '' : 'synthetic-model' }); t.after(() => setup.close());
    const request = setup.evaluationRequest(missing === 'key' ? { apiKey: undefined } : {});
    await assert.rejects(setup.runEvaluation(request), { status: 409, code: 'MODEL_NOT_CONFIGURED' });
    const state = await setup.loadState();
    assert.equal(setup.calls.length, 0);
    assert.deepEqual(state.evaluations, []);
    assert.equal(state.evaluationFailures.length, 1);
    assert.equal(state.evaluationFailures[0].code, 'MODEL_NOT_CONFIGURED');
  });
}

test('a failure-log storage outage does not replace the original model error or log its content', async (t) => {
  const setup = await fixture(); t.after(() => setup.close());
  setup.disableFailureWrites();
  setup.failWith(async () => { throw new evaluator.EvaluationError(`Synthetic limit; ${syntheticKey}`, 'AI_HTTP_429'); });
  await assert.rejects(setup.runEvaluation(setup.evaluationRequest()), { status: 429, code: 'AI_HTTP_429' });
  assert.equal(setup.logs.length, 1);
  assert.deepEqual(setup.logs[0], ['CQA evaluation failure could not be recorded', 'Error']);
  assert.ok(!JSON.stringify(setup.logs).includes(syntheticKey));
  assert.equal(setup.sqlite.prepare('SELECT count(*) AS n FROM cqa_evaluations').get().n, 0);
});

test('import and evaluation preserve source conversation IDs byte for byte, including Unicode and outer spaces', async (t) => {
  const sourceId = '  Синтетический-Ә-001  ';
  const setup = await fixture({ conversationId: sourceId }); t.after(() => setup.close());
  const state = await setup.loadState();
  assert.equal(state.conversations[0].conversation_id, sourceId);
  assert.equal(state.conversations[0].id, `QA_SYNTHETIC_TEST:${sourceId}`);
  const evaluation = await setup.runEvaluation(setup.evaluationRequest());
  assert.equal(evaluation.conversationId, state.conversations[0].id);
  await setup.importDataset(setup.request('api/import', {
    groupId: 'QA_SYNTHETIC_TEST', payload: [syntheticRecord(sourceId.trim())],
  }));
  assert.equal((await setup.loadState()).conversations.length, 2);
});

test('invalid source IDs are rejected rather than silently stripped or imported', async (t) => {
  const setup = await fixture(); t.after(() => setup.close());
  for (const id of [' ', '\tsynthetic-id', 'synthetic-id\n']) {
    await assert.rejects(setup.importDataset(setup.request('api/import', {
      groupId: 'QA_SYNTHETIC_TEST', payload: [syntheticRecord(id)],
    })), { status: 400 });
  }
  assert.equal((await setup.loadState()).conversations.length, 1);
});

test('model-mode settings validate allowed values and backfill old settings only for new runs', async (t) => {
  const setup = await fixture(); t.after(() => setup.close());
  for (const mode of ['cloud', 'LOCAL', null]) {
    await assert.rejects(setup.saveSettings(setup.request('api/settings', { modelMode: mode })), {
      status: 400, code: 'INVALID_MODEL_MODE',
    });
  }
  const settings = { ...(await setup.loadState()).settings };
  delete settings.modelMode;
  setup.sqlite.prepare('UPDATE cqa_settings SET value = ? WHERE key = ?').run(JSON.stringify(settings), 'provider');
  const state = await setup.loadState();
  assert.equal(state.settings.modelMode, 'external_api');
  const result = await setup.runEvaluation(setup.evaluationRequest());
  assert.equal(result.runConfig.modelMode, 'external_api');
});
