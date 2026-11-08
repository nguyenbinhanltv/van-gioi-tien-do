/**
 * Engine-safe subset of @vgtd/sim bundled for Cocos: the movement rules the client PREDICTS with (stepMove, grid,
 * constants, math, shared types). Excludes `skills` / `world` / `anticheat`: `skills` imports the skill data tables from
 * @vgtd/shared, which pull in ajv (see shared-subset.ts). prepare.mjs aliases `@vgtd/sim` to this file.
 */
export * from '../../../packages/sim/src/constants.js';
export * from '../../../packages/sim/src/math.js';
export * from '../../../packages/sim/src/grid.js';
export * from '../../../packages/sim/src/movement.js';
export * from '../../../packages/sim/src/types.js';
