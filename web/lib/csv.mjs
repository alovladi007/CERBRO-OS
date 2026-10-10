// Cerebro OS — tabular parsing (RFC 4180 quoting, delimiter auto-detection).

export function detectDelimiter(text) {
  const sample = text.slice(0, 20000), counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let quoted = false;
  for (const c of sample) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c in counts) counts[c]++;
    else if (!quoted && c === '\n') break;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

export function parseCSV(text, { delimiter } = {}) {
  text = text.replace(/^﻿/, '');
  const sep = delimiter || detectDelimiter(text), rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === sep && !quoted) { row.push(value.trim()); value = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = ''; }
    else value += c;
  }
  if (quoted) throw Error('Unclosed quote in CSV.');
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw Error('Include a header row and at least one data row.');
  if (new Set(rows[0]).size !== rows[0].length || rows[0].some(x => !x)) throw Error('Column names must be unique and nonempty.');
  const bad = rows.findIndex(r => r.length !== rows[0].length);
  if (bad >= 0) throw Error(`Every row must have the same number of columns (row ${bad + 1} has ${rows[bad].length}, header has ${rows[0].length}).`);
  return { headers: rows[0], rows: rows.slice(1), delimiter: sep };
}

/** Infer column types: numeric, categorical, or text. */
export function profileColumns({ headers, rows }) {
  return headers.map((name, i) => {
    const vals = rows.map(r => r[i]), present = vals.filter(v => v !== '' && !/^(na|n\/a|nan|null|none|\.)$/i.test(v));
    const numeric = present.filter(v => Number.isFinite(Number(v)));
    const unique = new Set(present).size;
    const isBinary = present.length && present.every(v => v === '0' || v === '1');
    const type = isBinary ? 'binary' : present.length && numeric.length / present.length >= 0.95 ? 'numeric' : unique <= Math.max(20, rows.length * 0.2) ? 'categorical' : 'text';
    return { index: i, name, type, missing: vals.length - present.length, unique, nonNumeric: present.length - numeric.length };
  });
}

export function toCSV(headers, rows) {
  const cell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [headers, ...rows].map(r => r.map(cell).join(',')).join('\n');
}
