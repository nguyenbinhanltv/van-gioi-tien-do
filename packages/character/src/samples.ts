/** Sample definition files: one Player and one 4 × 4 Boss (both validate; used by tests and as authoring templates). */
import { ANIMATIONS, defaultAsymmetricAnimations } from './animations.js';
import type { CharacterDefinition, MonsterDefinition } from './definition.js';
import { getHitboxes } from './footprint.js';

const hit1 = getHitboxes('1x1');
const hit4 = getHitboxes('4x4');
if (hit1.multiPart || hit4.multiPart) throw new Error('unreachable: 1x1 and 4x4 are single-volume');
const asymmetric = new Set<string>(defaultAsymmetricAnimations('player'));

export const SAMPLE_PLAYER: CharacterDefinition = {
  schemaVersion: 1,
  id: 'player_base',
  name: 'Tu sĩ (Player rig)',
  kind: 'player',
  footprint: '1x1',
  canvas: 128,
  render: 'spine',
  rig: { bones: 52, slots: 34, meshVertices: 540, physicsConstraints: 5 },
  animations: ANIMATIONS.map((a) => ({
    id: a.id,
    loop: a.loop,
    frames: a.frames,
    fps: a.fps,
    drawnInEight: asymmetric.has(a.id),
  })),
  collision: {
    multiPart: false,
    colliderRadius: hit1.colliderRadius,
    hurtboxRadius: hit1.hurtboxRadius,
    pickBox: hit1.pickBox,
  },
  paperdoll: {
    equipped: [
      'wing',
      'cape',
      'sword_back',
      'hair_back',
      'body',
      'outfit_lower',
      'outfit_upper',
      'head',
      'hair_front',
      'headwear',
      'arm_L',
      'arm_R',
      'weapon_R',
    ],
    // Regions of the 5 drawn directions packed into one repack texture (px @1x).
    attachments: [
      { slot: 'wing', width: 420, height: 130 },
      { slot: 'cape', width: 400, height: 140 },
      { slot: 'sword_back', width: 250, height: 100 },
      { slot: 'hair_back', width: 300, height: 90 },
      { slot: 'body', width: 400, height: 120 },
      { slot: 'outfit_lower', width: 400, height: 110 },
      { slot: 'outfit_upper', width: 400, height: 110 },
      { slot: 'head', width: 300, height: 90 },
      { slot: 'hair_front', width: 300, height: 80 },
      { slot: 'headwear', width: 250, height: 70 },
      { slot: 'arm_L', width: 300, height: 100 },
      { slot: 'arm_R', width: 300, height: 100 },
      { slot: 'weapon_R', width: 350, height: 120 },
    ],
  },
};

export const SAMPLE_BOSS_4X4: MonsterDefinition = {
  schemaVersion: 1,
  id: 'huyet_lang_vuong',
  name: 'Huyết Lang Vương',
  kind: 'boss',
  footprint: '4x4',
  canvas: 512,
  render: 'spine',
  directions: { scheme: 'five_mirror' },
  rig: { bones: 96, slots: 48, meshVertices: 1200, physicsConstraints: 6 },
  animations: [
    { id: 'idle', loop: true, frames: 12, fps: 12, drawnInEight: false },
    { id: 'run', loop: true, frames: 10, fps: 20, drawnInEight: false },
    { id: 'attack', loop: false, frames: 10, fps: 24, drawnInEight: false }, // boss default: symmetric (ADR-020)
    { id: 'skill', loop: false, frames: 14, fps: 28, drawnInEight: false },
    { id: 'hit', loop: false, frames: 4, fps: 20, drawnInEight: false },
    { id: 'die', loop: false, frames: 12, fps: 15, drawnInEight: false },
    // Spine keyed at 30 fps: transform_start 0.8 s = 24 frames, transform_end 1.0 s = 30 frames.
    { id: 'transform_start', loop: false, frames: 24, fps: 30, drawnInEight: false },
    { id: 'transform_end', loop: false, frames: 30, fps: 30, drawnInEight: false },
  ],
  collision: {
    multiPart: false,
    colliderRadius: hit4.colliderRadius,
    hurtboxRadius: hit4.hurtboxRadius,
    pickBox: hit4.pickBox,
  },
  hpBar: 'hud',
  partBreak: [
    { slot: 'claw_R', maxHp: 20000, skills: ['claw_sweep'], drops: ['blood_fang'] },
    { slot: 'horn', maxHp: 15000, skills: ['horn_charge'], drops: ['wolf_horn'] },
  ],
  phases: [
    { id: 'phase_2', hpThreshold: 0.6, skin: 'phase2', atlas: 'huyet_lang_vuong_p2', tint: 'blood_red' },
    {
      id: 'phase_3',
      hpThreshold: 0.25,
      skin: 'phase3',
      atlas: 'huyet_lang_vuong_p3',
      tint: 'blood_dark',
      arenaDecal: 'arena_blood_moon',
    },
  ],
  variants: [
    { id: 'huyet_sac', tint: 'crimson', extraAttachments: ['spikes_back'], scale: 1.1 },
    { id: 'ma_hoa', tint: 'violet_black', extraAttachments: ['horns_extra'], scale: 1.2 },
    { id: 'loi_hoa', tint: 'electric_blue', extraAttachments: ['spikes_back', 'horns_extra'], scale: 1.3 },
  ],
};
