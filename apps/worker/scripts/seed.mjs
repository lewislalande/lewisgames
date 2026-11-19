// Seeds the D1 database `kgames` with the question bank and the default Pictionary words.
// Usage: node scripts/seed.mjs (--local | --remote) [questions.json]
// Idempotent: INSERT OR IGNORE, so existing rows are left untouched.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSql } from './seed-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(here, '..');
const args = process.argv.slice(2);
const mode = args.includes('--remote') ? '--remote' : args.includes('--local') ? '--local' : null;
if (!mode || (args.includes('--remote') && args.includes('--local'))) {
  console.error('Usage: node scripts/seed.mjs (--local | --remote) [questions.json]');
  process.exit(2);
}
const file = args.find((a) => !a.startsWith('--')) ?? join(workerDir, 'seed/questions-fr.json');
const questions = JSON.parse(readFileSync(file, 'utf8'));
const words = JSON.parse(readFileSync(resolve(workerDir, '../../packages/shared/src/pictionary/words-fr.json'), 'utf8'));

const { sql, questionCount, wordCount, errors } = buildSql({ questions, words });
for (const e of errors) console.warn(`question #${e.index + 1} ignorée : ${e.reason}`);
console.log(`${questionCount} questions et ${wordCount} mots à insérer (${errors.length} ignorée(s)), cible ${mode.slice(2)}`);

const dir = mkdtempSync(join(tmpdir(), 'kgames-seed-'));
const sqlFile = join(dir, 'seed.sql');
writeFileSync(sqlFile, sql);
try {
  const r = spawnSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'kgames', mode, '--file', sqlFile], { cwd: workerDir, stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
