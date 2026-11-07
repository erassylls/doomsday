import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync('dist/server/wrangler.json')) {
  console.log('Building the Worker and local database configuration...');
  run(['scripts/run-framework.mjs', 'build']);
}
mkdirSync('.sites-runtime', { recursive: true });
const tracker = '.sites-runtime/local-migrations.json';
const done = new Set(existsSync(tracker) ? JSON.parse(readFileSync(tracker, 'utf8')) : []);
for (const file of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
  if (done.has(file)) continue;
  console.log(`Applying local migration ${file}`);
  run(['--import', './scripts/sites-env.mjs', 'node_modules/wrangler/bin/wrangler.js',
    'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json',
    '--persist-to', '.wrangler/state', '--file', resolve('drizzle', file)]);
  done.add(file);
  writeFileSync(tracker, JSON.stringify([...done], null, 2));
}
console.log('Local database is ready. Start the application with npm run dev.');
