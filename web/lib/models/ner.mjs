// Cerebro OS — token-classification post-processing, equivalent to the Hugging Face
// TokenClassificationPipeline:
//  • "simple": arg-max label per word piece, then consecutive pieces are grouped while the entity
//    type continues (a "B-" tag or a new type starts a group); group score = mean piece score;
//  • "first": pieces are first merged into words and each word takes the label of its first piece
//    (word-level output, usually easier to read), then grouped the same way.
// "O" groups are dropped. Offsets index the original text.

function softmax(row) { const m = Math.max(...row); const e = row.map(v => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0); return e.map(v => v / s); }
const tagOf = label => (label.startsWith('B-') ? ['B', label.slice(2)] : label.startsWith('I-') ? ['I', label.slice(2)] : ['I', label]);
const argmax = p => { let k = 0; p.forEach((v, j) => { if (v > p[k]) k = j; }); return k; };

/** WordPiece tokens back to a string, as transformers' convert_tokens_to_string for BERT. */
export function tokensToString(tokens) { return tokens.join(' ').replace(/ ##/g, '').trim(); }

function groupEntities(items, text) {
  const groups = []; let cur = [];
  const close = () => {
    if (!cur.length) return;
    const lab = cur[0].entity, entity = lab.includes('-') ? lab.slice(lab.indexOf('-') + 1) : lab;
    groups.push({ entity, score: cur.reduce((s, e) => s + e.score, 0) / cur.length, start: cur[0].start, end: cur.at(-1).end, word: tokensToString(cur.flatMap(e => e.tokens)), text: text.slice(cur[0].start, cur.at(-1).end) });
    cur = [];
  };
  for (const e of items) {
    if (!cur.length) { cur.push(e); continue; }
    const [bi, tag] = tagOf(e.entity), [, lastTag] = tagOf(cur.at(-1).entity);
    if (tag === lastTag && bi !== 'B') cur.push(e); else { close(); cur.push(e); }
  }
  close();
  return groups.filter(g => g.entity !== 'O');
}

/**
 * window: { tokens, offsets, special } from the tokenizer; logits: one row per token.
 * Returns entities [{ entity, score, start, end, word, text }].
 */
export function aggregate(window, logits, id2label, text = '', strategy = 'simple') {
  const pre = [];
  window.tokens.forEach((tok, i) => {
    if (window.special[i]) return;
    const [start, end] = window.offsets[i];
    pre.push({ token: tok, start, end, scores: softmax(logits[i]), subword: tok.length !== text.slice(start, end).length });
  });
  if (strategy === 'simple') return groupEntities(pre.map(p => { const k = argmax(p.scores); return { entity: id2label[k], score: p.scores[k], start: p.start, end: p.end, tokens: [p.token] }; }), text);
  if (strategy !== 'first') throw Error(`Unknown aggregation strategy: ${strategy}`);
  const words = [];
  for (const p of pre) { if (p.subword && words.length) words.at(-1).push(p); else words.push([p]); }
  return groupEntities(words.map(w => { const k = argmax(w[0].scores); return { entity: id2label[k], score: w[0].scores[k], start: w[0].start, end: w.at(-1).end, tokens: w.map(p => p.token) }; }), text);
}
