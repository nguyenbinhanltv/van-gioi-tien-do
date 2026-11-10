/**
 * Static item definitions (D77, docs/23 §4.3, docs/26 §3.1), shared by the server (drop sink, bag) and the client (bag panel).
 *
 * Item KINDS follow docs/26 §3.1: STACKABLE (materials, ordinary pills) are counted per `(defId, quality)`; INSTANCE items
 * (equipment, blueprints of any quality) are one record each with quality, durability and affixes. Stones are NOT items:
 * they are currency and live in the ledger (`LT_HA` / `LT_TRUNG` / `LT_THUONG`).
 *
 * Stack limits, the quality dimension of a stack and the item ids are PLACEHOLDERS (no doc fixes them): they are listed in
 * docs/OPEN-ITEMS.md. Ids are the stable wire/storage ids; never renumber.
 */
import { STONE_ITEMS } from './formulas/drops.js';
import type { DropItem } from './formulas/economy.js';

/** Items that exist only as the product of crafting (D108): no drop table gives them. */
export type CraftedItemKey = 'ho_mach_pill' | 'dinh_tam_pill';
export type ItemKey = DropItem | CraftedItemKey;

export type ItemKind = 'stackable' | 'instance';

export interface ItemDef {
  /** stable id (u16) */
  id: number;
  key: ItemKey;
  kind: ItemKind;
  /** stackables only: max quantity per bag slot */
  stackLimit: number;
  /** may be traded (docs/26 §3.1 "có thể giao dịch"); false = bound on pickup */
  tradable: boolean;
}

/** The non-stone drop items of docs/07 §6 (`DropItem`). */
export const ITEM_DEFS: readonly ItemDef[] = [
  { id: 1, key: 'heal_pill', kind: 'stackable', stackLimit: 99, tradable: true },
  { id: 2, key: 'breakthrough_pill', kind: 'stackable', stackLimit: 99, tradable: true },
  { id: 3, key: 'blueprint_white_green', kind: 'instance', stackLimit: 1, tradable: true },
  { id: 4, key: 'blueprint_blue_purple', kind: 'instance', stackLimit: 1, tradable: true },
  { id: 5, key: 'blueprint_gold_red', kind: 'instance', stackLimit: 1, tradable: true },
  { id: 6, key: 'craft_material', kind: 'stackable', stackLimit: 999, tradable: true },
  /** support pills of docs/07 §2 / docs/13 §5.2 (D108): crafted only; no effect is defined for them yet, so they cannot be used */
  { id: 7, key: 'ho_mach_pill', kind: 'stackable', stackLimit: 99, tradable: true },
  { id: 8, key: 'dinh_tam_pill', kind: 'stackable', stackLimit: 99, tradable: true },
];

/** Items the player can use from the bag (`inv_cmd` op Use, D90). */
export const USABLE_ITEM_KEYS: readonly string[] = ['heal_pill', 'breakthrough_pill'];
export const isUsableItem = (key: string | undefined): boolean => key !== undefined && USABLE_ITEM_KEYS.includes(key);

export function itemDefByKey(key: ItemKey): ItemDef | undefined {
  return ITEM_DEFS.find((d) => d.key === key);
}
export function itemDefById(id: number): ItemDef | undefined {
  return ITEM_DEFS.find((d) => d.id === id);
}

/** The three in-game stone currencies (docs/26 §2.1). Real-money / event / sect currencies are out of scope here. */
export type Currency = 'LT_HA' | 'LT_TRUNG' | 'LT_THUONG';
export const CURRENCIES: readonly Currency[] = ['LT_HA', 'LT_TRUNG', 'LT_THUONG'];

/** Which currency a stone drop pays in (one stone = one unit of that currency). */
export const STONE_CURRENCY: Readonly<Record<string, Currency>> = {
  stone_ha: 'LT_HA',
  stone_trung: 'LT_TRUNG',
  stone_thuong: 'LT_THUONG',
};
export const isStone = (item: DropItem): boolean => STONE_ITEMS.includes(item);
