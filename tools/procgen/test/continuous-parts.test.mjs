import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

const { Image, decodePNG } = createRequire(import.meta.url)('../src/lib/png.js');
const script = fileURLToPath(new URL('../scripts/continuous_parts.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'vgtd-continuous-parts-'));
afterAll(() => {
  if (relative(tmpdir(), temp).startsWith('..')) throw new Error('Temporary fixture escaped temp directory');
  rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
});

function rectangle(image, x0, y0, x1, y1, colour) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) image.setPixel(x, y, ...colour);
}
const polygon = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
function fixture(name, manifest, master, raw) {
  const source = join(temp, name);
  mkdirSync(join(source, 'raw/E'), { recursive: true });
  master.save(join(source, 'master.png'));
  for (const [id, image] of Object.entries(raw)) image.save(join(source, 'raw/E', `${id}.png`));
  const save = () => writeFileSync(join(source, 'E.parts.json'), JSON.stringify(manifest));
  save();
  const run = (mode, status = 0, output, positionalManifest) => {
    const result = spawnSync(
      process.execPath,
      [
        script,
        mode,
        ...(output ? [output] : []),
        ...(positionalManifest ? [positionalManifest] : []),
        '--source',
        source,
        '--master',
        join(source, 'master.png'),
      ],
      { cwd: root, encoding: 'utf8', timeout: 15000 },
    );
    expect(result.status, result.stderr).toBe(status);
    return result;
  };
  return { source, manifest, save, run, png: (id) => decodePNG(readFileSync(join(source, 'E', `${id}.png`))) };
}

describe('Generic deterministic character part preparation', () => {
  it('removes white matte/speckles while retaining straight alpha and deterministic bytes', () => {
    const master = new Image(512, 512),
      raw = new Image(512, 512);
    rectangle(master, 200, 200, 240, 320, [190, 40, 30, 255]);
    rectangle(raw, 198, 198, 242, 322, [255, 255, 255, 96]);
    rectangle(raw, 200, 200, 240, 320, [190, 40, 30, 255]);
    raw.setPixel(10, 10, 255, 255, 255, 255);
    const f = fixture(
      'alpha',
      {
        paletteSamples: { copper: [[102, 102, 117, 157]] },
        edgeDefringe: true,
        parts: [
          { id: 'piece', materials: ['copper'], registration: 'bounds', polygons: [polygon(100, 100, 120, 160)] },
        ],
        restOrder: ['piece'],
      },
      master,
      { piece: raw },
    );
    const report = join(f.source, 'process.json');
    f.run('process', 0, report);
    const first = readFileSync(join(f.source, 'E/piece.png')),
      image = f.png('piece');
    const edge = [];
    for (let i = 0; i < image.data.length; i += 4)
      if (image.data[i + 3] > 0 && image.data[i + 3] < 250) edge.push([...image.data.slice(i, i + 4)]);
    expect(edge.length).toBeGreaterThan(0);
    expect(edge.every(([r, g, b]) => r <= 191 && g <= 41 && b <= 31)).toBe(true);
    expect(edge.some(([r, , , a]) => r > a)).toBe(true); // Source PNG is straight, not PMA.
    expect(JSON.parse(readFileSync(report)).reports[0].generatedBounds4x.x0).toBe(198);
    f.run('process');
    expect(readFileSync(join(f.source, 'E/piece.png'))).toEqual(first);
    const masks = join(f.source, 'guides');
    f.run('masks', 0, masks, join(f.source, 'E.parts.json'));
    expect(decodePNG(readFileSync(join(masks, 'piece_mask4x.png'))).width).toBe(512);
  });

  it('rotates before source selection and preserves contour holes after fitting', () => {
    const master = new Image(512, 512),
      raw = new Image(512, 512);
    master.fill(70, 60, 50, 255);
    rectangle(raw, 200, 200, 240, 320, [200, 160, 120, 255]);
    rectangle(raw, 200, 260, 240, 320, [40, 30, 20, 255]);
    rectangle(raw, 200, 120, 240, 170, [250, 250, 250, 255]); // Unwanted cap, outside rotated selection.
    const f = fixture(
      'rotate',
      {
        paletteSamples: { cloth: [[100, 100, 110, 110]] },
        parts: [
          {
            id: 'sleeve',
            materials: ['cloth'],
            registration: 'contour',
            sourceQuarterTurns: 1,
            sourceBounds4x: [190, 190, 320, 250],
            polygons: [polygon(100, 100, 160, 120)],
            excludePolygons: [polygon(128, 105, 132, 115)],
          },
        ],
        restOrder: ['sleeve'],
      },
      master,
      { sleeve: raw },
    );
    f.run('process');
    const image = f.png('sleeve');
    expect(image.getPixel(150, 110)[0]).toBeGreaterThan(image.getPixel(110, 110)[0] + 20);
    expect(image.getPixel(130, 110)[3]).toBe(0);
    expect(image.getPixel(102, 110)[3]).toBeGreaterThan(200);
  });

  it('maps bright metal labels while explicit material regions retain precedence', () => {
    const master = new Image(512, 512),
      raw = new Image(512, 512);
    master.fill(50, 60, 80, 255);
    rectangle(master, 0, 0, 20, 20, [200, 160, 80, 255]);
    rectangle(raw, 200, 200, 240, 320, [220, 180, 150, 255]);
    const part = {
      materials: ['blue', 'gold'],
      materialAliases: { skin: 'gold' },
      registration: 'bounds',
      polygons: [polygon(100, 100, 120, 160)],
    };
    const f = fixture(
      'aliases',
      {
        paletteSamples: { blue: [[20, 20, 30, 30]], gold: [[0, 0, 8, 8]] },
        parts: [
          { ...part, id: 'aliased' },
          { ...part, id: 'explicit', materialRegions: [{ material: 'blue', polygon: polygon(0, 0, 256, 256) }] },
        ],
        restOrder: ['aliased'],
      },
      master,
      { aliased: raw, explicit: raw },
    );
    f.run('process');
    const a = f.png('aliased').getPixel(110, 120),
      e = f.png('explicit').getPixel(110, 120);
    expect(a[0] - a[2]).toBeGreaterThan(80);
    expect(e[0] - e[2]).toBeLessThan(5);
  });

  it('keeps inactive swap silhouettes without relaxing independent rest registration', () => {
    const master = new Image(512, 512),
      raw = new Image(512, 512);
    rectangle(master, 200, 200, 240, 320, [70, 60, 50, 255]);
    rectangle(raw, 200, 200, 240, 320, [70, 60, 50, 255]);
    const f = fixture(
      'rest',
      {
        paletteSamples: { cloth: [[102, 102, 117, 157]] },
        silhouetteMargin4x: 2,
        parts: [
          { id: 'rest', materials: ['cloth'], registration: 'contour', polygons: [polygon(100, 100, 120, 160)] },
          {
            id: 'swap',
            materials: ['cloth'],
            registration: 'contour',
            clipToMaster: false,
            polygons: [polygon(140, 100, 160, 160)],
          },
        ],
        restOrder: ['rest'],
      },
      master,
      { rest: raw, swap: raw },
    );
    f.run('process');
    expect(f.png('swap').getPixel(150, 120)[3]).toBe(255);
    const report = join(f.source, 'registration.json');
    f.run('check', 0, report);
    expect(JSON.parse(readFileSync(report)).pass).toBe(true);
    f.manifest.parts[0].polygons = [polygon(105, 100, 115, 160)];
    f.save();
    f.run('process');
    f.run('check', 1, report);
    const failed = JSON.parse(readFileSync(report));
    expect(failed.pass).toBe(false);
    expect(failed.maxMissingPx).toBeGreaterThan(2);
  });

  it('reports translucent contour paint clearly and retains opacity with bounds registration', () => {
    const master = new Image(512, 512),
      raw = new Image(512, 512);
    master.fill(190, 40, 30, 255);
    rectangle(raw, 200, 200, 240, 320, [190, 40, 30, 100]);
    const f = fixture(
      'translucent',
      {
        paletteSamples: { cloth: [[100, 100, 110, 110]] },
        parts: [
          { id: 'ribbon', materials: ['cloth'], registration: 'contour', polygons: [polygon(100, 100, 120, 160)] },
        ],
        restOrder: ['ribbon'],
      },
      master,
      { ribbon: raw },
    );
    expect(f.run('process', 1).stderr).toContain('ribbon: contour registration needs opaque (alpha>=128) source paint');
    f.manifest.parts[0].registration = 'bounds';
    f.save();
    f.run('process');
    expect(f.png('ribbon').getPixel(110, 120)[3]).toBe(100);
  });

  it('rejects unknown or duplicate rest IDs before reading or compositing outputs', () => {
    const master = new Image(512, 512);
    master.fill(70, 60, 50, 255);
    const f = fixture(
      'rest-ids',
      {
        paletteSamples: { cloth: [[0, 0, 10, 10]] },
        parts: [{ id: 'piece', materials: ['cloth'], polygons: [polygon(100, 100, 120, 160)] }],
        restOrder: ['typo', 'missing'],
      },
      master,
      {},
    );
    expect(f.run('check', 1).stderr).toContain('restOrder: unknown part typo, missing');
    f.manifest.restOrder = ['piece', 'piece'];
    f.save();
    expect(f.run('check', 1).stderr).toContain('restOrder: duplicate part piece');
  });

  it('rejects material regions not declared by the part', () => {
    const master = new Image(512, 512);
    master.fill(70, 60, 50, 255);
    const f = fixture(
      'region-material',
      {
        paletteSamples: { cloth: [[0, 0, 10, 10]] },
        parts: [
          {
            id: 'cuff',
            materials: ['cloth'],
            polygons: [polygon(100, 100, 120, 160)],
            materialRegions: [{ material: 'typo', polygon: polygon(100, 100, 110, 110) }],
          },
        ],
        restOrder: ['cuff'],
      },
      master,
      {},
    );
    expect(f.run('process', 1).stderr).toContain('cuff: materialRegions: undeclared material typo');
  });

  it('lists missing raw IDs on stderr while processing the available cohort', () => {
    const master = new Image(512, 512),
      raw = new Image(512, 512);
    master.fill(70, 60, 50, 255);
    rectangle(raw, 200, 200, 240, 320, [70, 60, 50, 255]);
    const f = fixture(
      'partial',
      {
        paletteSamples: { cloth: [[0, 0, 10, 10]] },
        parts: ['ready', 'pending', 'later'].map((id) => ({
          id,
          materials: ['cloth'],
          registration: 'bounds',
          polygons: [polygon(100, 100, 120, 160)],
        })),
        restOrder: ['ready'],
      },
      master,
      { ready: raw },
    );
    const result = f.run('process');
    expect(result.stderr).toContain('Skipped parts with missing raw PNGs: pending, later');
    expect(JSON.parse(result.stdout).map((part) => part.id)).toEqual(['ready']);
  });

  it('requires explicit inputs and rejects unsafe output IDs', () => {
    const result = spawnSync(process.execPath, [script, 'process'], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Provide --source');
    const master = new Image(512, 512);
    master.fill(70, 60, 50, 255);
    const f = fixture(
      'invalid',
      {
        paletteSamples: { cloth: [[0, 0, 10, 10]] },
        parts: [{ id: '../escape', materials: ['cloth'], polygons: [polygon(100, 100, 120, 160)] }],
      },
      master,
      {},
    );
    expect(f.run('process', 1).stderr).toContain('safe path segments');
  });
});
