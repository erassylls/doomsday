import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = new Map();
// Render the actual component with synthetic records; no browser database or API is used.
function loadComponent(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const scopedRequire = (name) => {
    if (name.startsWith('.') || name.startsWith('@/')) {
      const base = name.startsWith('@/') ? resolve(root, name.slice(2)) : resolve(dirname(filename), name);
      const target = [base, base + '.tsx', base + '.ts'].find(existsSync);
      if (!target) throw new Error('Missing local component dependency: ' + name);
      return loadComponent(target);
    }
    return require(name);
  };
  new Function('exports', 'require', 'module', compiled)(module.exports, scopedRequire, module);
  return module.exports;
}

const { DialogueDetail } = loadComponent(resolve(root, 'components/cqa/dialogue-detail.tsx'));
const { DEFAULT_CHECKLIST } = require('../.sites-runtime/test-build/rubric.js');
const { DEFAULT_SETTINGS } = require('../.sites-runtime/test-build/types.js');
const { calculateScore } = require('../.sites-runtime/test-build/scoring.js');

function fixture() {
  const checklist = structuredClone(DEFAULT_CHECKLIST);
  const conversation = { id: 'SYNTHETIC:history', conversation_id: 'synthetic-history', dataset_group_id: 'SYNTHETIC', language: 'RU', channel: 'agent chat', audio_url: null, importedAt: '2026-11-07T00:00:00Z', transcript: [
    { id: 'm1', timestamp: '00:00', speaker: 'client', text: 'INITIAL_EVIDENCE_MARKER' },
    { id: 'm2', timestamp: '00:01', speaker: 'operator', text: 'REVISED_EVIDENCE_MARKER' },
  ] };
  const initialResults = checklist.criteria.map((criterion) => ({ criterionId: criterion.id,
    value: criterion.id === 'c1' || criterion.kind === 'flag' ? 'no' : criterion.kind === 'scale' ? Math.max(...criterion.levels.map((level) => level.value)) : 'yes',
    explanation: 'INITIAL_ONLY_REASON', evidence: ['m1'], checkedRange: ['m1', 'm2'], needsReview: false,
  }));
  const results = initialResults.map((result) => ({ ...result, value: result.criterionId === 'c1' ? 'yes' : result.value,
    explanation: 'REVISED_ONLY_REASON', evidence: ['m2'], checkedRange: null,
  }));
  const stored = { id: 'selected-older-ai', conversationId: conversation.id, checklist, initialResults, results,
    initialScore: calculateScore(checklist.criteria, initialResults), score: calculateScore(checklist.criteria, results),
    source: 'ai', model: 'synthetic-test-model', createdAt: '2026-11-07T01:00:00Z', updatedAt: '2026-11-07T03:00:00Z',
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null }, durationMs: 0, warnings: [], transcriptHash: 'synthetic-hash',
  };
  const latest = structuredClone(stored);
  latest.id = 'latest-ai'; latest.createdAt = '2026-11-07T02:00:00Z';
  for (const result of [...latest.initialResults, ...latest.results]) result.explanation = 'LATEST_ONLY_REASON';
  const state = { conversations: [conversation], checklists: [checklist], activeChecklistId: checklist.id,
    evaluations: [latest, stored], appeals: [], settings: DEFAULT_SETTINGS, providerConfigured: false, datasetConfigured: false };
  const props = { conversation, state, checklistId: checklist.id, initialEvaluationId: stored.id, evaluating: false,
    onChecklistChange() {}, onBack() {}, onEvaluate: async () => null, onRefresh() {}, onSettings() {}, onEvaluationSaved() {},
  };
  return { state, props };
}

test('accuracy history link renders the selected original AI score, reasons and evidence on the first render', () => {
  const { state, props } = fixture();
  const before = structuredClone(state);
  const html = renderToStaticMarkup(React.createElement(DialogueDetail, { ...props, initialShowOriginal: true }));
  assert.match(html, /Исходный ответ AI до апелляций/);
  assert.match(html, /INITIAL_ONLY_REASON/);
  assert.doesNotMatch(html, /REVISED_ONLY_REASON|LATEST_ONLY_REASON/);
  assert.match(html, /class="quote-text">INITIAL_EVIDENCE_MARKER/);
  assert.doesNotMatch(html, /class="quote-text">REVISED_EVIDENCE_MARKER/);
  assert.match(html, /<strong>90<\/strong><span>из 100/);
  assert.doesNotMatch(html, />Оспорить</);
  assert.deepEqual(state, before);
});

test('the same selected history entry renders the revised score and evidence in current-result mode', () => {
  const { props } = fixture();
  const html = renderToStaticMarkup(React.createElement(DialogueDetail, props));
  assert.match(html, /REVISED_ONLY_REASON/);
  assert.doesNotMatch(html, /INITIAL_ONLY_REASON|LATEST_ONLY_REASON/);
  assert.match(html, /class="quote-text">REVISED_EVIDENCE_MARKER/);
  assert.doesNotMatch(html, /class="quote-text">INITIAL_EVIDENCE_MARKER/);
  assert.match(html, /<strong>100<\/strong><span>из 100/);
  assert.match(html, />Оспорить</);
});
