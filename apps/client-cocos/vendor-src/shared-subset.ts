/**
 * Engine-safe subset of @vgtd/shared bundled for Cocos: constants, iso math, formulas.
 * Deliberately excludes `data`, `schemas` and `validators` (they pull in ajv, which
 * needs `new Function` and is pointless on the client). Source stays in packages/shared.
 */
export * from '../../../packages/shared/src/constants.js';
export * from '../../../packages/shared/src/iso.js';
export * from '../../../packages/shared/src/formulas/stats.js';
export * from '../../../packages/shared/src/formulas/breakthrough.js';
export * from '../../../packages/shared/src/formulas/karma.js'; // Nghiệp Lực band / Đạo Tâm (D103)
export * from '../../../packages/shared/src/formulas/tribulation.js';
export * from '../../../packages/shared/src/formulas/combat.js';
export * from '../../../packages/shared/src/formulas/cultivation.js';
export * from '../../../packages/shared/src/formulas/economy.js';
export * from '../../../packages/shared/src/formulas/skills.js'; // class skill kits (D49) for the combat HUD
export * from '../../../packages/shared/src/items.js'; // item / currency definitions for the bag panel (D79)
export * from '../../../packages/shared/src/mob-layout.js'; // tier bands / default mob area (D83)
export * from '../../../packages/shared/src/first-session.js'; // first-session objective numbers (D84)
export * from '../../../packages/shared/src/classes.js'; // class wire ids (D82)
