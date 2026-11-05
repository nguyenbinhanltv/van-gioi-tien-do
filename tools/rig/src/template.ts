/**
 * Rig template generator: parts (sizes of the cut-out pieces) → a valid `RigSet` for a character class. The skeleton,
 * slot order, weapon rules and chains come from data (`@vgtd/character` draw order per direction + `classes.ts`), so a
 * new character needs its parts and, at most, a registry entry. The result has the same shape as the hand-made Kiếm tu
 * data (weighted rigid quads on the slot bone) and feeds `autoSkin`, the QA gate and the exporter unchanged.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BUDGETS, DRAWN_DIRECTIONS, type Direction } from '@vgtd/shared';
import { MIRRORED_VARIANT_SLOTS, PAPERDOLL_SLOTS, slotsInDrawOrder, type SlotId } from '@vgtd/character';
import { CLASSES, type CharacterClass, type CharacterId } from './classes.js';
import { applyMat, invertMat } from './math.js';
import { evalPose } from './pose.js';
import { buildReferenceHumanoid } from './reference-rig.js';
import {
  RIG_FORMAT,
  RIG_FORMAT_VERSION,
  type AtlasData,
  type MeshAttachment,
  type RigAttachment,
  type RigBone,
  type RigChain,
  type RigDocument,
  type RigSet,
  type RigSlot,
} from './schema.js';
import type { RigIssue } from './validate.js';

/** Size of one cut-out piece in **rig px @1x** (art px / texture scale). */
export interface PartDims {
  readonly width: number;
  readonly height: number;
  /** Atlas region name. Default: the slot id. */
  readonly region?: string;
  /** Extra shift of the piece centre from its default anchor, rig px (world axes, y up). */
  readonly offset?: readonly [number, number];
}

export interface PartsManifest {
  readonly character: CharacterId;
  readonly textureScale?: number;
  readonly directions: Readonly<Partial<Record<Direction, Readonly<Partial<Record<SlotId, PartDims>>>>>>;
}

/** Bone each piece is skinned to (the paperdoll convention of the Kiếm tu rig). */
const SLOT_BONE: Readonly<Record<SlotId, string>> = {
  orbit_back: 'root',
  wing: 'spine_upper',
  cape: 'spine_upper',
  sword_back: 'spine_upper',
  hair_back: 'head',
  body: 'hips',
  outfit_lower: 'hips',
  outfit_upper: 'spine_upper',
  head: 'head',
  hair_front: 'head',
  headwear: 'head',
  arm_L: 'upper_arm_L',
  arm_R: 'upper_arm_R',
  weapon_R: 'hand_R',
  orbit_front: 'root',
};

/** Default piece centre: a point between two role bones' rest positions (`to` 'tip' = the bone's tip). */
const ANCHOR: Readonly<Partial<Record<SlotId, { from: string; to: string; t: number }>>> = {
  body: { from: 'hips', to: 'head', t: 0.55 },
  outfit_upper: { from: 'spine_mid', to: 'head', t: 0.45 },
  outfit_lower: { from: 'hips', to: 'foot_L', t: 0.4 },
  head: { from: 'head', to: 'head:tip', t: 0.5 },
  hair_back: { from: 'head', to: 'head:tip', t: 0.2 },
  hair_front: { from: 'head', to: 'head:tip', t: 0.8 },
  headwear: { from: 'head', to: 'head:tip', t: 1.05 },
  arm_L: { from: 'upper_arm_L', to: 'hand_L', t: 0.5 },
  arm_R: { from: 'upper_arm_R', to: 'hand_R', t: 0.5 },
  weapon_R: { from: 'hand_R', to: 'hand_R:tip', t: 0 },
  wing: { from: 'spine_upper', to: 'head', t: 0.2 },
  cape: { from: 'spine_upper', to: 'hips', t: 0.5 },
  sword_back: { from: 'spine_upper', to: 'head', t: 0.1 },
};

const DEFAULT_TEXTURE_SCALE = 2;

/** The parts manifest must satisfy the class: required slots, weapon rule, back slot, sane sizes. */
export function checkPartsManifest(manifest: PartsManifest): RigIssue[] {
  const cls = CLASSES[manifest.character];
  const issues: RigIssue[] = [];
  const err = (path: string, message: string) => issues.push({ severity: 'error', path, message });
  if (!cls) return [{ severity: 'error', path: '/character', message: `unknown character '${manifest.character}'` }];
  const known = new Set<SlotId>(PAPERDOLL_SLOTS.map((s) => s.id));
  const allowed = new Set<SlotId>([...cls.slots.required, ...cls.slots.optional]);
  for (const dir of Object.keys(manifest.directions) as Direction[]) {
    const parts = manifest.directions[dir] ?? {};
    if (!(DRAWN_DIRECTIONS as readonly string[]).includes(dir))
      err(`/directions/${dir}`, 'only drawn directions (S, SE, E, NE, N) carry parts; SW/W/NW are mirrors');
    for (const slot of cls.slots.required)
      if (!parts[slot]) err(`/directions/${dir}/${slot}`, `missing required piece '${slot}' for ${cls.name}`);
    for (const [slot, d] of Object.entries(parts) as [SlotId, PartDims][]) {
      if (!known.has(slot) || slot.startsWith('orbit_'))
        err(`/directions/${dir}/${slot}`, `'${slot}' is not a skeleton paperdoll slot (orbit layers are sprite nodes)`);
      else if (!allowed.has(slot))
        err(
          `/directions/${dir}/${slot}`,
          `${cls.name} has no '${slot}' piece (${slot === 'weapon_R' && !cls.weapon.slot ? 'gauntlets are painted into arm_L / arm_R' : slot === 'sword_back' ? 'no sheathed weapon on the back' : 'not in the class slot list'})`,
        );
      if (d.width <= 0 || d.height <= 0 || d.width > 128 || d.height > 128)
        err(`/directions/${dir}/${slot}`, `piece size ${d.width}x${d.height} px @1x is outside 0..128`);
    }
  }
  if (!Object.keys(manifest.directions).length) err('/directions', 'no directions');
  return issues;
}

function chainBones(
  cls: CharacterClass,
  roles: Readonly<Record<string, string | undefined>>,
): { bones: RigBone[]; chains: RigChain[] } {
  const bones: RigBone[] = [];
  const chains: RigChain[] = [];
  for (const c of cls.chains) {
    const parent = roles[c.parent];
    if (!parent) continue;
    const names: string[] = [];
    for (let i = 0; i < c.segments; i++) {
      const name = `${c.name}_${i + 1}`;
      names.push(name);
      bones.push(
        i === 0
          ? { name, parent, length: c.length, x: c.at.x, y: c.at.y, rotation: c.at.rotation }
          : { name, parent: names[i - 1]!, length: c.length, x: c.length, y: 0, rotation: 0 },
      );
    }
    chains.push({
      name: c.name,
      kind: c.kind,
      bones: names,
      stiffness: c.stiffness,
      damping: c.damping,
      ...(c.gravity ? { gravity: c.gravity } : {}),
    });
  }
  return { bones, chains };
}

function quad(
  path: string,
  width: number,
  height: number,
  corners: { x: number; y: number }[],
  bone: string,
): MeshAttachment {
  return {
    type: 'mesh',
    path,
    width,
    height,
    uvs: [0, 1, 1, 1, 1, 0, 0, 0],
    vertices: corners.flatMap((c) => [Math.round(c.x * 1e3) / 1e3, Math.round(c.y * 1e3) / 1e3]),
    triangles: [0, 1, 2, 0, 2, 3],
    weights: corners.map(() => [[bone, 1] as const]),
  };
}

/** Build the RigSet for every direction in the manifest. Throws when the manifest breaks the class rules. */
export function buildRigTemplate(manifest: PartsManifest): RigSet {
  const errors = checkPartsManifest(manifest).filter((i) => i.severity === 'error');
  if (errors.length)
    throw new Error(`parts manifest is invalid:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
  const cls = CLASSES[manifest.character];
  const rigs: Partial<Record<Direction, RigDocument>> = {};
  for (const dir of Object.keys(manifest.directions) as Direction[]) {
    const base = buildReferenceHumanoid(dir, `${cls.id}_${dir}`);
    const skeleton = base.bones.filter((b) => !/^(hair|sash)_\d$/.test(b.name));
    const extra = chainBones(cls, base.roles);
    const bones = [...skeleton, ...extra.bones];
    const probe: RigDocument = { ...base, bones, ik: base.ik, chains: extra.chains };
    const rest = evalPose(probe, null, 0, { noIk: true });
    const at = (spec: string) => {
      const [name, tip] = spec.split(':');
      const bone = rest.byName.get(base.roles[name as keyof typeof base.roles] ?? name!)!;
      return tip === 'tip' ? bone.tip : bone.pos;
    };

    const parts = manifest.directions[dir] ?? {};
    const slots: RigSlot[] = [];
    const attachments: Record<string, Record<string, RigAttachment>> = {};
    for (const slot of slotsInDrawOrder(dir)) {
      const dims = parts[slot];
      if (!dims) continue;
      const boneRole = SLOT_BONE[slot];
      const bone = base.roles[boneRole as keyof typeof base.roles] ?? boneRole;
      const a = ANCHOR[slot] ?? { from: boneRole, to: `${boneRole}:tip`, t: 0.5 };
      const p0 = at(a.from);
      const p1 = at(a.to);
      const cx = p0.x + (p1.x - p0.x) * a.t + (dims.offset?.[0] ?? 0);
      const cy = p0.y + (p1.y - p0.y) * a.t + (dims.offset?.[1] ?? 0);
      const inv = invertMat(rest.byName.get(bone)!.world);
      const hw = dims.width / 2;
      const hh = dims.height / 2;
      // world corners, bottom-left first (uv order of the painting), then into the slot bone's local space
      const world = [
        { x: cx - hw, y: cy - hh },
        { x: cx + hw, y: cy - hh },
        { x: cx + hw, y: cy + hh },
        { x: cx - hw, y: cy + hh },
      ];
      const region = dims.region ?? slot;
      const mesh = quad(
        region,
        dims.width,
        dims.height,
        world.map((w) => applyMat(inv, w)),
        bone,
      );
      attachments[slot] = { [slot]: mesh };
      const hideBack = slot === 'sword_back' && cls.weapon.backSlot; // the weapon is in hand
      if (
        slot === 'weapon_R' &&
        cls.weapon.mirroredVariant &&
        (MIRRORED_VARIANT_SLOTS as readonly SlotId[]).includes(slot)
      ) {
        attachments[slot]![`${slot}_mirrored`] = { ...mesh, path: `${region}_mirrored` };
      }
      slots.push({
        name: slot,
        bone,
        paperdoll: slot,
        attachment: hideBack ? null : slot,
        ...(slot === 'wing' ? { blend: 'additive' as const } : {}),
      });
    }
    rigs[dir] = {
      format: RIG_FORMAT,
      version: RIG_FORMAT_VERSION,
      id: `${cls.id}_${dir}`,
      kind: 'player',
      direction: dir,
      canvas: base.canvas,
      bones,
      ik: base.ik,
      chains: extra.chains,
      roles: base.roles,
      sockets: base.sockets,
      slots,
      skins: [{ name: 'default', attachments }],
    };
  }
  return { id: cls.id, rigs };
}

/** Shelf-pack every attachment region of a rig into one pow2 page (placeholder for the project packer). */
export function packTemplateAtlas(
  rig: RigDocument,
  imagePath: string,
  textureScale = DEFAULT_TEXTURE_SCALE,
): AtlasData {
  const pad = BUDGETS.ATLAS_PADDING_PX;
  const items = rig.skins
    .flatMap((s) => Object.values(s.attachments).flatMap((m) => Object.values(m)))
    .map((a) => ({ name: a.path, w: Math.ceil(a.width * textureScale), h: Math.ceil(a.height * textureScale) }))
    .filter((v, i, all) => all.findIndex((x) => x.name === v.name) === i)
    .sort((a, b) => b.h - a.h);
  for (let size = 64; size <= BUDGETS.ATLAS_MAX_WEB_MOBILE; size *= 2) {
    let x = pad;
    let y = pad;
    let row = 0;
    const regions: AtlasData['regions'][number][] = [];
    let ok = true;
    for (const it of items) {
      if (x + it.w + pad > size) {
        x = pad;
        y += row + pad;
        row = 0;
      }
      if (y + it.h + pad > size) {
        ok = false;
        break;
      }
      regions.push({ name: it.name, x, y, width: it.w, height: it.h });
      x += it.w + pad;
      row = Math.max(row, it.h);
    }
    if (ok) return { imagePath, width: size, height: size, premultipliedAlpha: true, regions };
  }
  throw new Error(`parts of ${rig.id} do not fit one ${BUDGETS.ATLAS_MAX_WEB_MOBILE}px atlas page`);
}

/** PNG width/height from the IHDR chunk (no decode). */
function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  if (b.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error(`${file} is not a PNG (Git LFS pointer?)`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** Read `parts/<DIR>/<slot>.png` under `dir` into a manifest (pixel sizes ÷ texture scale). */
export function scanPartsFolder(
  dir: string,
  character: CharacterId,
  textureScale = DEFAULT_TEXTURE_SCALE,
): PartsManifest {
  const directions: Partial<Record<Direction, Partial<Record<SlotId, PartDims>>>> = {};
  const slotIds = new Set<string>(PAPERDOLL_SLOTS.map((s) => s.id));
  for (const d of DRAWN_DIRECTIONS) {
    const folder = join(dir, d);
    if (!existsSync(folder)) continue;
    const parts: Partial<Record<SlotId, PartDims>> = {};
    for (const f of readdirSync(folder)) {
      const slot = f.replace(/\.png$/i, '');
      if (!f.toLowerCase().endsWith('.png') || !slotIds.has(slot)) continue;
      const { width, height } = pngSize(join(folder, f));
      parts[slot as SlotId] = { width: width / textureScale, height: height / textureScale };
    }
    directions[d] = parts;
  }
  return { character, textureScale, directions };
}
