#!/usr/bin/env node
// Refresh OpenAI's published crawler IP ranges.
//
//   npm run refresh:openai
//
// Fetches https://openai.com/{gptbot,chatgpt-user,searchbot}.json, then rewrites
// server/openai-ranges.json, deploy/openai-ip-deny.conf and every generated edge config that
// embeds the ranges. On any network/parse failure it exits non-zero WITHOUT touching files.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { refreshRanges, validateRanges } from '../server/bot-policy.mjs';
import { ROOT, renderAll, writeAll } from './gen-host-configs.mjs';

let ranges;
try {
  ranges = validateRanges(await refreshRanges(globalThis.fetch, { timeoutMs: 20_000 }));
} catch (err) {
  console.error(`refresh:openai failed, no files changed: ${err?.cause?.message ?? err?.message ?? err}`);
  process.exit(1);
}

writeFileSync(path.join(ROOT, 'server/openai-ranges.json'), JSON.stringify(ranges, null, 1) + '\n');
const files = renderAll(ranges);
writeAll(files);
for (const [bot, v] of Object.entries(ranges.bots)) console.log(`${bot}: ${v.prefixes.length} prefixes (creationTime ${v.creationTime})`);
console.log(`wrote server/openai-ranges.json and ${Object.keys(files).length} generated files`);
