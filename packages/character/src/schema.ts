/**
 * JSON Schema (draft 2020-12) for character and monster definition files. Enums are derived from the
 * typed tables so there is a single source of truth. Cross-field rules live in validators.ts.
 */
import { DIRECTIONS } from '@vgtd/shared';
import { ANIMATION_IDS } from './animations.js';
import { MUTATION_SCALE_RANGE, MUTATION_VARIANT_IDS } from './boss.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { FOOTPRINT_CLASSES, type SocketId } from './footprint.js';
import { SLOT_IDS } from './paperdoll.js';

const idPattern = '^[a-z][a-z0-9_]*$';
const SOCKET_IDS: readonly SocketId[] = [
  'origin',
  'hand_R',
  'hand_L',
  'back',
  'chest',
  'head_fx',
  'head_top',
  'orbit_center',
  'mount_seat',
  'fly_feet',
];

const nonNegInt = { type: 'integer', minimum: 0 } as const;
const point = {
  type: 'object',
  required: ['x', 'y'],
  additionalProperties: false,
  properties: { x: { type: 'number' }, y: { type: 'number' } },
} as const;

const rig = {
  type: 'object',
  required: ['bones', 'slots', 'meshVertices', 'physicsConstraints'],
  additionalProperties: false,
  properties: {
    bones: nonNegInt,
    slots: nonNegInt,
    meshVertices: nonNegInt,
    physicsConstraints: nonNegInt,
  },
} as const;

const animation = (idSchema: object) =>
  ({
    type: 'object',
    required: ['id', 'loop', 'frames', 'fps', 'drawnInEight'],
    additionalProperties: false,
    properties: {
      id: idSchema,
      loop: { type: 'boolean' },
      frames: { type: 'integer', minimum: 1 },
      fps: { type: 'number', exclusiveMinimum: 0 },
      drawnInEight: { type: 'boolean' },
    },
  }) as const;

const collision = {
  type: 'object',
  required: ['multiPart'],
  additionalProperties: false,
  properties: {
    multiPart: { type: 'boolean' },
    colliderRadius: { type: 'number', exclusiveMinimum: 0 },
    hurtboxRadius: { type: 'number', exclusiveMinimum: 0 },
    pickBox: {
      type: 'object',
      required: ['width', 'height'],
      additionalProperties: false,
      properties: { width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } },
    },
  },
} as const;

const packedAttachment = {
  type: 'object',
  required: ['slot', 'width', 'height'],
  additionalProperties: false,
  properties: {
    slot: { enum: [...SLOT_IDS] },
    width: { type: 'number', exclusiveMinimum: 0 },
    height: { type: 'number', exclusiveMinimum: 0 },
    blend: { enum: ['normal', 'additive'] },
  },
} as const;

export const characterDefinitionSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://vgtd.example/schemas/character.schema.json',
  title: 'Character definition (player / npc / pet)',
  type: 'object',
  required: ['schemaVersion', 'id', 'name', 'kind', 'footprint', 'canvas', 'render', 'rig', 'animations', 'collision'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: DEFINITION_SCHEMA_VERSION },
    id: { type: 'string', pattern: idPattern },
    name: { type: 'string', minLength: 1 },
    kind: { enum: ['player', 'npc', 'pet'] },
    footprint: { enum: ['1x1', 'elite', '2x2'] },
    canvas: { enum: [128, 192, 256] },
    render: { const: 'spine' },
    rig,
    animations: {
      type: 'array',
      minItems: 1,
      items: animation({ enum: [...ANIMATION_IDS] }),
    },
    collision,
    sockets: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(SOCKET_IDS.map((s) => [s, point])),
    },
    paperdoll: {
      type: 'object',
      required: ['equipped'],
      additionalProperties: false,
      properties: {
        equipped: { type: 'array', uniqueItems: true, items: { enum: [...SLOT_IDS] } },
        attachments: { type: 'array', items: packedAttachment },
      },
    },
  },
} as const;

const bossPart = {
  type: 'object',
  required: ['id', 'role', 'skeleton', 'anchorBone', 'colliderRadius', 'hurtboxRadius'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: idPattern },
    role: { enum: ['body', 'head', 'tail', 'limb'] },
    skeleton: { type: 'string', minLength: 1 },
    anchorBone: { type: ['string', 'null'] },
    colliderRadius: { type: 'number', exclusiveMinimum: 0 },
    hurtboxRadius: { type: 'number', exclusiveMinimum: 0 },
  },
} as const;

const partBreak = {
  type: 'object',
  required: ['slot', 'maxHp', 'skills', 'drops'],
  additionalProperties: false,
  properties: {
    slot: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' }, // Spine slot name (e.g. claw_R)
    maxHp: { type: 'number', exclusiveMinimum: 0 },
    skills: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    drops: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
  },
} as const;

const phase = {
  type: 'object',
  required: ['id', 'hpThreshold', 'skin', 'atlas'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: idPattern },
    hpThreshold: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
    skin: { type: 'string', minLength: 1 },
    atlas: { type: 'string', minLength: 1 },
    tint: { type: 'string', minLength: 1 },
    arenaDecal: { type: 'string', minLength: 1 },
  },
} as const;

const variant = {
  type: 'object',
  required: ['id', 'tint', 'extraAttachments', 'scale'],
  additionalProperties: false,
  properties: {
    id: { enum: [...MUTATION_VARIANT_IDS] },
    tint: { type: 'string', minLength: 1 },
    extraAttachments: { type: 'array', items: { type: 'string', minLength: 1 } },
    scale: { type: 'number', minimum: MUTATION_SCALE_RANGE.min, maximum: MUTATION_SCALE_RANGE.max },
  },
} as const;

export const monsterDefinitionSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://vgtd.example/schemas/monster.schema.json',
  title: 'Monster definition (mob / elite / boss)',
  type: 'object',
  required: [
    'schemaVersion',
    'id',
    'name',
    'kind',
    'footprint',
    'canvas',
    'render',
    'directions',
    'animations',
    'collision',
    'hpBar',
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: DEFINITION_SCHEMA_VERSION },
    id: { type: 'string', pattern: idPattern },
    name: { type: 'string', minLength: 1 },
    kind: { enum: ['mob', 'elite', 'boss'] },
    footprint: { enum: [...FOOTPRINT_CLASSES] },
    canvas: { type: ['integer', 'null'], enum: [128, 192, 256, 512, null] },
    render: { enum: ['spine', 'prerender3d', 'spritesheet', 'spine_pieced'] },
    directions: {
      type: 'object',
      required: ['scheme'],
      additionalProperties: false,
      properties: {
        scheme: { enum: ['five_mirror', 'parts_1_3'] },
        drawn: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { enum: [...DIRECTIONS] } },
      },
    },
    rig,
    animations: {
      type: 'array',
      minItems: 1,
      items: animation({ type: 'string', pattern: idPattern }),
    },
    collision,
    hpBar: { enum: ['overhead', 'hud'] },
    parts: { type: 'array', minItems: 1, items: bossPart },
    partBreak: { type: 'array', items: partBreak },
    phases: { type: 'array', items: phase },
    variants: { type: 'array', items: variant },
  },
} as const;
