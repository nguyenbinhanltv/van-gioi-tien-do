import { DIRECTIONS, type Direction } from '@vgtd/shared';
import { generateRig, type GeneratedRig } from './rig.js';

export * from './atlas.js';
export * from './dragonbones.js';
export * from './motion.js';
export * from './neutral.js';
export * from './parts.js';
export * from './png.js';
export * from './rig.js';

/** Rigs for all 8 directions: 5 drawn (S SE E NE N) + 3 extra for animations drawn in 8 (D14). */
export function generateAllRigs(directions: readonly Direction[] = DIRECTIONS): GeneratedRig[] {
  return directions.map(generateRig);
}
