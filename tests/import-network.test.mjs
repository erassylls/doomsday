import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../lib/server-store.ts', import.meta.url), 'utf8');
const compiledStore = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(responseFactory) {
  const requests = [];
  let writes = 0;
  const db = {
    prepare(sql) {
      return {
        sql,
        bind(...parameters) { this.parameters = parameters; return this; },
        async all() { return { results: [] }; },
      };
    },
    async batch(statements) {
      writes += statements.length;
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  const module = { exports: {} };
  const scopedRequire = (specifier) => {
    if (specifier === 'cloudflare:workers') {
      return { env: { DB: db, DATASET_API_URL: 'https://dataset.example.test/api?sig=synthetic-signature&group_id=DEV' } };
    }
    if (specifier.startsWith('./')) return require(`../.sites-runtime/test-build/${specifier.slice(2)}.js`);
    return require(specifier);
  };
  const mockFetch = async (url, options) => {
    requests.push({ url, options });
    // Match the production Workers incompatibility without making a network request.
    if (options.redirect === 'error') throw new TypeError('Invalid redirect value, must be follow or manual');
    return responseFactory(url, options);
  };
  new Function('exports', 'require', 'module', 'fetch', compiledStore)(module.exports, scopedRequire, module, mockFetch);
  const request = () => new Request('https://cqa.example/api/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId: 'QA-MOCK' }),
  });
  return { ...module.exports, request, requests, writes: () => writes };
}

test('dataset import uses Workers-compatible manual redirects and accepts a synthetic direct response', async () => {
  const setup = fixture(() => new Response(JSON.stringify({
    isSuccess: true, error: '', data: {
      dataset_group_id: 'QA-MOCK', total_records: 1,
      records: [{
        conversation_id: 'synthetic-1', language: 'RU', channel: 'agent chat', audio_url: null,
        transcript: [{ timestamp: '00:00', speaker: 'operator', text: 'Синтетическая реплика для проверки импорта.' }],
      }],
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  assert.deepEqual(await setup.importDataset(setup.request()), { count: 1, groupId: 'QA-MOCK' });
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].options.redirect, 'manual');
  assert.equal(new URL(setup.requests[0].url).searchParams.get('group_id'), 'QA-MOCK');
  assert.ok(setup.writes() > 0);
});

for (const [name, status, location] of [
  ['same-origin', 302, 'https://dataset.example.test/another?sig=synthetic-signature'],
  ['cross-origin', 307, 'https://another.example.test/collect?sig=synthetic-signature'],
]) {
  test(`dataset import rejects a ${name} redirect without a second fetch or database write`, async () => {
    const setup = fixture(() => new Response('Synthetic redirect response', { status, headers: { Location: location } }));
    await assert.rejects(setup.importDataset(setup.request()), (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'DATASET_REDIRECT_BLOCKED');
      assert.ok(!error.message.includes('synthetic-signature'));
      return true;
    });
    assert.equal(setup.requests.length, 1);
    assert.equal(setup.requests[0].options.redirect, 'manual');
    assert.equal(setup.writes(), 0);
  });
}
