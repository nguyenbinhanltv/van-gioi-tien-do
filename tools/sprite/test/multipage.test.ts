import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createImage, encodePng } from '@vgtd/rig';
import { buildArmature, packFrames, runProject, type Project } from '../src/index.js';

describe('multi-page display-swap export', () => {
  it('keeps one armature, every display and clip events across page boundaries', () => {
    const inputs = Array.from({ length: 4 }, (_, i) => {
      const image = createImage(50, 50);
      image.data.fill(255);
      return { name: `f${i}`, image };
    });
    const pack = packFrames(inputs, (p) => `body_page${p}_tex.png`, 64);
    expect(pack.pages).toHaveLength(4);
    const built = buildArmature({
      id: 'body',
      direction: 'S',
      name: 'body_S',
      pack,
      clips: [
        {
          name: 'run',
          frames: inputs.map((f) => f.name),
          durationSec: 1,
          loop: true,
          tableId: 'run',
        },
      ],
    });
    const ske = built.export.ske as {
      armature: {
        skin: { slot: { display: { name: string; transform: { scX: number; scY: number } }[] }[] }[];
        animation: { frame: unknown[]; slot: { displayFrame: { value: number }[] }[] }[];
      }[];
    };
    expect(ske.armature).toHaveLength(1);
    const displays = ske.armature[0]!.skin[0]!.slot[0]!.display;
    expect(displays.map((d) => d.name)).toEqual(inputs.map((f) => f.name));
    expect(displays.every((d) => d.transform.scX === 0.5 && d.transform.scY === 0.5)).toBe(true);
    expect(ske.armature[0]!.animation[0]!.slot[0]!.displayFrame.map((f) => f.value)).toEqual([0, 1, 2, 3]);
    expect(JSON.stringify(ske.armature[0]!.animation[0]!.frame)).toContain('footstep_L');
    expect(JSON.stringify(ske.armature[0]!.animation[0]!.frame)).toContain('footstep_R');
    expect(built.textures).toHaveLength(4);
    for (const [i, tex] of built.textures.entries()) {
      expect(tex.imagePath).toBe(`body_page${i}_tex.png`);
      expect(tex.SubTexture).toHaveLength(1);
      expect((tex.SubTexture as { width: number; height: number }[])[0]).toMatchObject({ width: 50, height: 50 });
      expect(tex.premultipliedAlpha).toBe(true);
    }
  });

  it('writes every PNG/JSON page and an optional resource list only when one page overflows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-multipage-project-'));
    const master = createImage(256, 256);
    for (let y = 24; y < 232; y++) for (let x = 28; x < 228; x++) master.data.set([80, 60, 40, 255], (y * 256 + x) * 4);
    writeFileSync(join(dir, 'master.png'), encodePng(master));
    const sheet = createImage(2560, 2560);
    for (let i = 0; i < 100; i++)
      for (let y = 0; y < 256; y++) {
        const offset = ((Math.floor(i / 10) * 256 + y) * sheet.width + (i % 10) * 256) * 4;
        sheet.data.set(master.data.subarray(y * 256 * 4, (y + 1) * 256 * 4), offset);
      }
    writeFileSync(join(dir, 'run.png'), encodePng(sheet));
    const project: Project = {
      character: 'body',
      direction: 'S',
      stem: 'body',
      master: 'master.png',
      palette: { lock: false },
      slice: { key: [255, 0, 255] },
      clips: [
        {
          name: 'run',
          sheet: 'run.png',
          cols: 10,
          frames: 100,
          durationSec: 4,
          loop: true,
          calibration: { scale: 1 },
          tableId: 'run',
        },
      ],
    };
    const result = runProject(project, dir);
    expect(result.contract.atlas.pages).toBeGreaterThan(1);
    expect(result.contract.atlas.regions).toBe(100);
    expect(result.contract.atlas.textures?.length).toBe(result.contract.atlas.pages);
    for (const stem of result.contract.atlas.textures!) {
      expect(result.files.has(`${stem}.json`)).toBe(true);
      expect(result.files.has(`${stem}.png`)).toBe(true);
    }
    expect(result.contract.clips[0]!.records.every((r) => r?.post.height === 208)).toBe(true);
  }, 15000);
});
