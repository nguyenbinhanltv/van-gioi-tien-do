/**
 * Glyph set of the player-facing text (D104): the shared label atlas draws glyph by glyph (docs/19 §3), so the character set is a
 * contract. Everything the string table may contain is printable ASCII, the Vietnamese letters (12 vowels x 6 tone forms, plus đ,
 * upper and lower case: 146 precomposed NFC characters) and a short list of symbols. A string with anything else is a test failure
 * (`tests/i18n-guard.test.ts`), not a surprise box in the HUD.
 */

/** The five tone marks as combining characters: huyền, sắc, hỏi, ngã, nặng. */
const TONES = ['̀', '́', '̉', '̃', '̣'] as const;
const VOWELS = ['a', 'ă', 'â', 'e', 'ê', 'i', 'o', 'ô', 'ơ', 'u', 'ư', 'y'] as const;

function buildVietnameseLetters(): string[] {
  const out: string[] = [];
  for (const upper of [false, true]) {
    for (const v of VOWELS) {
      const base = upper ? v.toUpperCase() : v;
      out.push(base.normalize('NFC'));
      for (const tone of TONES) out.push((base + tone).normalize('NFC'));
    }
    out.push(upper ? 'Đ' : 'đ');
  }
  return out;
}

/** Every Vietnamese letter that carries a diacritic or is đ / Đ, plus the unmarked vowels, as NFC single characters (146). */
export const VIETNAMESE_LETTERS: readonly string[] = buildVietnameseLetters();

/** Symbols the UI uses next to letters: middle dot, dashes, ellipsis, arrows, multiplication, comparison, star, bullet, degree. */
export const SUPPORTED_SYMBOLS = '·—–…→←↑↓×±≥≤°•★✓';

const PRINTABLE_ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(0x20 + i)).join('');

/** All characters a string of the table may use (newline allowed for multi-line texts). */
export const SUPPORTED_GLYPHS: ReadonlySet<string> = new Set([
  ...PRINTABLE_ASCII,
  ...VIETNAMESE_LETTERS,
  ...SUPPORTED_SYMBOLS,
  '\n',
]);

/** Characters of `text` outside the supported set (each listed once), after NFC normalization. */
export function unsupportedGlyphs(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text.normalize('NFC')) if (!SUPPORTED_GLYPHS.has(ch)) bad.add(ch);
  return [...bad];
}

/** One string with every supported glyph (for the `?glyphs=1` sheet and the coverage smoke test), ASCII first. */
export function allSupportedGlyphs(): string {
  return PRINTABLE_ASCII + VIETNAMESE_LETTERS.join('') + SUPPORTED_SYMBOLS;
}
