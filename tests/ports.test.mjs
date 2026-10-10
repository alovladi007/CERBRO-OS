// Guards against port collisions with the other platforms on the host (see docs/PORTS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
export const RESERVED = [3010, 4040, 4041, 4100, 4200, 4300, 4400, 4500, 4600,
  8000, 8004, 8005, 8010, 8011, 8012, 8013, 8014, 8015, 8021, 8022, 8023, 8030, 8040, 8050, 8060, 8080, 8090, 8100, 8110, 8120, 8200, 8300, 8400, 8500, 8600, 8800,
  5434, 5441, 5442, 5443, 5445, 6381, 6392, 6393, 6394,
  9004, 9005, 9250, 9650, 9092, 29092, 7474, 7687, 6333, 16686, 4317, 4318,
  55434, 56381, 58000, 3100, 9100];

// Files that configure, run or document ports. Generated IP lists and docs/PORTS.md itself are excluded.
const SCAN = ['package.json', 'Dockerfile', 'netlify.toml', 'vercel.json', 'README.md', 'server', 'deploy', 'scripts', 'docs', '.github'];
const SKIP = new Set(['docs/PORTS.md', 'deploy/openai-ip-deny.conf']);
const files = p => statSync(p).isDirectory() ? readdirSync(p).flatMap(f => files(join(p, f))) : [p];
// Port-shaped contexts: ":8080", "PORT=8080", "PORT: \"8080\"", "port 8080", "EXPOSE 8080", "containerPort: 8080".
const PORT_CTX = /(?:(?<![\d.]):|port\s*[=:]?\s*["']?|EXPOSE\s+|listen\s+(?:\[::\]:)?|\|\|\s*)(\d{4,5})\b/gi;

test('no reserved host ports are used anywhere in configuration, scripts or docs', () => {
  const hits = [];
  for (const entry of SCAN) {
    let paths;
    try { paths = files(join(ROOT, entry)); } catch { continue; }
    for (const p of paths) {
      const rel = relative(ROOT, p);
      if (SKIP.has(rel) || /\.(png|jpg|ico)$/.test(rel)) continue;
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(PORT_CTX)) if (RESERVED.includes(Number(m[1]))) hits.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, [], `Reserved ports found:\n${hits.join('\n')}`);
});

test('server and dev defaults are in the 4700 block on loopback', () => {
  const server = readFileSync(join(ROOT, 'server/server.mjs'), 'utf8'), pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.match(server, /process\.env\.PORT \|\| 4700/);
  assert.match(server, /process\.env\.HOST \|\| '127\.0\.0\.1'/);
  assert.match(pkg.scripts.dev, /PORT=4701/);
  const compose = readFileSync(join(ROOT, 'deploy/docker-compose.yml'), 'utf8');
  for (const m of compose.matchAll(/^\s*-\s*"([^"]+)"/gm)) if (/^\d|127/.test(m[1])) assert.match(m[1], /^127\.0\.0\.1:47\d\d:\d+$/, `compose port must be fixed and loopback-bound: ${m[1]}`);
});
