/**
 * The library (kho bí tịch, "Tàng Kinh Các") of Sơn Môn Đại Phái (D98): the skill manuals a character of a class can buy with Cống hiến.
 * docs/11 §5: the skills a class does not get from its level are learned from a manual (`unlock.source` = "tome"), and "bí tịch cơ bản mua
 * được ở Sơn Môn"; the data marks five such skills per class (levels 20 / 31 / 40 / 51 / 65). The docs give no price for basic manuals, so
 * the price is `SECT.MANUAL_PRICE_PER_LEVEL` x the skill's `unlock.level_min` (PROVISIONAL, D98).
 */
import { SECT, skillDefinitions, type PathId } from '@vgtd/shared';

export interface LibraryManual {
  /** index in this class's library: what `sect_cmd` Buy carries */
  index: number;
  /** data id of the skill the manual teaches */
  skillId: string;
  /** readable name (the data only has i18n keys; see OPEN-ITEMS D98) */
  name: string;
  levelMin: number;
  price: number;
}

/** "kim_quang_quet" -> "Kim Quang Quet": the skill id made readable until the i18n table exists. */
export function readableSkillName(id: string): string {
  return id
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const manualPrice = (levelMin: number): number => levelMin * SECT.MANUAL_PRICE_PER_LEVEL;

const cache = new Map<PathId, readonly LibraryManual[]>();

/** The manuals of a class, in data order (stable for a given data version), at most `SECT.MAX_MANUALS`. */
export function libraryOf(path: PathId): readonly LibraryManual[] {
  let lib = cache.get(path);
  if (!lib) {
    lib = skillDefinitions.skills
      .filter((s) => s.path === path && s.unlock.source === 'tome')
      .slice(0, SECT.MAX_MANUALS)
      .map((s, index) => ({
        index,
        skillId: s.id,
        name: readableSkillName(s.id.includes('.') ? s.id.slice(s.id.lastIndexOf('.') + 1) : s.id),
        levelMin: s.unlock.level_min,
        price: manualPrice(s.unlock.level_min),
      }));
    cache.set(path, lib);
  }
  return lib;
}
