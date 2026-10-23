#!/usr/bin/env node
// Download the weights listed in web/models/registry.json from their pinned source revision into
// web/models/<id>/, verifying every file's SHA-256. Weights are not committed to git (size), so run
// this once before serving or deploying if you want models to load from the site itself.
// Without it, users can still choose the model file from their own device in the app.
//   node scripts/fetch-models.mjs           download missing files, verify all
//   node scripts/fetch-models.mjs --check   verify only (exit 1 on a mismatch; missing weights are reported)
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const reg = JSON.parse(readFileSync(path.join(ROOT, 'web', 'models', 'registry.json'), 'utf8'));
const sha = buf => createHash('sha256').update(buf).digest('hex');
let bad = 0;
for (const m of reg.models) {
  const dir = path.join(ROOT, 'web', 'models', m.id);
  mkdirSync(dir, { recursive: true });
  for (const f of m.files) {
    const p = path.join(dir, f.name);
    if (existsSync(p)) {
      const ok = sha(readFileSync(p)) === f.sha256;
      console.log(`${ok ? 'ok      ' : 'MISMATCH'} ${m.id}/${f.name}`);
      if (!ok) bad++;
      continue;
    }
    if (f.bundled) { console.log(`MISSING  ${m.id}/${f.name} (should be committed)`); bad++; continue; }
    if (check) { console.log(`absent   ${m.id}/${f.name} (run npm run fetch:models)`); continue; }
    const url = `https://huggingface.co/${m.source.repo}/resolve/${m.source.revision}/${f.sourcePath}`;
    process.stdout.write(`fetch    ${m.id}/${f.name} (${(f.bytes / 1e6).toFixed(1)} MB) … `);
    const r = await fetch(url);
    if (!r.ok) throw Error(`${url}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (sha(buf) !== f.sha256) throw Error(`SHA-256 mismatch for ${url}; file not saved.`);
    writeFileSync(p + '.part', buf); renameSync(p + '.part', p);
    console.log('verified');
  }
}
if (bad) { console.error(`${bad} file(s) failed verification.`); process.exit(1); }
