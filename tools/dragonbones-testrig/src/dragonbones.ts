import type { NeutralRig } from './neutral.js';
import type { PackedRegion } from './atlas.js';

/**
 * Data version written to `version` / `compatibleVersion`. Cocos Creator 3.8.8's runtime reads up to 5.6.x
 * (native parser: 5.5 is its DATA_VERSION), so we write 5.5 (also what DragonBones Pro 5.5/5.6 and LoongBones read).
 */
export const DRAGONBONES_VERSION = '5.5';

const round = (n: number) => Math.round(n * 1000) / 1000;
/** y-up (neutral) -> y-down (DragonBones). Contained in this exporter; the Cocos component flips back when rendering. */
const dy = (y: number) => round(-y);
/** CCW degrees (neutral) -> CW degrees (DragonBones). */
const dr = (deg: number) => round(-deg);

/**
 * DragonBones JSON (`*_ske.json`) for one neutral rig: y DOWN, rotation clockwise, frame based (duration in frames),
 * animation values relative to the setup pose.
 */
export function exportSkeleton(rig: NeutralRig): string {
  const bone = rig.bones.map((b) => ({
    name: b.name,
    ...(b.parent ? { parent: b.parent } : {}),
    transform: {
      ...(b.x ? { x: round(b.x) } : {}),
      ...(b.y ? { y: dy(b.y) } : {}),
      ...(b.rotation ? { skX: dr(b.rotation), skY: dr(b.rotation) } : {}),
    },
  }));
  const slot = rig.slots.map((s) => ({ name: s.name, parent: s.bone }));
  const skin = {
    name: 'default',
    slot: rig.slots.map((s) => ({
      name: s.name,
      display: s.displays.map((d) => ({
        type: 'image',
        name: d.texture,
        transform: { ...(d.x ? { x: round(d.x) } : {}), ...(d.y ? { y: dy(d.y) } : {}) },
      })),
    })),
  };
  const animation = rig.animations.map((a) => {
    const bones = Object.entries(a.bones).map(([name, keys]) => {
      const list = keys ?? [];
      const hasRot = list.some((k) => k.rot);
      const hasMove = list.some((k) => k.tx || k.ty);
      return {
        name,
        ...(hasMove
          ? {
              translateFrame: list.map((k) => ({ duration: 1, tweenEasing: 0, x: round(k.tx ?? 0), y: dy(k.ty ?? 0) })),
            }
          : {}),
        ...(hasRot ? { rotateFrame: list.map((k) => ({ duration: 1, tweenEasing: 0, rotate: dr(k.rot ?? 0) })) } : {}),
      };
    });
    // Event frames: consecutive spans of frames; an event fires at the start of its span.
    const byFrame = new Map<number, string[]>();
    for (const e of a.events) byFrame.set(e.frame, [...(byFrame.get(e.frame) ?? []), e.name]);
    const frame: { duration: number; events?: { name: string }[] }[] = [];
    let cursor = 0;
    for (const f of Array.from(byFrame.keys()).sort((x, y) => x - y)) {
      if (f > cursor) frame.push({ duration: f - cursor });
      frame.push({ duration: 1, events: byFrame.get(f)!.map((name) => ({ name })) });
      cursor = f + 1;
    }
    if (frame.length && cursor < a.frames) frame.push({ duration: a.frames - cursor });
    return {
      name: a.id,
      duration: a.frames,
      playTimes: a.loop ? 0 : 1,
      fadeInTime: 0,
      bone: bones,
      ...(frame.length ? { frame } : {}),
    };
  });
  const data = {
    frameRate: 30,
    name: rig.name,
    version: DRAGONBONES_VERSION,
    compatibleVersion: DRAGONBONES_VERSION,
    armature: [
      {
        type: 'Armature',
        frameRate: 30,
        name: rig.name,
        aabb: { x: rig.aabb.x, y: dy(rig.aabb.y + rig.aabb.height), width: rig.aabb.width, height: rig.aabb.height },
        bone,
        slot,
        skin: [skin],
        animation,
        defaultActions: [{ gotoAndPlay: 'idle' }],
      },
    ],
  };
  return JSON.stringify(data);
}

/** Texture atlas JSON (`*_tex.json`). */
export function exportAtlas(rig: NeutralRig, size: number, regions: readonly PackedRegion[]): string {
  return JSON.stringify({
    name: rig.name,
    imagePath: `${rig.name}_tex.png`,
    width: size,
    height: size,
    SubTexture: [...regions]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({ name: r.name, x: r.x, y: r.y, width: r.w, height: r.h })),
  });
}
