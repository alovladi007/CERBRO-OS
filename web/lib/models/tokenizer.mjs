// Cerebro OS — BERT WordPiece tokenizer with character offsets, equivalent to the Hugging Face
// `tokenizers` pipeline BertNormalizer (clean text, CJK spacing, lowercase, strip accents) →
// BertPreTokenizer (whitespace and punctuation) → WordPiece (greedy longest match, "##" prefix).
// Offsets index the original string (UTF-16 code units), so entities map back to the text exactly.

const isControl = c => { if (c === '\t' || c === '\n' || c === '\r') return false; return /\p{Cc}|\p{Cf}/u.test(c); };
const isWhitespace = c => c === ' ' || c === '\t' || c === '\n' || c === '\r' || /\p{Zs}/u.test(c);
const isPunct = c => { const cp = c.codePointAt(0); return (cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126) || /\p{P}/u.test(c); };
const isCJK = cp => (cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) || (cp >= 0x20000 && cp <= 0x2A6DF) || (cp >= 0x2A700 && cp <= 0x2B73F)
  || (cp >= 0x2B740 && cp <= 0x2B81F) || (cp >= 0x2B820 && cp <= 0x2CEAF) || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x2F800 && cp <= 0x2FA1F);

export function wordPieceTokenizer(vocabText, { lowercase = true, stripAccents = null, unk = '[UNK]', cls = '[CLS]', sep = '[SEP]', maxCharsPerWord = 100 } = {}) {
  const tokens = vocabText.split(/\r?\n/);
  if (tokens.at(-1) === '') tokens.pop();
  const vocab = new Map(tokens.map((t, i) => [t, i]));
  for (const t of [unk, cls, sep]) if (!vocab.has(t)) throw Error(`Vocabulary has no ${t} token.`);
  const strip = stripAccents ?? lowercase; // as tokenizers' BertNormalizer

  /** Normalise and pre-tokenise into words: [{ chars: string[], origin: number[] (start index), end: number[] }] */
  function words(text) {
    const out = []; let cur = null;
    const flush = () => { if (cur && cur.chars.length) out.push(cur); cur = null; };
    const push = (ch, start, end) => { (cur ??= { chars: [], start: [], end: [] }); cur.chars.push(ch); cur.start.push(start); cur.end.push(end); };
    for (let i = 0; i < text.length;) {
      const cp = text.codePointAt(i), c = String.fromCodePoint(cp), w = c.length, s = i, e = i + w;
      i += w;
      if (cp === 0 || cp === 0xFFFD || isControl(c)) continue;
      if (isWhitespace(c)) { flush(); continue; }
      if (isCJK(cp)) { flush(); push(c, s, e); flush(); continue; }
      let n = lowercase ? c.toLowerCase() : c;
      if (strip) n = n.normalize('NFD').replace(/\p{Mn}/gu, '');
      for (const ch of n) {
        if (isWhitespace(ch)) { flush(); continue; }
        if (isPunct(ch)) { flush(); push(ch, s, e); flush(); } else push(ch, s, e);
      }
    }
    flush();
    return out;
  }

  function wordPiece(word) {
    if (word.chars.length > maxCharsPerWord) return [{ id: vocab.get(unk), token: unk, start: word.start[0], end: word.end.at(-1) }];
    const out = []; let a = 0;
    while (a < word.chars.length) {
      let b = word.chars.length, hit = null;
      while (a < b) {
        const piece = (a > 0 ? '##' : '') + word.chars.slice(a, b).join('');
        if (vocab.has(piece)) { hit = piece; break; }
        b--;
      }
      if (!hit) return [{ id: vocab.get(unk), token: unk, start: word.start[0], end: word.end.at(-1) }];
      out.push({ id: vocab.get(hit), token: hit, start: word.start[a], end: word.end[b - 1] });
      a = b;
    }
    return out;
  }

  /** Tokens without special tokens: [{ id, token, start, end }]. */
  function tokenize(text) { return words(text).flatMap(wordPiece); }

  /**
   * Encode for a model with a maximum sequence length: splits into windows of at most
   * maxLength − 2 word pieces, never inside a word, each wrapped in [CLS] … [SEP].
   */
  function encode(text, { maxLength = 512 } = {}) {
    const ws = words(text).map(wordPiece), room = maxLength - 2, windows = [];
    let cur = [];
    for (const w of ws) {
      if (cur.length + w.length > room && cur.length) { windows.push(cur); cur = []; }
      for (let k = 0; k < w.length; k += room) { cur.push(...w.slice(k, k + room)); if (cur.length >= room) { windows.push(cur); cur = []; } }
    }
    if (cur.length || !windows.length) windows.push(cur);
    return windows.map(t => ({
      ids: [vocab.get(cls), ...t.map(x => x.id), vocab.get(sep)],
      tokens: [cls, ...t.map(x => x.token), sep],
      offsets: [[0, 0], ...t.map(x => [x.start, x.end]), [0, 0]],
      special: [true, ...t.map(() => false), true],
    }));
  }
  return { tokenize, encode, size: tokens.length, idToToken: i => tokens[i] };
}
