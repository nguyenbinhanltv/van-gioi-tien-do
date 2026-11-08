/**
 * Text hygiene for chat lines. Pure functions, no state.
 *  - `sanitize`: control characters become spaces, invisible / bidirectional-override characters are dropped (they spoof other players'
 *    names and hide text), runs of spaces collapse, the line is trimmed.
 *  - `maskBanned`: replaces every occurrence of a banned word with `*` per character. Matching ignores case and diacritics (Vietnamese
 *    "đ" counts as "d", "ạ" as "a"), so "CursewordX" and "cursẹwordx" are both caught, and the mask lands on the ORIGINAL characters.
 */

/* eslint-disable no-control-regex, no-misleading-character-class -- intentional: these patterns exist to match control and combining / invisible characters */
/** C0 / C1 controls (incl. newline, tab, DEL) */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;
/** zero-width, bidi marks / overrides / isolates, BOM, word joiner and similar invisible characters */
const INVISIBLE =
  /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/gu;

/* eslint-enable no-control-regex, no-misleading-character-class */

export function sanitize(text: string): string {
  return text.replace(CONTROL, ' ').replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
}

/** Lowercase base letter(s) of one code point: strips combining marks, maps đ to d. */
function fold(cp: string): string {
  const base = cp
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
  return base.replace(/đ/gu, 'd');
}

export function maskBanned(text: string, banned: readonly string[]): string {
  const words = banned.map((w) => Array.from(w).map(fold).join('')).filter((w) => w.length > 0);
  if (!words.length) return text;
  const cps = Array.from(text);
  let folded = '';
  const owner: number[] = []; // folded char index -> original code point index
  cps.forEach((cp, k) => {
    for (const ch of fold(cp)) {
      for (let u = 0; u < ch.length; u++) owner.push(k);
      folded += ch;
    }
  });
  const masked = new Set<number>();
  for (const w of words) {
    for (let at = folded.indexOf(w); at >= 0; at = folded.indexOf(w, at + 1))
      for (let k = at; k < at + w.length; k++) masked.add(owner[k]!);
  }
  return masked.size ? cps.map((cp, k) => (masked.has(k) ? '*' : cp)).join('') : text;
}
