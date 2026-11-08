/** D57: verified edit-only reuse of a computed source registration, never an anatomical annotation. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { sheetLayout, type SheetSelection } from './grouped.js';
import { cellRect } from './slice.js';

export interface InheritedRegistration {
  readonly kind: 'inherited-registration';
  /** Pre-edit native sheet and opaque binary grayscale mask, relative to project.json. */
  readonly source: string;
  readonly sourceSha256: string;
  readonly mask: string;
  readonly maskSha256: string;
  /** Clip-local indices; white mask pixels may change, black pixels must match all four bytes. */
  readonly cells: readonly number[];
}

export interface RegistrationEvidence {
  readonly kind: 'inherited-registration';
  readonly sourceSha256: string;
  readonly maskSha256: string;
  readonly editedSha256: string;
  readonly sourceCell: number;
  readonly outsidePixels: number;
  /** Computed logical cropped-cell origin, not anatomy. */
  readonly origin: { readonly x: number; readonly y: number };
  readonly scale: number;
  readonly vertical: 'sole' | 'keep';
}

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function verifyInheritedRegistration(
  input: InheritedRegistration,
  edited: Uint8Array,
  clip: { cols: number; frames: number; sheetSelection?: SheetSelection },
  baseDir: string,
) {
  const fail = (why: string): never => {
    throw new Error(`inherited-registration: ${why}`);
  };
  if (input.kind !== 'inherited-registration' || !input.source?.trim() || !input.mask?.trim())
    fail('source and explicit mask are required');
  const source = readFileSync(resolve(baseDir, input.source));
  const maskBytes = readFileSync(resolve(baseDir, input.mask));
  if (!/^[a-f0-9]{64}$/.test(input.sourceSha256) || hash(source) !== input.sourceSha256) fail('source SHA256 mismatch');
  if (!/^[a-f0-9]{64}$/.test(input.maskSha256) || hash(maskBytes) !== input.maskSha256) fail('mask SHA256 mismatch');
  // Skip PMA conversion deliberately: compare original PNG RGBA, including hidden RGB under alpha 0.
  const before = decodePng(source, { premultiplied: true });
  const after = decodePng(Buffer.from(edited), { premultiplied: true });
  const mask = decodePng(maskBytes, { premultiplied: true });
  if ([after, mask].some((im) => im.width !== before.width || im.height !== before.height))
    fail('source, edited sheet and mask dimensions must match');
  if (
    !Array.isArray(input.cells) ||
    !input.cells.length ||
    new Set(input.cells).size !== input.cells.length ||
    input.cells.some((i) => !Number.isInteger(i) || i < 0 || i >= clip.frames)
  )
    fail('cells must be unique clip-local indices');
  for (let p = 0; p < mask.data.length; p += 4)
    if (
      (mask.data[p] !== 0 && mask.data[p] !== 255) ||
      mask.data[p + 1] !== mask.data[p] ||
      mask.data[p + 2] !== mask.data[p] ||
      mask.data[p + 3] !== 255
    )
      fail('mask must be opaque binary grayscale');
  for (let p = 0; p < mask.data.length; p += 4) {
    if (mask.data[p] === 255) continue;
    for (let k = 0; k < 4; k++)
      if (before.data[p + k] !== after.data[p + k])
        fail('RGBA mismatch outside mask at pixel ' + p / 4 + ', channel ' + k);
  }
  const grid = sheetLayout(clip);
  const verified = new Map<number, { sourceCell: number; outsidePixels: number }>();
  for (const local of input.cells) {
    const sourceCell = clip.sheetSelection?.cells[local] ?? local;
    const r = cellRect(before.width, before.height, grid.cols, grid.rows, sourceCell);
    let outsidePixels = 0;
    for (let y = r.y; y < r.y + r.height; y++)
      for (let x = r.x; x < r.x + r.width; x++) {
        const p = (y * before.width + x) * 4;
        if (mask.data[p] === 255) continue;
        outsidePixels++;
      }
    if (!outsidePixels) fail(`local ${local}: mask must retain locked pixels`);
    verified.set(local, { sourceCell, outsidePixels });
  }
  return {
    source,
    verified,
    sourceSha256: input.sourceSha256,
    maskSha256: input.maskSha256,
    editedSha256: hash(edited),
  };
}
