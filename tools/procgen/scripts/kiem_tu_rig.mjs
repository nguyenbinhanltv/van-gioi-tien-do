#!/usr/bin/env node
// AI-derived placeholder separation and Spine 4.2 handoff. Not a production animation rig.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { format, resolveConfig } from 'prettier';
import {
  CANVAS_BY_FOOTPRINT,
  PIVOT_BOTTOM_OFFSET_PX,
  DRAWN_DIRECTIONS,
  MIRRORED_DIRECTIONS,
  DIRECTIONS,
  BUDGETS,
} from '@vgtd/shared';
import {
  SLOT_IDS,
  SPINE_SLOT_IDS,
  SPINE_KEY_FPS,
  RIG_LIMITS,
  getCharacterViewState,
  getAnimation,
} from '@vgtd/character';

const require = createRequire(import.meta.url);
const { Image, decodePNG, resizeArea } = require('../src/lib/png.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const SOURCE_DIR = path.join(ROOT, 'assets-src/placeholder/kiem-tu-rig-v1');
export const CLIENT_DIR = path.join(ROOT, 'apps/client-cocos/assets/bundles/class-kiem-tu/_placeholder/rig-v1');
const SIDE = CANVAS_BY_FOOTPRINT['1x1'];
export const PIVOT = [SIDE / 2, SIDE - PIVOT_BOTTOM_OFFSET_PX];
const SCALE = 2;
const SIZE = SIDE * SCALE;
const round = (n) => Math.round(n * 1e5) / 1e5 + 0;
const radians = (a) => (a * Math.PI) / 180;
const rotate = ([x, y], a) => [
  x * Math.cos(radians(a)) - y * Math.sin(radians(a)),
  x * Math.sin(radians(a)) + y * Math.cos(radians(a)),
];
const read = (file) => decodePNG(fs.readFileSync(file));
async function json(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await format(JSON.stringify(data), { ...(await resolveConfig(file)), parser: 'json' }));
}
function save(file, image) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  image.save(file);
}
function crop(image, x, y, w, h) {
  const out = new Image(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.setPixel(i, j, ...image.getPixel(x + i, y + j));
  return out;
}
export function alphaBounds(image) {
  let x = image.width,
    y = image.height,
    right = -1,
    bottom = -1;
  for (let j = 0; j < image.height; j++)
    for (let i = 0; i < image.width; i++)
      if (image.getPixel(i, j)[3] >= 32) {
        x = Math.min(x, i);
        y = Math.min(y, j);
        right = Math.max(right, i);
        bottom = Math.max(bottom, j);
      }
  return right < 0 ? null : { x, y, w: right - x + 1, h: bottom - y + 1 };
}
export function normalizeTurnaround(sheet) {
  return DRAWN_DIRECTIONS.map((direction, n) => {
    const left = Math.round((n * sheet.width) / DRAWN_DIRECTIONS.length);
    const cell = crop(
      sheet,
      left,
      0,
      Math.round(((n + 1) * sheet.width) / DRAWN_DIRECTIONS.length) - left,
      sheet.height,
    );
    // The generated cutout has stray chroma-key specks. Keep the main connected
    // opaque silhouette and its antialiased one-pixel neighbourhood.
    for (let i = 0; i < cell.data.length; i += 4) {
      const max = Math.max(...cell.data.slice(i, i + 3)),
        min = Math.min(...cell.data.slice(i, i + 3));
      if (max > 150 && (max - min) / max > 0.72) cell.data[i + 3] = 0;
    }
    const count = cell.width * cell.height,
      seen = new Uint8Array(count),
      queue = new Int32Array(count);
    let largest = [];
    for (let start = 0; start < count; start++) {
      if (seen[start] || cell.data[start * 4 + 3] < 96) continue;
      let length = 1;
      queue[0] = start;
      seen[start] = 1;
      for (let at = 0; at < length; at++) {
        const id = queue[at],
          x = id % cell.width,
          y = Math.floor(id / cell.width);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx,
              ny = y + dy,
              n = ny * cell.width + nx;
            if (nx < 0 || ny < 0 || nx >= cell.width || ny >= cell.height || seen[n] || cell.data[n * 4 + 3] < 96)
              continue;
            seen[n] = 1;
            queue[length++] = n;
          }
      }
      if (length > largest.length) largest = Array.from(queue.subarray(0, length));
    }
    const keep = new Uint8Array(count);
    for (const id of largest) {
      const x = id % cell.width,
        y = Math.floor(id / cell.width);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (x + dx >= 0 && x + dx < cell.width && y + dy >= 0 && y + dy < cell.height)
            keep[(y + dy) * cell.width + x + dx] = 1;
    }
    for (let i = 0; i < count; i++) if (!keep[i]) cell.data[i * 4 + 3] = 0;
    const box = alphaBounds(cell);
    assert(box, 'Empty direction ' + direction);
    const raw = crop(cell, box.x, box.y, box.w, box.h);
    const image = resizeArea(raw, Math.round((raw.width * 208) / raw.height), 208);
    // Feet, rather than the asymmetric weapon bounding box, define the pivot x.
    let min = image.width,
      max = 0;
    for (let y = Math.floor(image.height * 0.93); y < image.height; y++)
      for (let x = 0; x < image.width; x++)
        if (image.getPixel(x, y)[3] >= 96) {
          min = Math.min(min, x);
          max = Math.max(max, x);
        }
    const out = new Image(SIZE, SIZE);
    const x = Math.round(PIVOT[0] * SCALE - (min + max) / 2),
      y = PIVOT[1] * SCALE - image.height;
    assert(x >= 0 && x + image.width <= SIZE, direction + ' does not fit canvas');
    out.blit(image, x, y);
    return { direction, image: out };
  });
}

/** Art landmarks are authored in the normalized @2x canvas; not gameplay constants. */
export function landmarks(direction) {
  const profiles = {
    S: {
      neck: [128, 78],
      shoulder_R: [109, 86],
      elbow_R: [99, 112],
      hand_R: [89, 136],
      shoulder_L: [147, 86],
      elbow_L: [157, 112],
      hand_L: [167, 136],
      head: [128, 55],
      hip: [128, 130],
      swordTip: [54, 206],
    },
    SE: {
      neck: [128, 78],
      shoulder_R: [113, 86],
      elbow_R: [102, 112],
      hand_R: [91, 136],
      shoulder_L: [144, 86],
      elbow_L: [151, 112],
      hand_L: [158, 136],
      head: [132, 55],
      hip: [128, 130],
      swordTip: [54, 206],
    },
    E: {
      neck: [118, 78],
      shoulder_R: [120, 86],
      elbow_R: [120, 112],
      hand_R: [128, 138],
      shoulder_L: [112, 86],
      elbow_L: [110, 110],
      hand_L: [116, 134],
      head: [124, 55],
      hip: [118, 130],
      swordTip: [155, 210],
    },
    NE: {
      neck: [124, 78],
      shoulder_R: [143, 86],
      elbow_R: [155, 112],
      hand_R: [164, 136],
      shoulder_L: [110, 86],
      elbow_L: [102, 112],
      hand_L: [96, 136],
      head: [126, 55],
      hip: [124, 130],
      swordTip: [194, 202],
    },
    N: {
      neck: [128, 78],
      shoulder_R: [147, 86],
      elbow_R: [157, 112],
      hand_R: [167, 136],
      shoulder_L: [109, 86],
      elbow_L: [99, 112],
      hand_L: [89, 136],
      head: [128, 55],
      hip: [128, 130],
      swordTip: [202, 205],
    },
  };
  const p = profiles[direction];
  assert(p, 'Undrawn direction');
  return {
    ...p,
    root: [PIVOT[0] * SCALE, PIVOT[1] * SCALE],
    torso: [p.hip[0], 118],
    chest: [p.neck[0], 94],
    thigh_R: [p.hip[0] - 8, 139],
    shin_R: [p.hip[0] - 9, 185],
    foot_R: [p.hip[0] - 10, 223],
    thigh_L: [p.hip[0] + 8, 139],
    shin_L: [p.hip[0] + 9, 185],
    foot_L: [p.hip[0] + 10, 223],
    hair_back_1: [p.head[0] - 3, 49],
    hair_back_2: [p.neck[0] - 2, 92],
    hair_front_1: [p.head[0], 41],
    hair_front_2: [p.head[0] + 2, 60],
    ribbon_1: [p.head[0], 36],
    ribbon_2: [p.head[0] - 4, 80],
    sash_L_1: [p.hip[0] - 3, 126],
    sash_L_2: [p.hip[0] - 4, 153],
    sash_R_1: [p.hip[0] + 4, 126],
    sash_R_2: [p.hip[0] + 7, 161],
    sleeve_tip_R: [p.elbow_R[0] - 3, p.elbow_R[1] + 14],
    sleeve_tip_L: [p.elbow_L[0] + 3, p.elbow_L[1] + 14],
    robe_front: [p.hip[0], 136],
    robe_back: [p.hip[0], 136],
    scabbard: [p.hip[0] + (direction === 'N' || direction === 'NE' ? -18 : 18), 128],
    weapon: p.hand_R,
  };
}

export function boneRig(direction) {
  const p = landmarks(direction),
    bones = [],
    world = {};
  const graph = [
    ['root', null],
    ['hip', 'root'],
    ['torso', 'hip'],
    ['chest', 'torso'],
    ['neck', 'chest'],
    ['head', 'neck'],
    ['upper_arm_R', 'chest', 'shoulder_R'],
    ['lower_arm_R', 'upper_arm_R', 'elbow_R'],
    ['hand_R', 'lower_arm_R'],
    ['upper_arm_L', 'chest', 'shoulder_L'],
    ['lower_arm_L', 'upper_arm_L', 'elbow_L'],
    ['hand_L', 'lower_arm_L'],
    ['thigh_R', 'hip'],
    ['shin_R', 'thigh_R'],
    ['foot_R', 'shin_R'],
    ['thigh_L', 'hip'],
    ['shin_L', 'thigh_L'],
    ['foot_L', 'shin_L'],
    ['hair_back_1', 'head'],
    ['hair_back_2', 'hair_back_1'],
    ['hair_front_1', 'head'],
    ['hair_front_2', 'hair_front_1'],
    ['ribbon_1', 'head'],
    ['ribbon_2', 'ribbon_1'],
    ['sleeve_tip_R', 'lower_arm_R'],
    ['sleeve_tip_L', 'lower_arm_L'],
    ['sash_L_1', 'hip'],
    ['sash_L_2', 'sash_L_1'],
    ['sash_R_1', 'hip'],
    ['sash_R_2', 'sash_R_1'],
    ['robe_front', 'hip'],
    ['robe_back', 'hip'],
    ['scabbard', 'hip'],
    ['weapon', 'hand_R'],
  ];
  const aim = {
    upper_arm_R: 'elbow_R',
    lower_arm_R: 'hand_R',
    upper_arm_L: 'elbow_L',
    lower_arm_L: 'hand_L',
    thigh_R: 'shin_R',
    shin_R: 'foot_R',
    thigh_L: 'shin_L',
    shin_L: 'foot_L',
    weapon: 'swordTip',
  };
  for (const [name, parent, key = name] of graph) {
    const point = p[key],
      pos = [point[0] / SCALE - PIVOT[0], PIVOT[1] - point[1] / SCALE];
    const parentWorld = parent ? world[parent] : { x: 0, y: 0, rotation: 0 };
    const local = rotate([pos[0] - parentWorld.x, pos[1] - parentWorld.y], -parentWorld.rotation);
    const target = aim[name] ? p[aim[name]] : null;
    const angle = target ? (Math.atan2(-(target[1] - point[1]), target[0] - point[0]) * 180) / Math.PI : 0;
    bones.push({
      name,
      ...(parent ? { parent } : {}),
      x: round(local[0]),
      y: round(local[1]),
      rotation: round(angle - parentWorld.rotation),
      length: target ? round(Math.hypot(target[0] - point[0], target[1] - point[1]) / SCALE) : 0,
    });
    world[name] = { x: pos[0], y: pos[1], rotation: angle };
  }
  return { bones, world };
}

export const PIECES = [
  ['neck', 'body', 'neck'],
  ['torso_base', 'body', 'torso'],
  ['thigh_R', 'body', 'thigh_R'],
  ['thigh_L', 'body', 'thigh_L'],
  ['shin_R', 'body', 'shin_R'],
  ['shin_L', 'body', 'shin_L'],
  ['foot_R', 'body', 'foot_R'],
  ['foot_L', 'body', 'foot_L'],
  ['robe_back', 'outfit_lower', 'robe_back'],
  ['robe_front', 'outfit_lower', 'robe_front'],
  ['scabbard', 'outfit_lower', 'scabbard'],
  ['coat', 'outfit_upper', 'chest'],
  ['sash_L_1', 'outfit_upper', 'sash_L_1'],
  ['sash_L_2', 'outfit_upper', 'sash_L_2'],
  ['sash_R_1', 'outfit_upper', 'sash_R_1'],
  ['sash_R_2', 'outfit_upper', 'sash_R_2'],
  ['face', 'head', 'head'],
  ['hair_back_1', 'hair_back', 'hair_back_1'],
  ['hair_back_2', 'hair_back', 'hair_back_2'],
  ['hair_front_1', 'hair_front', 'hair_front_1'],
  ['hair_front_2', 'hair_front', 'hair_front_2'],
  ['hair_ribbon_1', 'hair_back', 'ribbon_1'],
  ['hair_ribbon_2', 'hair_back', 'ribbon_2'],
  ['hairpin', 'headwear', 'head'],
  ['upper_sleeve_R', 'arm_R', 'upper_arm_R'],
  ['lower_sleeve_R', 'arm_R', 'lower_arm_R'],
  ['sleeve_tip_R', 'arm_R', 'sleeve_tip_R'],
  ['hand_R', 'arm_R', 'hand_R'],
  ['upper_sleeve_L', 'arm_L', 'upper_arm_L'],
  ['lower_sleeve_L', 'arm_L', 'lower_arm_L'],
  ['sleeve_tip_L', 'arm_L', 'sleeve_tip_L'],
  ['hand_L', 'arm_L', 'hand_L'],
  ['sword', 'weapon_R', 'weapon'],
].map(([name, slot, bone]) => ({ name, slot, bone }));

const segmentDistance = ([x, y], a, b) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
};
/** Every visible source pixel has one owner. Painted-under joints overlap beneath it. */
export function separateParts(image, direction) {
  const p = landmarks(direction),
    back = ['NE', 'N'].includes(direction),
    profile = direction === 'E';
  const parts = PIECES.map((s) => ({ ...s, image: new Image(SIZE, SIZE) }));
  const byName = Object.fromEntries(parts.map((s) => [s.name, s]));
  function owner(x, y) {
    const [r, g, b] = image.getPixel(x, y),
      blue = b > r * 1.13 && g > r * 1.03;
    const skinPixel = r > g * 1.06 && g > b * 1.04 && b > g * 0.62 && r > 90;
    for (const side of ['R', 'L'])
      if (skinPixel && ((x - p['hand_' + side][0]) / 12) ** 2 + ((y - p['hand_' + side][1] - 3) / 18) ** 2 < 1)
        return 'hand_' + side;
    const swordDistance = segmentDistance([x, y], p.hand_R, p.swordTip);
    if (y >= p.hand_R[1] + 4 && swordDistance < (y < p.hand_R[1] + 16 ? 7 : 6)) {
      const neutral = Math.max(r, g, b) - Math.min(r, g, b) < 48,
        bronze = r > b * 1.3 && g > b * 1.08;
      if (neutral || bronze) return 'sword';
    }
    if (y < 45 && Math.abs(y - 37) < 5) return 'hairpin';
    if (back && blue && y < 110 && segmentDistance([x, y], [p.head[0], 36], [p.neck[0] - 11, 108]) < 6)
      return y < 74 ? 'hair_ribbon_1' : 'hair_ribbon_2';
    if (y < 80) {
      if (back) return y < 56 ? 'hair_back_1' : 'hair_back_2';
      if (y >= 72 && Math.min(r, g, b) > 125 && Math.max(r, g, b) - Math.min(r, g, b) < 35) return 'neck';
      if (y >= 75 && blue) return 'coat';
      const face = Math.abs((x - p.head[0]) / 15) ** 2 + Math.abs((y - 62) / 18) ** 2 < 1;
      if (face && y > 44) return 'face';
      return y < 57 ? 'hair_front_1' : 'hair_front_2';
    }
    if (y < 116 && back && Math.abs(x - p.neck[0]) < 16) return y < 94 ? 'hair_back_1' : 'hair_back_2';
    if (!back && !blue && Math.max(r, g, b) < 95 && y < 112 && Math.abs(x - p.neck[0]) < 23) return 'hair_back_2';
    if (back && y < 105 && Math.abs(x - (p.head[0] - 6)) < 5) return y < 80 ? 'hair_ribbon_1' : 'hair_ribbon_2';
    for (const side of ['R', 'L']) {
      const shoulder = p['shoulder_' + side],
        hand = p['hand_' + side],
        u = Math.max(0, Math.min(1, (y - shoulder[1]) / (hand[1] - shoulder[1]))),
        radius = profile ? 9 : u < 0.65 ? 10 + 5 * u : 13.25 - (u - 0.65) * 20;
      if (
        !blue &&
        segmentDistance([x, y], shoulder, hand) < radius &&
        y < hand[1] + 6 &&
        (Math.abs(x - p.neck[0]) > (profile ? 0 : 20) || y > 116)
      ) {
        if (y > hand[1] - 7 && Math.abs(x - hand[0]) < 7) return 'hand_' + side;
        if (y > p['elbow_' + side][1] + 8) return 'sleeve_tip_' + side;
        return y > p['elbow_' + side][1] - 6 ? 'lower_sleeve_' + side : 'upper_sleeve_' + side;
      }
    }
    if (y > 208) return x < p.hip[0] ? 'foot_R' : 'foot_L';
    if (y > 196 && Math.max(r, g, b) < 125) return x < p.hip[0] ? 'shin_R' : 'shin_L';
    if (y > 125 && y < 192 && segmentDistance([x, y], p.scabbard, [p.scabbard[0] + (back ? -14 : 14), 190]) < 5)
      return 'scabbard';
    if (y > 122 && y < 188 && Math.abs(x - p.hip[0]) < 12 && (blue || Math.max(r, g, b) < 110))
      return 'sash_' + (x < p.hip[0] ? 'L' : 'R') + '_' + (y < 151 ? '1' : '2');
    if (y >= 128) return back ? 'robe_back' : 'robe_front';
    if (y < 86 && Math.abs(x - p.neck[0]) < 9) return 'neck';
    return 'coat';
  }
  const slotOrder = getCharacterViewState({
    kind: 'player',
    direction,
    animation: 'idle',
    equipped: SLOT_IDS,
    drawnInEight: false,
  }).slotOrder;
  const ranks = Object.fromEntries(
    parts.map((part, index) => [part.name, slotOrder.indexOf(part.slot) * parts.length + index]),
  );
  // Procedural painted-under patches are deliberately simple material colors.
  // Their extents stay inside the rest-pose silhouette; source detail is copied last.
  const paint = (name, a, b, r, color) => {
    const dst = byName[name].image;
    for (let y = Math.floor(Math.min(a[1], b[1]) - r); y <= Math.max(a[1], b[1]) + r; y++)
      for (let x = Math.floor(Math.min(a[0], b[0]) - r); x <= Math.max(a[0], b[0]) + r; x++) {
        if (
          x < 0 ||
          y < 0 ||
          x >= SIZE ||
          y >= SIZE ||
          image.getPixel(x, y)[3] < 32 ||
          segmentDistance([x, y], a, b) > r
        )
          continue;
        // Do not paint over a source-owned pixel that would draw before this piece.
        // Hidden overlap must be occluded at rest, not obscure the original costume.
        if (ranks[owner(x, y)] < ranks[name]) continue;
        const shade = 1 - ((x - a[0] + r) / (r * 2)) * 0.16;
        dst.setPixel(x, y, ...color.map((c) => c * shade), 255);
      }
  };
  const skin = [218, 181, 151],
    cloth = [207, 207, 196],
    blue = [82, 112, 128],
    hair = [48, 43, 39];
  paint('torso_base', p.neck, p.hip, 15, skin);
  paint('neck', p.neck, [p.neck[0], p.neck[1] - 12], 9, skin);
  paint('face', [p.head[0], 48], [p.head[0], 66], 12, skin);
  paint('robe_back', [p.hip[0] - 10, 130], [p.hip[0] - 12, 200], 13, blue);
  paint('robe_front', [p.hip[0] + 9, 130], [p.hip[0] + 12, 200], 13, cloth);
  paint('hair_back_1', [p.head[0] - 6, 40], [p.head[0] - 6, 85], 9, hair);
  paint('hair_back_2', [p.neck[0] - 7, 78], [p.neck[0] - 7, 110], 8, hair);
  // A separate ribbon strip is painted underneath the hair; it is not an extra logical slot.
  paint('hair_ribbon_1', [p.head[0] - 5, 39], [p.head[0] - 5, 79], 3, blue);
  paint('hair_ribbon_2', [p.head[0] - 5, 73], [p.head[0] - 5, 108], 3, blue);
  for (const side of ['R', 'L']) {
    const shoulder = p['shoulder_' + side],
      elbow = p['elbow_' + side],
      hand = p['hand_' + side];
    paint('upper_sleeve_' + side, shoulder, [elbow[0], elbow[1] + 6], 11, cloth);
    paint('lower_sleeve_' + side, [elbow[0], elbow[1] - 7], hand, 10, cloth);
    paint('sleeve_tip_' + side, [elbow[0], elbow[1] + 4], [hand[0], hand[1] - 4], 10, cloth);
    paint('hand_' + side, [hand[0], hand[1] - 5], [hand[0], hand[1] + 6], 6, skin);
    paint('thigh_' + side, p['thigh_' + side], [p['shin_' + side][0], p['shin_' + side][1] + 5], 8, skin);
    paint('shin_' + side, [p['shin_' + side][0], p['shin_' + side][1] - 7], p['foot_' + side], 7, [52, 57, 61]);
  }
  // Copy source-owned pixels over the underpaint, retaining the AI texture and outlines.
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++)
      if (image.getPixel(x, y)[3]) byName[owner(x, y)].image.setPixel(x, y, ...image.getPixel(x, y));
  return parts;
}

export function idleAnimation() {
  const bones = {},
    times = Array.from({ length: 17 }, (_, n) => Math.round((n * SPINE_KEY_FPS) / 8) / SPINE_KEY_FPS);
  const wave = (t, phase = 0) => Math.sin(Math.PI * t + phase) - Math.sin(phase);
  bones.chest = {
    translate: times.map((t) => ({ time: round(t), x: 0, y: round(0.65 * (1 - Math.cos(Math.PI * t))) })),
  };
  for (const [name, amplitude, phase] of [
    ['hair_back_1', 1.3, 0],
    ['hair_back_2', 2, 0.4],
    ['hair_front_2', 0.8, 0.3],
    ['ribbon_1', 1.7, 0.4],
    ['ribbon_2', 3, 0.8],
    ['sash_L_1', 1.2, 0.7],
    ['sash_L_2', 2.2, 1],
    ['sash_R_1', -0.9, 0.4],
    ['sash_R_2', -1.8, 0.8],
    ['sleeve_tip_R', 0.7, 0.2],
    ['sleeve_tip_L', -0.7, 0.2],
  ]) {
    bones[name] = { rotate: times.map((t) => ({ time: round(t), value: round(amplitude * wave(t, phase)) })) };
  }
  return { bones };
}

export function makeSkeleton(direction, parts, atlas) {
  const rig = boneRig(direction),
    bones = rig.bones;
  const equipped = [...new Set(parts.filter((p) => p.box).map((p) => p.slot))];
  const view = getCharacterViewState({
    kind: 'player',
    direction,
    animation: 'idle',
    equipped,
    paperdoll: { swordInHand: true },
    drawnInEight: false,
  });
  const slots = view.slotOrder.map((name) => ({
    name,
    bone: name === 'weapon_R' ? 'weapon' : 'root',
    ...(parts.some((p) => p.slot === name && p.box) ? { attachment: name } : {}),
  }));
  const attachments = {};
  for (const slot of slots) {
    const mesh = { type: 'mesh', path: 'kiemtu', uvs: [], triangles: [], vertices: [], hull: 0 };
    for (const part of parts.filter((p) => p.slot === slot.name && p.box)) {
      const box = part.box,
        frame = atlas.frames[part.name],
        pose = rig.world[part.bone],
        bone = bones.findIndex((b) => b.name === part.bone),
        offset = mesh.uvs.length / 2;
      const xy = [
        [box.x, box.y],
        [box.x + box.w, box.y],
        [box.x + box.w, box.y + box.h],
        [box.x, box.y + box.h],
      ];
      const uv = [
        [frame.x, frame.y],
        [frame.x + frame.w, frame.y],
        [frame.x + frame.w, frame.y + frame.h],
        [frame.x, frame.y + frame.h],
      ];
      xy.forEach(([x, y], i) => {
        const local = rotate([x / SCALE - PIVOT[0] - pose.x, PIVOT[1] - y / SCALE - pose.y], -pose.rotation);
        mesh.vertices.push(1, bone, round(local[0]), round(local[1]), 1);
        mesh.uvs.push(round(uv[i][0] / atlas.pages[0].width), round(uv[i][1] / atlas.pages[0].height));
      });
      mesh.triangles.push(offset, offset + 1, offset + 2, offset + 2, offset + 3, offset);
    }
    if (mesh.uvs.length) {
      attachments[slot.name] = { [slot.name]: mesh };
      // Idle uses the mirrored body silhouette. Keep the API's named variant
      // available; this alias is not a separately drawn combat attachment.
      if (slot.name === 'weapon_R') attachments[slot.name].weapon_R_mirrored = structuredClone(mesh);
    }
  }
  return {
    skeleton: {
      spine: '4.2.00',
      x: -PIVOT[0],
      y: -(SIDE - PIVOT[1]),
      width: SIDE,
      height: SIDE,
      fps: SPINE_KEY_FPS,
      images: './',
    },
    bones,
    slots,
    skins: [{ name: 'default', attachments }],
    animations: { idle: idleAnimation() },
  };
}

export function validateSkeleton(skeleton, direction) {
  assert(skeleton.skeleton.spine.startsWith('4.2.'));
  const view = getCharacterViewState({
    kind: 'player',
    direction,
    equipped: SLOT_IDS,
    animation: 'idle',
    drawnInEight: false,
  });
  assert.deepEqual(
    skeleton.slots.map((s) => s.name),
    view.slotOrder,
  );
  assert.equal(skeleton.slots.length, SPINE_SLOT_IDS.length);
  assert(skeleton.bones.length <= RIG_LIMITS.player.bones);
  const seen = new Set();
  for (const b of skeleton.bones) {
    assert(!seen.has(b.name));
    assert(!b.parent || seen.has(b.parent));
    seen.add(b.name);
  }
  let vertices = 0;
  for (const group of Object.values(skeleton.skins[0].attachments))
    for (const mesh of Object.values(group)) {
      const count = mesh.uvs.length / 2;
      vertices += count;
      assert.equal(mesh.vertices.length, count * 5);
      assert(mesh.uvs.every((n) => Number.isFinite(n) && n >= 0 && n <= 1));
      assert(mesh.triangles.every((n) => Number.isInteger(n) && n >= 0 && n < count));
      for (let i = 0; i < mesh.vertices.length; i += 5) {
        assert.equal(mesh.vertices[i], 1);
        assert(skeleton.bones[mesh.vertices[i + 1]]);
        assert.equal(mesh.vertices[i + 4], 1);
      }
    }
  assert(vertices <= RIG_LIMITS.player.meshVertices);
  for (const [name, tracks] of Object.entries(skeleton.animations.idle.bones)) {
    assert(seen.has(name));
    for (const keys of Object.values(tracks)) {
      assert.equal(keys[0].time, 0);
      assert.equal(keys.at(-1).time, 2);
      for (const k of keys) assert(Math.abs(k.time * SPINE_KEY_FPS - Math.round(k.time * SPINE_KEY_FPS)) < 0.001);
      for (const prop of ['value', 'x', 'y'])
        if (keys[0][prop] !== undefined) assert.equal(keys[0][prop], keys.at(-1)[prop]);
    }
  }
  return { bones: skeleton.bones.length, slots: skeleton.slots.length, meshVertices: vertices, physicsConstraints: 0 };
}

export function animatedWorld(skeleton, time = 0) {
  const world = {};
  const sample = (keys, t, prop) => {
    let a = keys[0],
      b = keys.at(-1);
    for (let i = 1; i < keys.length; i++)
      if (keys[i].time >= t) {
        a = keys[i - 1];
        b = keys[i];
        break;
      }
    const u = b.time === a.time ? 0 : (t - a.time) / (b.time - a.time);
    return (a[prop] || 0) * (1 - u) + (b[prop] || 0) * u;
  };
  for (const bone of skeleton.bones) {
    const parent = bone.parent ? world[bone.parent] : { x: 0, y: 0, rotation: 0 },
      tracks = skeleton.animations.idle.bones[bone.name] || {};
    const local = [
      bone.x + (tracks.translate ? sample(tracks.translate, time, 'x') : 0),
      bone.y + (tracks.translate ? sample(tracks.translate, time, 'y') : 0),
    ];
    const offset = rotate(local, parent.rotation);
    world[bone.name] = {
      x: parent.x + offset[0],
      y: parent.y + offset[1],
      rotation: parent.rotation + bone.rotation + (tracks.rotate ? sample(tracks.rotate, time, 'value') : 0),
    };
  }
  return world;
}

export function renderPose(skeleton, parts, time = 0) {
  const output = new Image(SIZE, SIZE),
    setup = animatedWorld(skeleton, 0),
    posed = animatedWorld(skeleton, time);
  for (const slot of skeleton.slots)
    for (const part of parts.filter((p) => p.slot === slot.name && p.box)) {
      const a = setup[part.bone],
        b = posed[part.bone],
        layer = new Image(SIZE, SIZE);
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const local = rotate([x / SCALE - PIVOT[0] - b.x, PIVOT[1] - y / SCALE - b.y], -b.rotation);
          const world = rotate(local, a.rotation),
            sx = Math.round((world[0] + a.x + PIVOT[0]) * SCALE),
            sy = Math.round((PIVOT[1] - world[1] - a.y) * SCALE);
          if (sx >= 0 && sy >= 0 && sx < SIZE && sy < SIZE) layer.setPixel(x, y, ...part.image.getPixel(sx, sy));
        }
      output.drawImage(layer, 0, 0);
    }
  return output;
}

function packDirection(direction, parts) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vgtd-rig-pack-')),
    input = path.join(temp, 'parts'),
    output = path.join(ROOT, 'tools/procgen/build/kiem-tu', direction);
  fs.mkdirSync(input);
  try {
    for (const part of parts) {
      part.box = alphaBounds(part.image);
      if (part.box)
        save(path.join(input, part.name + '.png'), crop(part.image, part.box.x, part.box.y, part.box.w, part.box.h));
    }
    const run = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'tools/procgen/pipeline/pack_atlas.js'),
        '--in',
        input,
        '--out',
        output,
        '--name',
        'kiemtu_' + direction,
        '--max',
        String(BUDGETS.ATLAS_MAX_WEB_MOBILE),
        '--padding',
        String(BUDGETS.ATLAS_PADDING_PX),
        '--extrude',
        '1',
      ],
      { stdio: 'inherit' },
    );
    assert.equal(run.status, 0);
    const atlas = JSON.parse(fs.readFileSync(path.join(output, 'kiemtu_' + direction + '.json')));
    assert.equal(atlas.pages.length, 1, 'Each direction must fit a single texture page');
    const qa = spawnSync(
      process.execPath,
      [path.join(ROOT, 'tools/procgen/pipeline/validate_assets.js'), '--stage', 'packed', '--root', output],
      { stdio: 'inherit' },
    );
    assert.equal(qa.status, 0);
    return { atlas, image: read(path.join(output, atlas.pages[0].file)) };
  } finally {
    assert(
      path.dirname(path.resolve(temp)) === path.resolve(os.tmpdir()) &&
        path.basename(temp).startsWith('vgtd-rig-pack-'),
    );
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function build() {
  const manifest = {
    format: 'vgtd-kiemtu-rig',
    version: 1,
    placeholder: true,
    release: false,
    coordinateSpace: 'pivot-local-y-up',
    textureScale: SCALE,
    pivot: PIVOT,
    mirrors: MIRRORED_DIRECTIONS,
    animation: 'idle',
    drawnInEight: false,
    swordInHand: true,
    equipped: [],
    attachmentVariants: {
      weapon_R: {
        default: 'weapon_R',
        mirrored: 'weapon_R_mirrored',
        note: 'Idle alias, not separately authored asymmetric combat art',
      },
    },
    directions: {},
    drawOrders: {},
  };
  for (const direction of DRAWN_DIRECTIONS) {
    const image = read(path.join(SOURCE_DIR, 'turnaround', direction + '.png'));
    assert.deepEqual([image.width, image.height], [SIZE, SIZE]);
    const parts = separateParts(image, direction);
    for (const part of parts) save(path.join(SOURCE_DIR, 'pieces', direction, part.name + '.png'), part.image);
    for (const slot of SLOT_IDS) {
      const layer = new Image(SIZE, SIZE);
      for (const p of parts.filter((p) => p.slot === slot)) layer.drawImage(p.image, 0, 0);
      save(path.join(SOURCE_DIR, 'parts', direction, slot + '.png'), layer);
    }
    const { atlas, image: packed } = packDirection(direction, parts),
      dir = path.join(CLIENT_DIR, direction);
    const skeleton = makeSkeleton(direction, parts, atlas),
      stats = validateSkeleton(skeleton, direction);
    // Editor JSON import resolves image paths, not the runtime .atlas. Keep a
    // straight-alpha page with the matching attachment path next to this copy.
    save(path.join(SOURCE_DIR, 'spine', direction, 'kiemtu.png'), packed);
    await json(path.join(SOURCE_DIR, 'spine', direction, 'kiemtu.json'), skeleton);
    // Sources/packer are straight-alpha; only the delivered runtime texture is PMA.
    for (let i = 0; i < packed.data.length; i += 4)
      for (let c = 0; c < 3; c++) packed.data[i + c] = Math.round((packed.data[i + c] * packed.data[i + 3]) / 255);
    save(path.join(dir, 'kiemtu.png'), packed);
    fs.writeFileSync(
      path.join(dir, 'kiemtu.atlas'),
      `kiemtu.png\nsize: ${packed.width}, ${packed.height}\nformat: RGBA8888\nfilter: Linear, Linear\nrepeat: none\npma: true\nkiemtu\nbounds: 0, 0, ${packed.width}, ${packed.height}\n`,
    );
    await json(path.join(dir, 'kiemtu.json'), skeleton);
    await json(
      path.join(SOURCE_DIR, 'pieces', direction, 'layout.json'),
      parts.map(({ name, slot, bone, box }) => ({ name, slot, bone, box })),
    );
    save(path.join(dir, 'turnaround.png'), resizeArea(image, SIDE, SIDE));
    save(path.join(dir, 'setup-preview.png'), resizeArea(renderPose(skeleton, parts, 0), SIDE, SIDE));
    manifest.equipped = [
      ...new Set([...manifest.equipped, ...skeleton.slots.filter((s) => s.attachment).map((s) => s.name)]),
    ];
    manifest.directions[direction] = {
      json: direction + '/kiemtu.json',
      atlas: direction + '/kiemtu.atlas',
      texture: direction + '/kiemtu.png',
      stats,
      socketsOverride: {
        ...Object.fromEntries(
          ['hand_R', 'hand_L', 'chest', 'back'].map((name) => {
            const pose = animatedWorld(skeleton)[name === 'back' ? 'chest' : name];
            return [name, { x: round(pose.x), y: round(pose.y) }];
          }),
        ),
        head_top: { x: 0, y: 104 },
      },
    };
  }
  for (const direction of DIRECTIONS)
    manifest.drawOrders[direction] = getCharacterViewState({
      kind: 'player',
      direction,
      animation: 'idle',
      equipped: SLOT_IDS,
      drawnInEight: false,
    }).slotOrder;
  await json(path.join(CLIENT_DIR, 'manifest.json'), manifest);
  console.log('PASS: five directions, canonical slots, weighted meshes, rig budgets, looping 30fps-quantized idle');
}

// Serialized into the review artifact. This is an independent FK preview, not a Spine runtime.
function previewApp() {
  const data = JSON.parse(document.getElementById('rig-data').textContent),
    select = document.getElementById('direction'),
    slider = document.getElementById('time'),
    play = document.getElementById('play'),
    showBones = document.getElementById('bones');
  const rot = ([x, y], a) => {
    const r = (a * Math.PI) / 180;
    return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
  };
  function world(s, t) {
    const result = {},
      sample = (keys, prop) => {
        let a = keys[0],
          b = keys.at(-1);
        for (let i = 1; i < keys.length; i++)
          if (keys[i].time >= t) {
            a = keys[i - 1];
            b = keys[i];
            break;
          }
        const u = b.time === a.time ? 0 : (t - a.time) / (b.time - a.time);
        return (a[prop] || 0) * (1 - u) + (b[prop] || 0) * u;
      };
    for (const bone of s.bones) {
      const p = bone.parent ? result[bone.parent] : { x: 0, y: 0, rotation: 0 },
        tracks = s.animations.idle.bones[bone.name] || {},
        offset = rot(
          [
            bone.x + (tracks.translate ? sample(tracks.translate, 'x') : 0),
            bone.y + (tracks.translate ? sample(tracks.translate, 'y') : 0),
          ],
          p.rotation,
        );
      result[bone.name] = {
        x: p.x + offset[0],
        y: p.y + offset[1],
        rotation: p.rotation + bone.rotation + (tracks.rotate ? sample(tracks.rotate, 'value') : 0),
      };
    }
    return result;
  }
  function draw(canvas, t) {
    const facing = select.value,
      base = data.mirrors[facing] || facing,
      rig = data.directions[base],
      setup = world(rig.skeleton, 0),
      posed = world(rig.skeleton, t),
      ctx = canvas.getContext('2d'),
      scale = canvas.width / data.side;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(data.pivot[0], data.pivot[1]);
    ctx.scale(data.mirrors[facing] ? -1 : 1, -1);
    for (const slot of data.orders[facing])
      for (const piece of rig.parts.filter((p) => p.slot === slot)) {
        const a = setup[piece.bone],
          b = posed[piece.bone];
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate((b.rotation * Math.PI) / 180);
        ctx.rotate((-a.rotation * Math.PI) / 180);
        ctx.translate(-a.x, -a.y);
        ctx.translate(-data.pivot[0], data.pivot[1]);
        ctx.scale(0.5, -0.5);
        ctx.drawImage(piece.image, 0, 0);
        ctx.restore();
      }
    if (showBones.checked) {
      ctx.strokeStyle = '#f88757';
      ctx.lineWidth = 0.5;
      for (const b of rig.skeleton.bones) {
        if (!b.parent) continue;
        const p = posed[b.parent],
          q = posed[b.name];
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  Promise.all(
    Object.values(data.directions).flatMap((r) =>
      r.parts.map(
        (p) =>
          new Promise((resolve, reject) => {
            p.image = new Image();
            p.image.onload = resolve;
            p.image.onerror = reject;
            p.image.src = p.png;
          }),
      ),
    ),
  )
    .then(() => {
      let last = performance.now(),
        time = 0;
      slider.oninput = () => {
        time = Number(slider.value);
        play.checked = false;
      };
      function tick(now) {
        if (play.checked) time = (time + (now - last) / 1000) % 2;
        last = now;
        slider.value = String(time);
        document.getElementById('clock').textContent = time.toFixed(2) + ' s';
        draw(document.getElementById('large'), time);
        draw(document.getElementById('native'), time);
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })
    .catch(() => {
      document.getElementById('status').textContent = 'Image decode failed';
    });
}

export function reviewArtifacts(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const { Resvg } = require('@resvg/resvg-js');
  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1660"><rect width="1600" height="1660" fill="#26333c"/><g font-family="sans-serif" fill="#eef1ed"><text x="24" y="38" font-size="27">CLOUD DISCIPLE / DRAWN SWORD / RIG HANDOFF</text><text x="24" y="68" font-size="17">AI PLACEHOLDER — sources @2x, logical pivot (64,116). Generator FK previews, not Cocos captures.</text>';
  const add = (image, x, y, w, h) => {
    svg += `<image href="data:image/png;base64,${image.toPNG().toString('base64')}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  };
  const payload = { side: SIDE, pivot: PIVOT, mirrors: MIRRORED_DIRECTIONS, orders: {}, directions: {} };
  for (const [n, direction] of DRAWN_DIRECTIONS.entries()) {
    const source = read(path.join(SOURCE_DIR, 'turnaround', direction + '.png')),
      parts = PIECES.map((p) => ({ ...p, image: read(path.join(SOURCE_DIR, 'pieces', direction, p.name + '.png')) }));
    for (const p of parts) p.box = alphaBounds(p.image);
    const skeleton = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, direction, 'kiemtu.json'))),
      x = 24 + n * 312;
    svg += `<text x="${x}" y="100" font-size="20">${direction} / normalized source</text>`;
    add(source, x + 20, 108, 256, 256);
    svg += `<text x="${x}" y="398" font-size="17">Weighted setup / idle 0.5s</text>`;
    add(resizeArea(renderPose(skeleton, parts, 0), SIDE, SIDE), x + 18, 410, 128, 128);
    add(resizeArea(renderPose(skeleton, parts, 0.5), SIDE, SIDE), x + 160, 410, 128, 128);
    payload.directions[direction] = {
      skeleton,
      parts: parts
        .filter((p) => p.box)
        .map((p) => ({
          slot: p.slot,
          bone: p.bone,
          png: 'data:image/png;base64,' + p.image.toPNG().toString('base64'),
        })),
    };
    if (direction === 'S') {
      svg +=
        '<text x="24" y="595" font-size="22">Exploded S pieces (the same piece set is supplied for all five directions)</text>';
      parts.forEach((p, i) => {
        const x = 24 + (i % 8) * 196,
          y = 620 + Math.floor(i / 8) * 186;
        svg += `<rect x="${x}" y="${y}" width="184" height="172" fill="#33434c"/>`;
        if (p.box) {
          const cut = crop(p.image, p.box.x, p.box.y, p.box.w, p.box.h),
            factor = Math.min(150 / cut.width, 112 / cut.height);
          add(cut, x + (184 - cut.width * factor) / 2, y + 8, cut.width * factor, cut.height * factor);
        }
        svg += `<text x="${x + 6}" y="${y + 139}" font-size="13">${p.name}</text><text x="${x + 6}" y="${y + 160}" font-size="11">${p.slot} / ${p.bone}</text>`;
      });
    }
  }
  for (const d of DIRECTIONS)
    payload.orders[d] = getCharacterViewState({
      kind: 'player',
      direction: d,
      animation: 'idle',
      equipped: SLOT_IDS,
      drawnInEight: false,
    }).slotOrder;
  svg += `<text x="24" y="1625" font-size="16">${SLOT_IDS.length} logical groups / ${SPINE_SLOT_IDS.length} Spine slots / ${boneRig('S').bones.length} bones. Reserved blanks: orbit_back, wing, cape, sword_back, orbit_front.</text></g></svg>`;
  fs.writeFileSync(path.join(directory, 'kiem-tu-rig-contact-sheet.png'), new Resvg(svg).render().asPng());
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kiếm tu — rig handoff</title><style>body{font:16px system-ui;background:#eef0ec;color:#24313a;max-width:1000px;margin:24px auto;padding:0 20px}label{display:inline-block;margin:8px}canvas{background:repeating-conic-gradient(#d6dcd7 0% 25%,#e7ebe5 0% 50%) 0 0/24px 24px;display:inline-block;vertical-align:top}#large{width:512px;max-width:100%;height:auto}#native{width:128px;height:128px;margin:20px}small{display:block;color:#54616a}input[type=range]{width:260px}</style><h1>Kiếm tu — rig bàn giao thử</h1><p>Concept A + kiếm rút tay phải. AI placeholder; chưa được phát hành. Xem FK từ dữ liệu sinh, <b>không phải Spine runtime hoặc Cocos</b>.</p><label>Hướng <select id="direction">${DIRECTIONS.map((d) => `<option>${d}</option>`).join('')}</select></label><label><input id="play" type="checkbox" checked>Chạy idle</label><label><input id="bones" type="checkbox">Hiện bones</label><label><input id="time" type="range" min="0" max="2" step=".01"><span id="clock"></span></label><div><canvas id="large" width="256" height="256"></canvas><canvas id="native" width="128" height="128"></canvas></div><small>Trái: phóng lớn. Phải: canvas thật 128×128. Feet/root cố định; idle 2 giây, khóa khoảng 8 Hz lượng tử hóa trên lưới 30 fps. SW/W/NW dùng mirror + draw order riêng.</small><p id="status">Người animate cần kiểm cutout, vùng vẽ bù ở khớp, mesh/weights và phần kiếm trước khi phát triển run/attack/cast. Chưa có animation sản xuất hoặc idle trong thành.</p><script id="rig-data" type="application/json">${JSON.stringify(payload).replaceAll('<', '\\u003c')}</script><script>(${previewApp.toString()})();</script></html>`;
  fs.writeFileSync(path.join(directory, 'kiem-tu-rig-preview.html'), html);
  console.log('Review artifacts:', directory);
}

export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'import') {
    const sheet = read(args[1]);
    for (const { direction, image } of normalizeTurnaround(sheet))
      save(path.join(SOURCE_DIR, 'turnaround', direction + '.png'), image);
  } else if (args[0] === 'build') await build();
  else if (args[0] === 'validate') {
    for (const d of DRAWN_DIRECTIONS) {
      const skeleton = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, d, 'kiemtu.json')));
      for (const slot of SLOT_IDS) {
        const png = read(path.join(SOURCE_DIR, 'parts', d, slot + '.png'));
        assert.deepEqual([png.width, png.height], [SIZE, SIZE]);
      }
      for (const p of PIECES) {
        const png = read(path.join(SOURCE_DIR, 'pieces', d, p.name + '.png'));
        assert.deepEqual([png.width, png.height], [SIZE, SIZE]);
      }
      assert.deepEqual(
        fs
          .readdirSync(path.join(SOURCE_DIR, 'pieces', d))
          .filter((f) => f.endsWith('.png'))
          .sort(),
        PIECES.map((p) => p.name + '.png').sort(),
        'Stale or missing part files',
      );
      const straight = read(path.join(SOURCE_DIR, 'spine', d, 'kiemtu.png')),
        pma = read(path.join(CLIENT_DIR, d, 'kiemtu.png'));
      assert.deepEqual([straight.width, straight.height], [pma.width, pma.height]);
      assert(pma.width <= BUDGETS.ATLAS_MAX_WEB_MOBILE && pma.height <= BUDGETS.ATLAS_MAX_WEB_MOBILE);
      assert(Number.isInteger(Math.log2(pma.width)) && Number.isInteger(Math.log2(pma.height)));
      for (let i = 0; i < pma.data.length; i += 4) {
        assert.equal(pma.data[i + 3], straight.data[i + 3]);
        for (let c = 0; c < 3; c++)
          assert.equal(pma.data[i + c], Math.round((straight.data[i + c] * straight.data[i + 3]) / 255));
      }
      assert(fs.readFileSync(path.join(CLIENT_DIR, d, 'kiemtu.atlas'), 'utf8').includes('pma: true\nkiemtu\nbounds:'));
      console.log(d, validateSkeleton(skeleton, d), 'parts / atlas / PMA verified');
    }
  } else if (args[0] === 'animation-table')
    console.log(['idle', 'run', 'attack', 'cast', 'hit', 'die'].map((id) => getAnimation(id)));
  else if (args[0] === 'review') reviewArtifacts(args[1]);
  else throw Error('Expected import <sheet.png>, build, validate, animation-table');
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]).replaceAll('\\', '/') === fileURLToPath(import.meta.url).replaceAll('\\', '/')
)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
