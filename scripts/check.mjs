#!/usr/bin/env node
// Syntax-check every .js/.mjs file under web/, server/, scripts/, deploy/, netlify/ and tests/
// with `node --check` (portable replacement for a shell glob).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['web', 'server', 'scripts', 'deploy', 'netlify', 'tests'];
const SKIP = new Set(['node_modules', '.git']);

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(m?js)$/.test(e.name)) yield p;
  }
}

const files = DIRS.flatMap(d => [...walk(path.join(ROOT, d))]).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`FAIL ${path.relative(ROOT, f)}\n${r.stderr.trim()}\n`);
  }
}
console.log(`${files.length - failed}/${files.length} files passed node --check`);
process.exit(failed ? 1 : 0);
