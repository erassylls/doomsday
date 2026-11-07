#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const [dataset, file] = args;
if (!['dev', 'prod'].includes(dataset) || !file || (args.length !== 2 && !(args.length === 4 && args[2] === '--source'))) {
  console.error('Использование: npm run validate:submission -- dev|prod путь/results.json [--source исходный-набор.json]');
  process.exit(2);
}

function readJson(path, label) {
  const bytes = readFileSync(resolve(path));
  if (bytes.length > 48 * 1024 * 1024) throw new Error(`${label}: файл больше 48 МБ.`);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  try { return JSON.parse(text); } catch { throw new Error(`${label}: требуется корректный JSON в UTF-8 без комментариев и лишних запятых.`); }
}

try {
  const value = readJson(file, 'Результаты');
  let conversations;
  if (args[3]) {
    const source = readJson(args[3], 'Исходный набор');
    if (source && !Array.isArray(source) && 'isSuccess' in source && source.isSuccess !== true) throw new Error('Исходный набор содержит неуспешный ответ API.');
    const envelope = Array.isArray(source) ? undefined : source?.data ?? source;
    const records = Array.isArray(source) ? source : envelope?.records;
    if (!Array.isArray(records)) throw new Error('В исходном наборе нужен массив диалогов или data.records.');
    if (envelope?.total_records !== undefined && envelope.total_records !== records.length) throw new Error('Исходный набор неполон: total_records не совпадает с длиной records.');
    if (records.some((item) => !item || typeof item.conversation_id !== 'string' || !item.conversation_id.trim() || !['agent chat', 'voice call'].includes(item.channel) || !Array.isArray(item.transcript) || !item.transcript.length)) throw new Error('В каждой исходной записи нужны conversation_id, channel и непустой transcript.');
    conversations = records.map(({ conversation_id, channel, transcript }) => ({ conversation_id, channel, transcript }));
  }

  const output = resolve(root, '.sites-runtime/submission-build');
  mkdirSync(output, { recursive: true });
  const compilation = spawnSync(process.execPath, [
    resolve(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'commonjs',
    '--moduleResolution', 'node', '--esModuleInterop', '--skipLibCheck', '--strict', '--outDir', output,
    resolve(root, 'lib/submission.ts'),
  ], { cwd: root, encoding: 'utf8' });
  if (compilation.status !== 0) throw new Error(`Не удалось подготовить валидатор. Выполните npm ci и npm run typecheck.\n${compilation.stdout || compilation.stderr || ''}`);
  writeFileSync(resolve(output, 'package.json'), '{"type":"commonjs"}\n');
  const require = createRequire(import.meta.url);
  const { validateSubmission, SUBMISSION_DATASETS } = require(resolve(output, 'submission.js'));
  const report = validateSubmission(value, { dataset, ...(conversations ? { conversations } : {}) });
  console.log(`${dataset.toUpperCase()} → ${SUBMISSION_DATASETS[dataset].path}`);
  for (const issue of report.issues) console.error(`ОШИБКА [${issue.code}]: ${issue.message}`);
  for (const issue of report.warnings) console.warn(`ПРЕДУПРЕЖДЕНИЕ [${issue.code}]: ${issue.message}`);
  if (!report.valid) {
    console.error(`Проверка не пройдена. Ошибок: ${report.issues.length}.`);
    process.exitCode = 1;
  } else {
    const errors = value.results.filter((item) => item.status === 'error').length;
    console.log(`Формат корректен. Записей: ${value.results.length}; с оценкой: ${value.results.length - errors}; status=error: ${errors}.`);
    console.log(conversations ? 'ID, состав набора и номера реплик сверены с локальным исходным файлом.' : 'Исходный набор не передан: совпадение ID с API и границы номеров реплик не проверены.');
    console.log('Проверка не выполняет commit или push и не подтверждает приём организаторами.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Не удалось проверить файл.');
  process.exitCode = 2;
}
