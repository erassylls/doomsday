import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const output = resolve('.sites-runtime/test-build');
mkdirSync(output, { recursive: true });
const compiler = spawnSync(process.execPath, [
  'node_modules/typescript/bin/tsc', '--target', 'ES2022', '--module', 'commonjs',
  '--moduleResolution', 'node', '--esModuleInterop', '--skipLibCheck', '--strict',
  '--outDir', output, 'lib/types.ts', 'lib/rubric.ts', 'lib/scoring.ts', 'lib/evaluator.ts', 'lib/calibration.ts', 'lib/submission.ts',
], { stdio: 'inherit' });
if (compiler.status !== 0) process.exit(compiler.status ?? 1);
writeFileSync(resolve(output, 'package.json'), '{"type":"commonjs"}\n');
const tests = readdirSync('tests').filter(name => name.endsWith('.test.mjs')).map(name => `tests/${name}`);
if (!tests.length) throw new Error('No tests were found.');
const run = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
process.exit(run.status ?? 1);
