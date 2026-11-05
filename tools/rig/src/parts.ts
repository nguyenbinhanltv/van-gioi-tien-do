/**
 * Parts SPEC: what the art must contain so the rig works the first time. Rigid pieces cut from one painting open a
 * seam wherever a bent joint reveals paint that was never there. The spec says, per joint seam, **which piece's paint
 * must extend under which, and by how many px**:
 *
 *  - **seam width**: the real width of the limb / torso at the joint (8-26 px), not the width of the biggest neighbour:
 *    the paint that has to be hidden only spans the seam edge;
 *  - **angle**: the largest rotation the class's own animation set asks of the joint, measured on the rig (not a
 *    guess): `measuredJointCaps`;
 *  - **side**: from the draw order of the direction (`drawOrderFor`): the BACK piece's paint extends under the FRONT
 *    piece (hidden underpaint); the front piece needs nothing. Islands of one slot (limb pieces in `body`, `arm_*`)
 *    have no order between them, so both extend.
 *
 * A seam edge of width w rotating by θ about the joint sweeps sideways by w·sin(θ/2) (2·r·sin(θ/2), r = w/2): that is
 * the margin. Checked against the Kiếm tu residuals after round 3 (knee 12-18, elbow 12-15, ankle 9 px).
 */
import { BUDGETS, DRAWN_DIRECTIONS, type Direction } from '@vgtd/shared';
import { PAPERDOLL_SLOTS, drawOrderFor, type SlotId } from '@vgtd/character';
import { authorClassSet } from './class-clips.js';
import { CLASSES, type CharacterClass, type CharacterId, type JointCaps } from './classes.js';
import { evalPose } from './pose.js';
import { buildReferenceHumanoid } from './reference-rig.js';

export type JointId = keyof JointCaps;

/** Skeleton joints and the bones (roles) they connect. */
export const JOINTS: Readonly<Record<JointId, { readonly parent: string; readonly child: string }>> = {
  shoulder: { parent: 'spine_upper', child: 'upper_arm' },
  elbow: { parent: 'upper_arm', child: 'lower_arm' },
  wrist: { parent: 'lower_arm', child: 'hand' },
  hip: { parent: 'hips', child: 'thigh' },
  knee: { parent: 'thigh', child: 'shin' },
  ankle: { parent: 'shin', child: 'foot' },
  neck: { parent: 'spine_upper', child: 'head' },
  waist: { parent: 'spine_mid', child: 'spine_upper' },
};

/** Role bones whose local rotation is the joint angle, per joint (left and right where both exist). */
const JOINT_BONES: Readonly<Record<JointId, readonly string[]>> = {
  shoulder: ['upper_arm_L', 'upper_arm_R'],
  elbow: ['lower_arm_L', 'lower_arm_R'],
  wrist: ['hand_L', 'hand_R'],
  hip: ['thigh_L', 'thigh_R'],
  knee: ['shin_L', 'shin_R'],
  ankle: ['foot_L', 'foot_R'],
  neck: ['head'],
  waist: ['spine_upper'],
};

/**
 * Real width (px @1x) of the seam edge at each joint: the limb / torso width where the two pieces meet, taken from the
 * Kiếm tu pieces (thigh 9-24, shin 15-18, foot 11-12, upper arm 10-17, forearm 11-16, neck 10, torso 22-27) rounded
 * up to the upper end of the typical range.
 */
export const SEAM_WIDTH_PX: Readonly<Record<JointId, number>> = {
  shoulder: 14,
  elbow: 13,
  wrist: 11,
  hip: 18,
  knee: 17,
  ankle: 12,
  neck: 10,
  waist: 26,
};

export interface JointSeam {
  readonly joint: JointId;
  /** The two pieces that meet at the joint: paperdoll slots (equal = two islands of one slot). */
  readonly pieces: readonly [SlotId, SlotId];
  /** Human label of what meets (islands inside one slot). */
  readonly label: string;
}

/** Every seam the garment has at its joints (slot pairs; the piece islands inside a slot are named in `label`). */
export const JOINT_SEAMS: readonly JointSeam[] = [
  { joint: 'shoulder', pieces: ['arm_R', 'outfit_upper'], label: 'upper arm / vest' },
  { joint: 'shoulder', pieces: ['arm_L', 'outfit_upper'], label: 'upper arm / vest' },
  { joint: 'shoulder', pieces: ['arm_R', 'body'], label: 'upper arm / neck-torso' },
  { joint: 'shoulder', pieces: ['arm_L', 'body'], label: 'upper arm / neck-torso' },
  { joint: 'elbow', pieces: ['arm_R', 'arm_R'], label: 'upper arm / forearm' },
  { joint: 'elbow', pieces: ['arm_L', 'arm_L'], label: 'upper arm / forearm' },
  { joint: 'wrist', pieces: ['arm_R', 'arm_R'], label: 'forearm / hand' },
  { joint: 'wrist', pieces: ['arm_L', 'arm_L'], label: 'forearm / hand' },
  { joint: 'hip', pieces: ['body', 'outfit_lower'], label: 'thigh / robe panels' },
  { joint: 'hip', pieces: ['body', 'body'], label: 'thigh / torso' },
  { joint: 'knee', pieces: ['body', 'body'], label: 'thigh / shin' },
  { joint: 'ankle', pieces: ['body', 'body'], label: 'shin / foot' },
  { joint: 'neck', pieces: ['head', 'body'], label: 'head / neck' },
  { joint: 'waist', pieces: ['outfit_upper', 'outfit_lower'], label: 'vest / robe' },
  { joint: 'waist', pieces: ['outfit_upper', 'body'], label: 'vest / torso' },
];

/** Which joints each paperdoll piece crosses or touches (derived from `JOINT_SEAMS`). */
export const SLOT_JOINTS: Readonly<Partial<Record<SlotId, readonly JointId[]>>> = (() => {
  const out: Partial<Record<SlotId, JointId[]>> = {};
  for (const s of JOINT_SEAMS)
    for (const slot of s.pieces) if (!(out[slot] ??= []).includes(s.joint)) out[slot]!.push(s.joint);
  for (const slot of ['hair_back', 'hair_front', 'headwear'] as const) out[slot] = ['neck'];
  out.weapon_R = ['wrist'];
  return out;
})();

/** Nominal piece width (px @1x), shown in the table as the expected size of each piece. */
export const NOMINAL_WIDTH_PX: Readonly<Partial<Record<SlotId, number>>> = {
  body: 22,
  outfit_upper: 36,
  outfit_lower: 46,
  arm_L: 12,
  arm_R: 12,
  head: 26,
  hair_back: 30,
  hair_front: 28,
  headwear: 30,
  weapon_R: 10,
};

/** Paint that must extend beyond the seam, in px @1x, for a seam edge of half-width `halfWidth` bending by `capDeg`. */
export function requiredOverlapPx(halfWidth: number, capDeg: number): number {
  const theta = (Math.min(180, Math.max(0, capDeg)) * Math.PI) / 180;
  return Math.ceil(2 * halfWidth * Math.sin(theta / 2));
}

/** Floor for a joint's angle (deg): even a joint the clips barely move shakes (secondary motion, breathing, IK settling). */
export const MIN_JOINT_CAP_DEG = 20;

const capsCache = new Map<CharacterId, JointCaps>();

/**
 * The largest rotation each joint is asked to make by the class's own clip set, measured on the reference rig (E
 * view, full amplitude): max |local rotation − rest| of the joint's bones over every frame of every clip, rounded up
 * to 5° and floored at `MIN_JOINT_CAP_DEG`. This replaces hand-typed caps: change an animation and the spec follows.
 */
export function measuredJointCaps(id: CharacterId): JointCaps {
  const cached = capsCache.get(id);
  if (cached) return cached;
  const rig = buildReferenceHumanoid('E');
  const rest = evalPose(rig, null, 0, { noIk: true });
  const worst: Record<JointId, number> = {
    shoulder: 0,
    elbow: 0,
    wrist: 0,
    hip: 0,
    knee: 0,
    ankle: 0,
    neck: 0,
    waist: 0,
  };
  for (const clip of authorClassSet(id, rig, { secondary: false })) {
    for (let f = 0; f <= clip.frames; f++) {
      const pose = evalPose(rig, clip, f);
      for (const joint of Object.keys(worst) as JointId[]) {
        for (const role of JOINT_BONES[joint]) {
          const bone = rig.roles[role as keyof typeof rig.roles];
          if (!bone) continue;
          const d = Math.abs(pose.byName.get(bone)!.local.rotation - rest.byName.get(bone)!.local.rotation);
          worst[joint] = Math.max(worst[joint], Math.min(180, d));
        }
      }
    }
  }
  const caps = Object.fromEntries(
    Object.entries(worst).map(([j, v]) => [j, Math.max(MIN_JOINT_CAP_DEG, Math.ceil(v / 5) * 5)]),
  ) as unknown as JointCaps;
  capsCache.set(id, caps);
  return caps;
}

export interface SeamSpec {
  readonly joint: JointId;
  readonly pieces: readonly [SlotId, SlotId];
  readonly label: string;
  readonly seamWidthPx: number;
  /** Measured joint angle (deg) from the class's animation set. */
  readonly capDeg: number;
  /** Margin (px @1x) the BACK piece's paint must extend under the FRONT piece. */
  readonly marginPx: number;
  /** Per drawn direction: the slot whose paint extends ('both' for islands of one slot / equal order). */
  readonly extend: Readonly<Record<Direction, SlotId | 'both'>>;
}

export interface PartSpec {
  readonly slot: SlotId;
  readonly required: boolean;
  /** File name per direction: `parts/<DIR>/<slot>.png`. */
  readonly file: string;
  readonly nominalWidthPx: number;
  readonly joints: readonly { readonly joint: JointId; readonly capDeg: number; readonly overlapPx: number }[];
}

export interface PartsSpec {
  readonly id: CharacterId;
  readonly name: string;
  /** Texture pixels per rig pixel (art is painted at 2×, geometry is 1×). */
  readonly textureScale: number;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly atlasPaddingPx: number;
  readonly weapon: string;
  readonly parts: readonly PartSpec[];
  readonly seams: readonly SeamSpec[];
}

export function partsSpec(cls: CharacterClass | CharacterId, textureScale = 2): PartsSpec {
  const c = typeof cls === 'string' ? CLASSES[cls] : cls;
  const caps = measuredJointCaps(c.id);
  const wanted = new Set<SlotId>([...c.slots.required, ...c.slots.optional]);
  const marginOf = (joint: JointId) => requiredOverlapPx(SEAM_WIDTH_PX[joint] / 2, caps[joint]);

  const seams: SeamSpec[] = JOINT_SEAMS.filter((s) => s.pieces.every((p) => wanted.has(p))).map((s) => ({
    joint: s.joint,
    pieces: s.pieces,
    label: s.label,
    seamWidthPx: SEAM_WIDTH_PX[s.joint],
    capDeg: caps[s.joint],
    marginPx: marginOf(s.joint),
    extend: Object.fromEntries(
      DRAWN_DIRECTIONS.map((d) => {
        const order = drawOrderFor(d);
        const [a, b] = s.pieces;
        return [d, order[a] === order[b] ? 'both' : order[a] < order[b] ? a : b];
      }),
    ) as Record<Direction, SlotId | 'both'>,
  }));

  const parts: PartSpec[] = PAPERDOLL_SLOTS.filter((s) => s.form === 'spine' && wanted.has(s.id)).map((s) => ({
    slot: s.id,
    required: c.slots.required.includes(s.id),
    file: `parts/<DIR>/${s.id}.png`,
    nominalWidthPx: NOMINAL_WIDTH_PX[s.id] ?? 20,
    joints: (SLOT_JOINTS[s.id] ?? []).map((joint) => ({ joint, capDeg: caps[joint], overlapPx: marginOf(joint) })),
  }));
  const weapon = c.weapon.slot
    ? `${c.weapon.kinds.join(' / ')} (slot weapon_R${c.weapon.mirroredVariant ? ' + weapon_R_mirrored' : ''})`
    : `${c.weapon.kinds.join(' / ')} (worn on arm_L / arm_R, no weapon_R)`;
  return {
    id: c.id,
    name: c.name,
    textureScale,
    canvas: { width: 128, height: 128 },
    atlasPaddingPx: BUDGETS.ATLAS_PADDING_PX,
    weapon,
    parts,
    seams,
  };
}

/** Vietnamese Markdown brief for the art worker: per class, the margin per joint seam and the piece that extends. */
export function partsSpecMarkdown(ids: readonly CharacterId[] = Object.keys(CLASSES) as CharacterId[]): string {
  const out: string[] = [
    '# Đặc tả mảnh (parts SPEC) cho từng Đạo Lộ',
    '',
    '> Sinh tự động bởi `partsSpecMarkdown` (`@vgtd/rig`): chạy `npm run gen:parts-spec -w @vgtd/rig` để cập nhật; CI kiểm file này khớp bản sinh mới. Mục đích: vẽ đúng ngay lần đầu để rig không hở mối nối.',
    '',
    '**Quy tắc chung.** Canvas 128 × 128 @1x, pivot (64, 116); vẽ ở texture 2× (256 × 256), hình học 1×. Mỗi hướng vẽ (S, SE, E, NE, N) có bộ mảnh riêng `parts/<HƯỚNG>/<slot>.png`, PNG RGBA premultiplied alpha, padding atlas 2 px (`BUDGETS.ATLAS_PADDING_PX`), nền trong suốt. SW/W/NW là lật gương, không vẽ.',
    '',
    '**Cách tính phần vẽ bù (margin).** Tại mỗi mối nối của khớp, mảnh nằm **sau** (thứ tự vẽ của hướng đó, `drawOrderFor`) phải có thêm **margin px** màu vẽ kéo dài **xuống dưới** mảnh nằm trước; mảnh nằm trước không cần gì. Hai đảo của cùng một slot (các mảnh chi trong `body`, `arm_L`/`arm_R`) không có thứ tự vẽ nên cả hai cùng kéo dài. Margin = `ceil(w · sin(θ/2))`, w = **bề rộng thật của mối nối** tại khớp (chi/thân rộng 10-26 px, không phải bề rộng mảnh lớn kề bên) và θ = **góc khớp lớn nhất mà bộ animation của lớp thực sự đòi hỏi**, đo trên rig (`measuredJointCaps`, làm tròn lên 5°). Nhân đôi số px khi vẽ ở texture 2×. Không che chỗ hở bằng cách dãn mesh.',
    '',
  ];
  for (const id of ids) {
    const s = partsSpec(id);
    out.push(
      `## ${s.name} (\`${s.id}\`)`,
      '',
      `Vũ khí: ${s.weapon}. Texture ${s.textureScale}×, atlas padding ${s.atlasPaddingPx} px.`,
      '',
      '### Margin theo mối nối (px @1x)',
      '',
      '| khớp | mối nối | rộng mối nối | góc đo | margin | mảnh phải kéo dài (S / SE / E / NE / N) |',
      '| --- | --- | ---: | ---: | ---: | --- |',
    );
    for (const m of s.seams) {
      out.push(
        `| ${m.joint} | ${m.label} (\`${m.pieces[0]}\` / \`${m.pieces[1]}\`) | ${m.seamWidthPx} | ${m.capDeg}° | **${m.marginPx}** | ${DRAWN_DIRECTIONS.map((d) => (m.extend[d] === 'both' ? 'cả hai đảo' : `\`${m.extend[d]}\``)).join(' / ')} |`,
      );
    }
    out.push(
      '',
      '### Mảnh',
      '',
      '| slot | bắt buộc | rộng danh nghĩa (px) | khớp chạm (margin px) |',
      '| --- | :---: | ---: | --- |',
    );
    for (const p of s.parts) {
      out.push(
        `| \`${p.slot}\` | ${p.required ? 'có' : 'tùy chọn'} | ${p.nominalWidthPx} | ${p.joints.map((j) => `${j.joint} ${j.overlapPx}`).join(', ') || '—'} |`,
      );
    }
    out.push('');
  }
  return out.join('\n');
}

export function jointCapsFor(id: CharacterId): JointCaps {
  return measuredJointCaps(id);
}
