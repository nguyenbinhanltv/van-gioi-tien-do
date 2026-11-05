import { describe, expect, it } from 'vitest';
import {
  ClipBuilder,
  buildReferenceAtlas,
  buildReferenceHumanoid,
  contactSheet,
  createImage,
  decodePng,
  encodeGif,
  encodePng,
  evalPose,
  renderClip,
  renderPose,
  authorKiemTuSet,
  type Image,
} from '../src/index.js';

function opaqueCount(img: Image): number {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! > 0) n++;
  return n;
}

/** Tiny GIF LZW decoder (test only) returning the first frame's colour indices. */
function decodeGifFirstFrame(buf: Buffer): { width: number; height: number; frames: number; indices: Uint8Array } {
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  let pos = 13 + 256 * 3; // header + logical screen + global palette
  let frames = 0;
  let first: Uint8Array | null = null;
  while (buf[pos] !== 0x3b) {
    if (buf[pos] === 0x21) {
      pos += 2;
      while (buf[pos] !== 0) pos += buf[pos]! + 1;
      pos++;
    } else if (buf[pos] === 0x2c) {
      pos += 10;
      const minCode = buf[pos++]!;
      const chunks: number[] = [];
      while (buf[pos] !== 0) {
        for (let i = 0; i < buf[pos]!; i++) chunks.push(buf[pos + 1 + i]!);
        pos += buf[pos]! + 1;
      }
      pos++;
      frames++;
      if (!first) first = lzwDecode(Uint8Array.from(chunks), minCode, width * height);
    } else throw new Error(`bad GIF block ${buf[pos]}`);
  }
  return { width, height, frames, indices: first! };
}

function lzwDecode(data: Uint8Array, minCode: number, expected: number): Uint8Array {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const out: number[] = [];
  let size = minCode + 1;
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push([], []);
    size = minCode + 1;
  };
  reset();
  let bitPos = 0;
  let prev: number[] | null = null;
  while (out.length < expected) {
    let code = 0;
    for (let b = 0; b < size; b++) {
      code |= ((data[(bitPos + b) >> 3]! >> ((bitPos + b) & 7)) & 1) << b;
    }
    bitPos += size;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < table.length) entry = table[code]!;
    else if (prev) entry = [...prev, prev[0]!];
    else throw new Error('bad LZW stream');
    out.push(...entry);
    if (prev) table.push([...prev, entry[0]!]);
    prev = entry;
    if (table.length === 1 << size && size < 12) size++;
  }
  return Uint8Array.from(out);
}

describe('PNG codec', () => {
  it('round-trips colour and alpha (premultiplied in memory, straight on disk)', () => {
    const img = createImage(5, 3, [200, 100, 50, 255]);
    const half = createImage(1, 1, [255, 0, 0, 128]);
    img.data.set(half.data, 0);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(5);
    expect(back.height).toBe(3);
    for (let i = 0; i < img.data.length; i++) expect(Math.abs(back.data[i]! - img.data[i]!)).toBeLessThanOrEqual(1);
    expect(() => decodePng(Buffer.from('nope'))).toThrow(/not a PNG/);
  });
});

describe('GIF encoder (stress)', () => {
  it('round-trips a noisy multi-frame image through dictionary growth and resets', () => {
    // deterministic pseudo-noise: many distinct colour runs force 12-bit codes and several clear codes
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) / 0x7fffff;
    const make = () => {
      const img = createImage(120, 90, [30, 30, 30, 255]);
      for (let i = 0; i < 120 * 90; i++) img.data.set([rnd() * 255, rnd() * 255, rnd() * 255, 255], i * 4);
      return img;
    };
    const frames = [make(), make()];
    const gif = encodeGif(frames, 40);
    const d = decodeGifFirstFrame(gif);
    expect(d.indices.length).toBe(120 * 90);
    expect(d.frames).toBe(2);
    // every decoded index is a valid palette index
    expect(Math.max(...d.indices)).toBeLessThan(252);
  });
});

describe('GIF encoder', () => {
  it('writes a valid animated GIF whose LZW stream decodes to the quantised first frame', () => {
    const a = createImage(40, 30, [10, 20, 30, 255]);
    const b = createImage(40, 30, [240, 200, 20, 255]);
    for (let y = 5; y < 20; y++) for (let x = 5; x < 30; x++) a.data.set([250, 60, 60, 255], (y * 40 + x) * 4);
    const gif = encodeGif([a, b], 40);
    expect(gif.subarray(0, 6).toString('ascii')).toBe('GIF89a');
    expect(gif[gif.length - 1]).toBe(0x3b);
    const d = decodeGifFirstFrame(gif);
    expect(d).toMatchObject({ width: 40, height: 30, frames: 2 });
    expect(d.indices.length).toBe(40 * 30);
    // red block index differs from the dark background index
    expect(d.indices[10 * 40 + 10]).not.toBe(d.indices[0]);
    expect(() => encodeGif([a, createImage(4, 4)], 40)).toThrow(/same size/);
  });
});

describe('pose renderer', () => {
  const rig = buildReferenceHumanoid('E');
  const { atlas } = buildReferenceAtlas(rig);

  it('draws the textured character on a ground line and mirrors it', () => {
    const img = renderPose(rig, evalPose(rig, null, 0), atlas, { scale: 2 });
    expect(img.width).toBe(256);
    expect(img.height).toBe(256);
    // head colour present near the top of the figure, ground line present
    const px = (x: number, y: number) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
    expect(px(128, 232)).not.toEqual(px(10, 10)); // pivot cross / feet area differs from the background
    const bg = renderPose(rig, evalPose(rig, null, 0), null, { scale: 2 });
    expect(JSON.stringify([...img.data])).not.toBe(JSON.stringify([...bg.data]));
    const mirrored = renderPose(rig, evalPose(rig, null, 0), atlas, { scale: 2, mirror: true });
    expect(mirrored.width).toBe(256);
    expect(JSON.stringify([...mirrored.data])).not.toBe(JSON.stringify([...img.data]));
  });

  it('follows the pose: raising an arm changes the picture, weighted vertices follow their bones', () => {
    const c = new ClipBuilder(rig, { name: 'wave', frames: 4, loop: false });
    c.rotate('upper_arm_R', [
      [0, 0],
      [4, 120],
    ]);
    const clip = c.build();
    const a = renderPose(rig, evalPose(rig, clip, 0), atlas);
    const b = renderPose(rig, evalPose(rig, clip, 4), atlas);
    expect(opaqueCount(a)).toBe(opaqueCount(b)); // background is opaque; compare pixels instead
    expect(JSON.stringify([...a.data])).not.toBe(JSON.stringify([...b.data]));

    // weighted quad: one vertex weighted fully to spine_upper moves when that bone rotates
    const weighted = {
      ...rig,
      skins: [
        {
          name: 'default',
          attachments: {
            body: {
              body: {
                type: 'mesh' as const,
                path: 'body',
                width: 22,
                height: 30,
                uvs: [0, 1, 1, 1, 1, 0, 0, 0],
                vertices: [-11, 0, 11, 0, 11, 28, -11, 28],
                triangles: [0, 1, 2, 0, 2, 3],
                weights: [[['spine_mid', 1]], [['spine_mid', 1]], [['spine_upper', 1]], [['spine_upper', 1]]] as [
                  string,
                  number,
                ][][],
              },
            },
          },
        },
      ],
    };
    const rot = new ClipBuilder(weighted, { name: 'bend', frames: 4, loop: false });
    rot.rotate('spine_upper', [
      [0, 0],
      [4, 50],
    ]);
    const bend = rot.build();
    const flat = renderPose(weighted, evalPose(weighted, bend, 0), atlas);
    const bent = renderPose(weighted, evalPose(weighted, bend, 4), atlas);
    expect(JSON.stringify([...flat.data])).not.toBe(JSON.stringify([...bent.data]));
  });

  it('renders clips and builds contact sheets with frame numbers', () => {
    const clips = authorKiemTuSet(rig, { only: ['idle', 'attack'] });
    const loop = renderClip(rig, clips[0]!, atlas, { scale: 1, step: 5 });
    expect(loop.length).toBe(6); // frames 0,5,...,25 of a 30-frame loop (frame 30 == 0 is not repeated)
    const nonLoop = renderClip(rig, clips[1]!, atlas, { scale: 1 });
    expect(nonLoop.length).toBe(14); // frames 0..13
    const sheet = contactSheet(nonLoop, { columns: 7 });
    expect(sheet.width).toBe(7 * (128 + 2) + 2);
    expect(sheet.height).toBe(2 * (128 + 2) + 2);
  });
});
