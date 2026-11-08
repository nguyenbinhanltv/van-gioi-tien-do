/** Item and currency definitions live in `@vgtd/shared` (the client bag panel needs them too); re-exported here for the server modules and tests. */
export {
  CURRENCIES,
  ITEM_DEFS,
  STONE_CURRENCY,
  isStone,
  itemDefById,
  itemDefByKey,
  type Currency,
  type ItemDef,
  type ItemKind,
} from '@vgtd/shared';
