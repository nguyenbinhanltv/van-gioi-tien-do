import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { Image, decodePNG } = require('../src/lib/png.js');

it('packs explicit extrusion separately from clear padding', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vgtd-extrusion-'));
  try {
    const input = path.join(temp, 'input');
    const output = path.join(temp, 'atlas');
    fs.mkdirSync(input);
    const image = new Image(8, 8);
    image.fill(180, 120, 60, 255);
    image.save(path.join(input, 'sample.png'));
    const result = spawnSync(process.execPath, [path.resolve('pipeline/pack_atlas.js'), '--in', input, '--out', output, '--padding', '2', '--extrude', '1'], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'atlas.json')));
    const frame = manifest.frames.sample;
    const atlas = decodePNG(fs.readFileSync(path.join(output, manifest.pages[0].file)));
    expect(manifest.extrude).toBe(1);
    expect(manifest.padding).toBe(2);
    expect(atlas.getPixel(frame.x - 1, frame.y)).toEqual([180, 120, 60, 255]);
    expect(atlas.getPixel(frame.x - 2, frame.y)[3]).toBe(0);
    expect(atlas.getPixel(frame.x - 3, frame.y)[3]).toBe(0);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
