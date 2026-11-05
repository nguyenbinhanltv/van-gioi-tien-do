/**
 * Parts SPEC: what the art must contain so the rig works the first time. Rigid pieces cut from one painting open a
 * seam wherever a bent joint reveals paint that was never there (round 2-3 findings: thigh vs robe 31 px, vest vs
 * sleeve 20 px). The spec derives, for every paperdoll piece and every joint it touches, how far the paint must extend
 * under the neighbouring piece (`overlapPx`) from the largest rotation the class's animations ask of that joint.
 *
 * Seam geometry: a neighbour of half-width r rotating by θ about the joint sweeps its edge sideways by 2·r·sin(θ/2);
 * covering that sweep needs `overlapPx = ceil(2·r·sin(θ/2))` of extra paint on each side. Checked against the Kiếm tu
 * measurements (r 23, θ 90° → 32 px vs 31 measured; r 18, θ 70° → 21 vs 20).
 */
import { BUDGETS } from '@vgtd/shared';
import { PAPERDOLL_SLOTS, type SlotId } from '@vgtd/character';
import { CLASSES, type CharacterClass, type CharacterId, type JointCaps } from './classes.js';

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

/** Which joints each paperdoll piece crosses or touches (the seams its paint must cover). */
export const SLOT_JOINTS: Readonly<Partial<Record<SlotId, readonly JointId[]>>> = {
  body: ['neck', 'waist', 'shoulder', 'hip', 'knee', 'ankle'],
  outfit_upper: ['waist', 'shoulder', 'neck'],
  outfit_lower: ['hip', 'knee'],
  arm_L: ['shoulder', 'elbow', 'wrist'],
  arm_R: ['shoulder', 'elbow', 'wrist'],
  head: ['neck'],
  hair_back: ['neck'],
  hair_front: ['neck'],
  headwear: ['neck'],
  weapon_R: ['wrist'],
};

/** Nominal piece width (px @1x) used to size the overlap when the real art is not there yet. */
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

/** Paint that must extend beyond the seam, in px @1x, for a neighbour of `halfWidth` bending by `capDeg`. */
export function requiredOverlapPx(halfWidth: number, capDeg: number): number {
  const theta = (Math.min(180, Math.max(0, capDeg)) * Math.PI) / 180;
  return Math.ceil(2 * halfWidth * Math.sin(theta / 2));
}

export interface PartSpec {
  readonly slot: SlotId;
  readonly required: boolean;
  /** File name per direction: `parts/<DIR>/<slot>.png`. */
  readonly file: string;
  readonly nominalWidthPx: number;
  readonly joints: readonly {
    readonly joint: JointId;
    readonly capDeg: number;
    /** Extra paint (px @1x; ×2 at texture scale 2) under/over the seam on this piece. */
    readonly overlapPx: number;
  }[];
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
}

export function partsSpec(cls: CharacterClass | CharacterId, textureScale = 2): PartsSpec {
  const c = typeof cls === 'string' ? CLASSES[cls] : cls;
  const wanted = new Set<SlotId>([...c.slots.required, ...c.slots.optional]);
  const parts: PartSpec[] = PAPERDOLL_SLOTS.filter((s) => s.form === 'spine' && wanted.has(s.id)).map((s) => {
    const width = NOMINAL_WIDTH_PX[s.id] ?? 20;
    const joints = (SLOT_JOINTS[s.id] ?? []).map((joint) => {
      // the neighbour piece across the seam is typically the widest torso piece: use the larger of the two half-widths
      const neighbour = Math.max(width, NOMINAL_WIDTH_PX.outfit_lower ?? width) / 2;
      const r = ['shoulder', 'elbow', 'wrist'].includes(joint)
        ? Math.max(width, NOMINAL_WIDTH_PX.outfit_upper ?? width) / 2
        : neighbour;
      return { joint, capDeg: c.caps[joint], overlapPx: requiredOverlapPx(r, c.caps[joint]) };
    });
    return {
      slot: s.id,
      required: c.slots.required.includes(s.id),
      file: `parts/<DIR>/${s.id}.png`,
      nominalWidthPx: width,
      joints,
    };
  });
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
  };
}

/** Vietnamese Markdown brief for the art worker: one table per class. */
export function partsSpecMarkdown(ids: readonly CharacterId[] = Object.keys(CLASSES) as CharacterId[]): string {
  const out: string[] = [
    '# Đặc tả mảnh (parts SPEC) cho từng Đạo Lộ',
    '',
    '> Sinh tự động bởi `partsSpecMarkdown` (`@vgtd/rig`): chạy `npm run gen:parts-spec -w @vgtd/rig` để cập nhật; CI kiểm file này khớp bản sinh mới. Mục đích: vẽ đúng ngay lần đầu để rig không hở mối nối.',
    '',
    '**Quy tắc chung.** Canvas 128 × 128 @1x, pivot (64, 116); vẽ ở texture 2× (256 × 256), hình học 1×. Mỗi hướng vẽ (S, SE, E, NE, N) có bộ mảnh riêng `parts/<HƯỚNG>/<slot>.png`, PNG RGBA premultiplied alpha, padding atlas 2 px (`BUDGETS.ATLAS_PADDING_PX`), nền trong suốt. SW/W/NW là lật gương, không vẽ. **Phần vẽ bù (overlap)** ở bảng dưới là số px @1x mỗi mảnh phải kéo dài _dưới_ mảnh kề ở mỗi khớp để khớp gập tới giới hạn vẫn không lộ nền (công thức `ceil(2·r·sin(θ/2))`, r = nửa bề rộng mảnh kề, θ = góc khớp lớn nhất của bộ animation của lớp). Nhân đôi số px khi vẽ ở texture 2×. Không dán ảnh nền lên chỗ hở bằng cách dãn mesh.',
    '',
  ];
  for (const id of ids) {
    const s = partsSpec(id);
    out.push(
      `## ${s.name} (\`${s.id}\`)`,
      '',
      `Vũ khí: ${s.weapon}. Texture ${s.textureScale}×, atlas padding ${s.atlasPaddingPx} px.`,
      '',
      '| slot | bắt buộc | rộng danh nghĩa (px) | vẽ bù theo khớp (px @1x, góc tối đa) |',
      '| --- | :---: | ---: | --- |',
    );
    for (const p of s.parts) {
      out.push(
        `| \`${p.slot}\` | ${p.required ? 'có' : 'tùy chọn'} | ${p.nominalWidthPx} | ${p.joints.map((j) => `${j.joint} **${j.overlapPx}** (${j.capDeg}°)`).join(', ') || '—'} |`,
      );
    }
    out.push('');
  }
  return out.join('\n');
}

export function jointCapsFor(id: CharacterId): JointCaps {
  return CLASSES[id].caps;
}
