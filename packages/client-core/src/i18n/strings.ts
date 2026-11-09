import { viVN } from './vi-VN.js';

/**
 * Player-facing text (D104, docs/19 §2): Vietnamese is the source language; every string a player can read comes from the table
 * behind `t(key, params)`, never from a literal in the code. Keys are stable `domain.sub.name` identifiers (lower case, dots); a
 * key is never reused for a different meaning. Placeholders are named, `{name}`, so another language can reorder words; text is
 * never built by concatenating pieces. The server sends codes, the client turns them into text here (`chatReasonText`, ...).
 *
 * Tables are plain JSON (`vi-VN.json`, one flat object) so translators and tests read them without the code. A second language is a
 * second table with the same keys, installed with `setStrings`; `pseudoLocalize` makes a long, accented, bracketed copy of any table
 * to find clipped or concatenated text (docs/19 §2.4).
 */

/** Every key of the source table (`vi-VN.json`): `t('typo')` is a compile error. */
export type StringKey = keyof typeof viVN;
/** Values of `{name}` placeholders. */
export type StringParams = Readonly<Record<string, string | number>>;
export type StringTable = Readonly<Record<string, string>>;

let current: StringTable = viVN;
let currentLocale = 'vi-VN';

/** Locale code of the installed table. */
export function getLocale(): string {
  return currentLocale;
}

/** The source (Vietnamese) table. */
export function sourceStrings(): StringTable {
  return viVN;
}

/** Install a table (another language, or a pseudo-localized copy for tests). Missing keys fall back to the Vietnamese source. */
export function setStrings(table: StringTable, locale: string): void {
  current = table;
  currentLocale = locale;
}

/** Back to the Vietnamese source table. */
export function resetStrings(): void {
  current = viVN;
  currentLocale = 'vi-VN';
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Names of the `{placeholders}` of a template. */
export function placeholdersOf(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** Fills `{name}` placeholders; a placeholder without a value stays visible (`{name}`) so a missing parameter shows up in play-tests. */
export function format(template: string, params?: StringParams): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

const warned = new Set<string>();

/**
 * The text of `key` in the installed language, with `{placeholders}` filled from `params`. A key missing from the installed table
 * falls back to the Vietnamese source; a key missing from both (only possible when the type check was bypassed) returns the key
 * itself and warns once.
 */
export function t(key: StringKey, params?: StringParams): string {
  const text = current[key] ?? (viVN as StringTable)[key];
  if (text === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing string key: ${key}`);
    }
    return key;
  }
  return format(text, params);
}

/** `t` for a key that is only known at run time (a code from the wire mapped to a key); false when the key does not exist. */
export function hasKey(key: string): key is StringKey {
  return key in viVN;
}

/**
 * Pseudo-localization of a table (docs/19 §2.4): every letter gets an accent, the text is about 40 % longer and wrapped in
 * `[! ... !]`; `{placeholders}` are kept intact. Install with `setStrings(pseudoLocalize(sourceStrings()), 'pseudo')`.
 */
export function pseudoLocalize(table: StringTable): StringTable {
  const map: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(table)) {
    let s = '';
    let depth = 0;
    for (const ch of v) {
      if (ch === '{') depth++;
      s += depth > 0 ? ch : (map[ch] ?? ch);
      if (ch === '}') depth = Math.max(0, depth - 1);
    }
    const pad = '·'.repeat(Math.ceil(v.length * 0.4));
    out[k] = `[! ${s}${pad} !]`;
  }
  return out;
}

/** Number text in the installed language (docs/19 §2.3: `vi-VN`, "1.200", "0,6"); `Intl` is used, never hand-made separators. */
export function formatNumber(n: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(currentLocale === 'pseudo' ? 'vi-VN' : currentLocale, { maximumFractionDigits }).format(n);
}
