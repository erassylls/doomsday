import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { DEFAULT_CHECKLIST } = require('../.sites-runtime/test-build/rubric.js');
const { calculateScore } = require('../.sites-runtime/test-build/scoring.js');
const source = readFileSync(new URL('../lib/server-store.ts', import.meta.url), 'utf8');
const compiledStore = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function fixture() {
  const messages = [
    { id: 'm0001', timestamp: '00:00', speaker: 'client', text: 'Здравствуйте.' },
    { id: 'm0002', timestamp: '00:01', speaker: 'operator', text: 'Здравствуйте, меня зовут Анна.' },
  ];
  const results = DEFAULT_CHECKLIST.criteria.map((criterion) => ({
    criterionId: criterion.id,
    value: criterion.kind === 'flag' ? 'no' : criterion.kind === 'scale' ? Math.max(...criterion.levels.map((level) => level.value)) : 'yes',
    explanation: 'Проверено по указанным репликам.', evidence: ['m0002'], checkedRange: ['m0001', 'm0002'], needsReview: false,
  }));
  results[0] = { ...results[0], value: 'no', evidence: [] };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(messages)));
  const transcriptHash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const initialScore = calculateScore(DEFAULT_CHECKLIST.criteria, results);
  const evaluation = {
    id: 'evaluation-test', conversationId: 'TEST:1', checklist: DEFAULT_CHECKLIST,
    initialResults: structuredClone(results), results, initialScore, score: structuredClone(initialScore),
    source: 'manual', model: 'Эксперт', createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z',
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null }, durationMs: 0, warnings: [], transcriptHash,
  };
  const appeal = {
    id: 'appeal-test', evaluationId: evaluation.id, conversationId: evaluation.conversationId, criterionId: 'c1',
    comment: 'Прошу проверить приветствие.', status: 'pending', originalValue: 'no', proposedValue: 'yes',
    finalValue: null, decisionReason: null, createdAt: evaluation.createdAt, resolvedAt: null,
  };
  let batchWrites = 0;
  const database = {
    prepare(sql) {
      return {
        sql, parameters: [],
        bind(...parameters) { this.parameters = parameters; return this; },
        async first() {
          if (sql.includes('FROM cqa_appeals')) return { payload: JSON.stringify(appeal) };
          if (sql.includes('FROM cqa_evaluations')) return { payload: JSON.stringify(evaluation), revision: 0 };
          if (sql.includes('FROM cqa_conversations')) return { payload: JSON.stringify({ transcript: messages }) };
          throw new Error(`Unexpected database read: ${sql}`);
        },
      };
    },
    async batch(statements) { batchWrites += statements.length; return statements.map(() => ({ meta: { changes: 1 } })); },
  };
  const module = { exports: {} };
  const scopedRequire = (specifier) => {
    if (specifier === 'cloudflare:workers') return { env: { DB: database } };
    if (specifier.startsWith('./')) return require(`../.sites-runtime/test-build/${specifier.slice(2)}.js`);
    return require(specifier);
  };
  // Execute our own transpiled server module with a bounded fake D1 binding.
  new Function('exports', 'require', 'module', compiledStore)(module.exports, scopedRequire, module);
  const request = (extra = {}) => new Request('https://cqa.example/api/appeals/resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appealId: appeal.id, decision: 'change', value: 'yes', reason: 'Приветствие и представление есть в первой реплике оператора.', ...extra }),
  });
  return { ...module.exports, request, evaluation, batchWrites: () => batchWrites };
}

test('appeal no→yes without a concrete evidence message fails before any database write', async () => {
  const setup = await fixture();
  await assert.rejects(setup.resolveAppeal(setup.request()), (error) => {
    assert.equal(error.status, 422);
    assert.equal(error.code, 'INVALID_APPEAL_EVIDENCE');
    assert.match(error.message, /для «Да» нужна ссылка/);
    return true;
  });
  assert.equal(setup.batchWrites(), 0);
});

test('appeal with existing evidence changes the verdict and preserves the initial assessment', async () => {
  const setup = await fixture();
  const result = await setup.resolveAppeal(setup.request({ evidence: ['m0002'], checkedRange: null }));
  assert.equal(result.appeal.status, 'changed');
  assert.equal(result.evaluation.results[0].value, 'yes');
  assert.deepEqual(result.evaluation.results[0].evidence, ['m0002']);
  assert.equal(result.evaluation.results[0].checkedRange, null);
  assert.equal(result.evaluation.initialResults[0].value, 'no');
  assert.deepEqual(result.evaluation.initialResults[0].evidence, []);
  assert.equal(result.evaluation.initialScore.total, 90);
  assert.equal(result.evaluation.score.total, 100);
  assert.equal(setup.batchWrites(), 2);
});

test('appeal cannot save a fabricated evidence reference', async () => {
  const setup = await fixture();
  await assert.rejects(setup.resolveAppeal(setup.request({ evidence: ['m9999'], checkedRange: null })), (error) => {
    assert.equal(error.status, 422);
    assert.equal(error.code, 'INVALID_APPEAL_EVIDENCE');
    return true;
  });
  assert.equal(setup.batchWrites(), 0);
});
