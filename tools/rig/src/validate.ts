import Ajv from 'ajv';
import { RIG_LIMITS, slotsInDrawOrder, type SlotId } from '@vgtd/character';
import { DRAWN_DIRECTIONS } from '@vgtd/shared';
import { BONE_ROLES, RIG_FORMAT, RIG_FORMAT_VERSION, type BoneRole, type RigDocument } from './schema.js';

export interface RigIssue {
  readonly severity: 'error' | 'warning';
  readonly path: string;
  readonly message: string;
}

const num = { type: 'number' } as const;
const str = { type: 'string', minLength: 1 } as const;

const regionSchema = {
  type: 'object',
  required: ['type', 'path', 'x', 'y', 'width', 'height'],
  additionalProperties: false,
  properties: {
    type: { const: 'region' },
    path: str,
    x: num,
    y: num,
    rotation: num,
    scaleX: num,
    scaleY: num,
    width: { type: 'number', exclusiveMinimum: 0 },
    height: { type: 'number', exclusiveMinimum: 0 },
  },
} as const;

const meshSchema = {
  type: 'object',
  required: ['type', 'path', 'width', 'height', 'uvs', 'vertices', 'triangles'],
  additionalProperties: false,
  properties: {
    type: { const: 'mesh' },
    path: str,
    width: { type: 'number', exclusiveMinimum: 0 },
    height: { type: 'number', exclusiveMinimum: 0 },
    uvs: { type: 'array', items: num },
    vertices: { type: 'array', items: num },
    triangles: { type: 'array', items: { type: 'integer', minimum: 0 } },
    weights: {
      type: 'array',
      items: { type: 'array', items: { type: 'array', minItems: 2, maxItems: 2 } },
    },
  },
} as const;

/** JSON Schema for `RigDocument` (structure only; cross-references are checked by `validateRig`). */
export const RIG_JSON_SCHEMA = {
  $id: 'https://vgtd.local/schema/rig.schema.json',
  type: 'object',
  required: ['format', 'version', 'id', 'kind', 'direction', 'canvas', 'bones', 'roles', 'slots', 'skins'],
  additionalProperties: false,
  properties: {
    format: { const: RIG_FORMAT },
    version: { const: RIG_FORMAT_VERSION },
    id: str,
    kind: { enum: ['player', 'boss', 'mob', 'npc', 'pet'] },
    direction: { enum: ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] },
    canvas: {
      type: 'object',
      required: ['width', 'height'],
      additionalProperties: false,
      properties: { width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } },
    },
    bones: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'parent', 'length', 'x', 'y', 'rotation'],
        additionalProperties: false,
        properties: {
          name: str,
          parent: { type: ['string', 'null'] },
          length: { type: 'number', minimum: 0 },
          x: num,
          y: num,
          rotation: num,
          scaleX: num,
          scaleY: num,
          inheritRotation: { type: 'boolean' },
        },
      },
    },
    ik: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'bones', 'target', 'bendPositive'],
        additionalProperties: false,
        properties: {
          name: str,
          bones: { type: 'array', minItems: 1, maxItems: 2, items: str },
          target: str,
          bendPositive: { type: 'boolean' },
          mix: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    chains: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'kind', 'bones', 'stiffness', 'damping'],
        additionalProperties: false,
        properties: {
          name: str,
          kind: { enum: ['hair', 'ribbon', 'sash', 'sleeve', 'cape', 'tail', 'other'] },
          bones: { type: 'array', minItems: 1, items: str },
          stiffness: { type: 'number', minimum: 0, maximum: 1 },
          damping: { type: 'number', minimum: 0, maximum: 1 },
          gravity: num,
          inertia: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    roles: { type: 'object', propertyNames: { enum: [...BONE_ROLES] }, additionalProperties: str },
    sockets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'bone', 'x', 'y'],
        additionalProperties: false,
        properties: { name: str, bone: str, x: num, y: num, rotation: num },
      },
    },
    slots: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'bone'],
        additionalProperties: false,
        properties: {
          name: str,
          bone: str,
          paperdoll: str,
          blend: { enum: ['normal', 'additive'] },
          attachment: { type: ['string', 'null'] },
          color: { type: 'array', items: num, minItems: 4, maxItems: 4 },
        },
      },
    },
    skins: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'attachments'],
        additionalProperties: false,
        properties: {
          name: str,
          attachments: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              additionalProperties: { oneOf: [regionSchema, meshSchema] },
            },
          },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const checkStructure = ajv.compile(RIG_JSON_SCHEMA);

export interface ValidateOptions {
  /** Roles that must exist (e.g. an animation set's needs). */
  readonly requireRoles?: readonly BoneRole[];
  /** Skip the docs/03 rig limits (bones / slots / vertices / chains). */
  readonly skipLimits?: boolean;
}

/** Structure (JSON Schema) + semantic checks: names, parents, IK/chain/role/slot references, paperdoll order, limits. */
export function validateRig(doc: unknown, options: ValidateOptions = {}): RigIssue[] {
  const issues: RigIssue[] = [];
  const err = (path: string, message: string) => issues.push({ severity: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ severity: 'warning', path, message });

  if (!checkStructure(doc)) {
    for (const e of checkStructure.errors ?? []) err(e.instancePath || '/', e.message ?? 'invalid');
    return issues;
  }
  const rig = doc as unknown as RigDocument;

  const bones = new Map<string, number>();
  rig.bones.forEach((b, i) => {
    if (bones.has(b.name)) err(`/bones/${i}`, `duplicate bone '${b.name}'`);
    if (b.parent === null) {
      if (i !== 0) err(`/bones/${i}`, 'only the first bone may be the root (parent null)');
    } else if (!bones.has(b.parent)) {
      err(`/bones/${i}`, `parent '${b.parent}' must be listed before '${b.name}'`);
    }
    bones.set(b.name, i);
  });
  if (rig.bones[0]?.parent !== null) err('/bones/0', 'first bone must be the root (parent null)');

  const needBone = (path: string, name: string) => {
    if (!bones.has(name)) err(path, `unknown bone '${name}'`);
  };
  const parentOf = (name: string) => rig.bones[bones.get(name) ?? -1]?.parent;
  for (const [role, bone] of Object.entries(rig.roles)) needBone(`/roles/${role}`, bone);
  for (const r of options.requireRoles ?? []) if (!rig.roles[r]) err(`/roles/${r}`, `missing required role '${r}'`);

  const ikNames = new Set<string>();
  (rig.ik ?? []).forEach((k, i) => {
    if (ikNames.has(k.name)) err(`/ik/${i}`, `duplicate ik '${k.name}'`);
    ikNames.add(k.name);
    k.bones.forEach((b) => needBone(`/ik/${i}`, b));
    needBone(`/ik/${i}`, k.target);
    if (k.bones.length === 2 && parentOf(k.bones[1]!) !== k.bones[0]) {
      err(`/ik/${i}`, `2-bone IK: '${k.bones[1]}' must be a child of '${k.bones[0]}'`);
    }
  });
  (rig.chains ?? []).forEach((c, i) => {
    c.bones.forEach((b, j) => {
      needBone(`/chains/${i}`, b);
      if (j > 0 && parentOf(b) !== c.bones[j - 1]) {
        err(`/chains/${i}`, `chain bone '${b}' must be a child of '${c.bones[j - 1]}'`);
      }
    });
  });
  (rig.sockets ?? []).forEach((s, i) => needBone(`/sockets/${i}`, s.bone));

  const slots = new Set<string>();
  rig.slots.forEach((s, i) => {
    if (slots.has(s.name)) err(`/slots/${i}`, `duplicate slot '${s.name}'`);
    slots.add(s.name);
    needBone(`/slots/${i}`, s.bone);
  });
  const skinNames = new Set<string>();
  rig.skins.forEach((sk, i) => {
    if (skinNames.has(sk.name)) err(`/skins/${i}`, `duplicate skin '${sk.name}'`);
    skinNames.add(sk.name);
    for (const [slot, atts] of Object.entries(sk.attachments)) {
      if (!slots.has(slot)) err(`/skins/${i}/${slot}`, `unknown slot '${slot}'`);
      for (const [an, a] of Object.entries(atts)) {
        if (a.type !== 'mesh') continue;
        const at = `/skins/${i}/${slot}/${an}`;
        const vc = a.vertices.length / 2;
        if (!Number.isInteger(vc) || a.uvs.length !== a.vertices.length) {
          err(at, 'mesh uvs and vertices must be equal-length x,y pairs');
        }
        if (a.triangles.length % 3 !== 0 || a.triangles.some((t) => t >= vc)) {
          err(at, 'mesh triangles must be index triples into the vertex list');
        }
        if (a.weights) {
          if (a.weights.length !== vc) err(at, 'weights length must equal vertex count');
          a.weights.forEach((w, vi) => {
            const sum = w.reduce((s, e) => s + (e[1] as number), 0);
            if (Math.abs(sum - 1) > 1e-3) err(at, `vertex ${vi} weights sum to ${sum}`);
            w.forEach((e) => needBone(at, e[0] as string));
          });
        }
      }
    }
  });
  if (!skinNames.has('default')) warn('/skins', "no 'default' skin");
  for (const s of rig.slots) {
    if (s.attachment && !rig.skins.some((sk) => sk.attachments[s.name]?.[s.attachment!])) {
      err(`/slots/${s.name}`, `default attachment '${s.attachment}' not found in any skin`);
    }
  }

  // Paperdoll draw order must match the per-direction preset of @vgtd/character (docs/03 §2).
  const pd = rig.slots.filter((s) => s.paperdoll);
  for (const s of pd) {
    if (s.paperdoll!.startsWith('orbit_')) err(`/slots/${s.name}`, 'orbit layers are sprite nodes, not skeleton slots');
  }
  const present = new Set(pd.map((s) => s.paperdoll));
  const preset = slotsInDrawOrder(rig.direction).filter((id) => present.has(id));
  const actual = pd.map((s) => s.paperdoll as SlotId);
  if (preset.join() !== actual.join()) {
    err(
      '/slots',
      `paperdoll slot order for ${rig.direction} must be ${preset.join(' < ')} (got ${actual.join(' < ')})`,
    );
  }

  if (!options.skipLimits) {
    const limits = RIG_LIMITS[rig.kind === 'boss' ? 'boss' : rig.kind === 'pet' ? 'pet' : 'player'];
    if (rig.bones.length > limits.bones) err('/bones', `${rig.bones.length} bones > limit ${limits.bones}`);
    if (rig.slots.length > limits.slots) err('/slots', `${rig.slots.length} slots > limit ${limits.slots}`);
    const chains = rig.chains?.length ?? 0;
    if (chains > limits.physicsConstraints) {
      err('/chains', `${chains} chains > secondary-motion limit ${limits.physicsConstraints}`);
    }
    let maxV = 0;
    for (const sk of rig.skins) {
      let v = 0;
      for (const atts of Object.values(sk.attachments)) {
        for (const a of Object.values(atts)) if (a.type === 'mesh') v += a.vertices.length / 2;
      }
      maxV = Math.max(maxV, v);
    }
    if (maxV > limits.meshVertices) err('/skins', `${maxV} mesh vertices > limit ${limits.meshVertices}`);
  }
  if (!(DRAWN_DIRECTIONS as readonly string[]).includes(rig.direction)) {
    warn('/direction', `'${rig.direction}' is not a drawn direction; only valid for animations drawn in 8`);
  }
  return issues;
}

export function assertValidRig(doc: unknown, options?: ValidateOptions): RigDocument {
  const errors = validateRig(doc, options).filter((i) => i.severity === 'error');
  if (errors.length) throw new Error(`invalid rig:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
  return doc as RigDocument;
}

/** Validate a `RigSet` envelope: every document valid, keyed by its own drawn direction, same bone names across views. */
export function validateRigSet(set: unknown, options: ValidateOptions = {}): RigIssue[] {
  const issues: RigIssue[] = [];
  const s = set as { id?: unknown; rigs?: Record<string, unknown> };
  if (typeof s?.id !== 'string' || !s.id || typeof s.rigs !== 'object' || s.rigs === null) {
    return [
      { severity: 'error', path: '/', message: 'RigSet needs { id: string, rigs: { <direction>: RigDocument } }' },
    ];
  }
  let reference: string[] | null = null;
  for (const [dir, doc] of Object.entries(s.rigs)) {
    for (const i of validateRig(doc, options)) issues.push({ ...i, path: `/rigs/${dir}${i.path}` });
    const rig = doc as RigDocument;
    if (rig?.direction !== dir) {
      issues.push({
        severity: 'error',
        path: `/rigs/${dir}`,
        message: `document direction '${rig?.direction}' does not match key '${dir}'`,
      });
    }
    const names = Array.isArray(rig?.bones) ? rig.bones.map((b) => b.name).sort() : [];
    if (reference === null) reference = names;
    else if (names.join() !== reference.join()) {
      issues.push({
        severity: 'warning',
        path: `/rigs/${dir}/bones`,
        message: 'bone names differ from the first view (animations are shared across views)',
      });
    }
  }
  if (!Object.keys(s.rigs).length) issues.push({ severity: 'error', path: '/rigs', message: 'no rigs' });
  return issues;
}
