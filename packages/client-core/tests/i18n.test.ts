import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  allSupportedGlyphs,
  format,
  formatNumber,
  getLocale,
  hasKey,
  placeholdersOf,
  pseudoLocalize,
  resetStrings,
  setStrings,
  sourceStrings,
  t,
  unsupportedGlyphs,
  type StringKey,
} from '../src/index.js';

afterEach(() => resetStrings());

describe('t(key, params)', () => {
  it('returns the Vietnamese source text and fills named placeholders', () => {
    expect(t('chat.reason.rate_limited')).toBe('Bạn nói quá nhanh, hãy chờ giây lát.');
    expect(t('party.event.you_joined', { leader: 'Lan', size: 2, max: 5 })).toBe('Bạn đã vào tổ đội của Lan (2/5).');
    expect(t('chat.line.whisper', { channel: 'Thì thầm', from: 'bạn', to: 'Minh', text: 'chào' })).toBe('[Thì thầm] bạn → Minh: chào');
  });

  it('keeps an unfilled placeholder visible and ignores extra params', () => {
    expect(format('Xin chào {name}, {n} tin', { n: 3 })).toBe('Xin chào {name}, 3 tin');
    expect(t('chat.reason.empty', { unused: 1 })).toBe('Tin trống.');
  });

  it('lists the placeholders of a template once each, in order', () => {
    expect(placeholdersOf('{a} và {b}, lại {a}')).toEqual(['a', 'b']);
    expect(placeholdersOf('không có')).toEqual([]);
  });

  it('a key missing from an installed table falls back to the Vietnamese source', () => {
    setStrings({ 'chat.reason.empty': 'Empty message.' }, 'en');
    expect(getLocale()).toBe('en');
    expect(t('chat.reason.empty')).toBe('Empty message.');
    expect(t('chat.reason.muted')).toBe(sourceStrings()['chat.reason.muted']);
    resetStrings();
    expect(getLocale()).toBe('vi-VN');
    expect(t('chat.reason.empty')).toBe('Tin trống.');
  });

  it('a key unknown to both tables returns the key and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bogus = 'no.such.key' as StringKey;
    expect(t(bogus)).toBe('no.such.key');
    expect(t(bogus)).toBe('no.such.key');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    expect(hasKey('chat.reason.empty')).toBe(true);
    expect(hasKey('no.such.key')).toBe(false);
  });
});

describe('pseudo-localization (docs/19 §2.4)', () => {
  it('makes every text longer, accented and bracketed without touching the placeholders', () => {
    const src = sourceStrings();
    const pseudo = pseudoLocalize(src);
    expect(Object.keys(pseudo)).toEqual(Object.keys(src));
    for (const [k, v] of Object.entries(src)) {
      const p = pseudo[k]!;
      expect(p.startsWith('[! ') && p.endsWith(' !]'), k).toBe(true);
      expect(p.length, k).toBeGreaterThan(v.length);
      expect(placeholdersOf(p), k).toEqual(placeholdersOf(v));
    }
  });

  it('installed as the language, t() shows the pseudo text with the parameters filled', () => {
    setStrings(pseudoLocalize(sourceStrings()), 'pseudo');
    expect(t('chat.err.usage_name', { cmd: 'w' })).toMatch(/^\[! .*\/w.* !\]$/);
    expect(t('chat.err.usage_name', { cmd: 'w' })).not.toContain('{cmd}');
  });
});

describe('formatNumber (docs/19 §2.3)', () => {
  it('uses the vi-VN separators through Intl', () => {
    expect(formatNumber(1200)).toBe(new Intl.NumberFormat('vi-VN').format(1200));
    expect(formatNumber(0.6, 1)).toBe(new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(0.6));
  });
});

describe('glyph set', () => {
  it('accepts ASCII and Vietnamese, reports anything else once', () => {
    expect(unsupportedGlyphs('Đả tọa [M] — Kiếm tu · 90% → ✓')).toEqual([]);
    expect(unsupportedGlyphs('abc 漢 漢 \u{1F600}')).toEqual(['漢', '\u{1F600}']);
  });

  it('normalizes decomposed text before checking', () => {
    expect(unsupportedGlyphs('ế'.normalize('NFD'))).toEqual([]);
  });

  it('the full sheet has every supported glyph (ASCII, 146 letter forms, symbols)', () => {
    const sheet = allSupportedGlyphs();
    for (const ch of 'aàảãáạăằẳẵắặâầẩẫấậeèẻẽéẹêềểễếệiìỉĩíịoòỏõóọôồổỗốộơờởỡớợuùủũúụưừửữứựyỳỷỹýỵđĐ') expect(sheet).toContain(ch);
    expect(unsupportedGlyphs(sheet)).toEqual([]);
  });
});
