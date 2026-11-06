import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { encodePng } from '@vgtd/rig';
import {
  assertDirection,
  assertInside,
  assertSlug,
  reviewHtml,
  runBatch,
  toPremultiplied,
  type BatchReport,
  type Project,
} from '../src/index.js';
import { makeMaster, makeSheet } from './helpers.js';

function setup(bad = false) {
  const root = mkdtempSync(join(tmpdir(), 'vgtd-batch-'));
  const projects: string[] = [];
  for (const dir of ['E', 'SE'] as const) {
    const d = join(root, dir);
    mkdirSync(d);
    writeFileSync(join(d, 'master.png'), encodePng(makeMaster(208, 128)));
    const idle = makeSheet(2, 1, 256, [
      { height: 208, cx: 128, sole: 232 },
      { height: dir === 'SE' && bad ? 150 : 209, cx: 128, sole: 232 },
    ]);
    writeFileSync(join(d, 'idle.png'), encodePng(toPremultiplied(idle)));
    const project: Project = {
      character: 'kiem-tu',
      direction: dir,
      stem: 'kiemtu',
      master: 'master.png',
      clips: [
        {
          name: 'idle',
          sheet: 'idle.png',
          cols: 2,
          frames: 2,
          durationSec: 1,
          loop: true,
          tableId: 'idle',
          calibration: { scale: 1 },
        },
      ],
    };
    writeFileSync(join(d, 'project.json'), JSON.stringify(project));
    projects.push(`${dir}/project.json`);
  }
  writeFileSync(join(root, 'batch.json'), JSON.stringify({ character: 'kiem-tu', projects }));
  return root;
}

describe('runBatch', () => {
  it('builds every direction, writes outputs and a report, and reports ok', () => {
    const root = setup();
    const out = join(root, 'out');
    const run = runBatch(join(root, 'batch.json'), out);
    expect(run.report.ok).toBe(true);
    expect(run.report.dirs.map((d) => d.dir)).toEqual(['E', 'SE']);
    for (const d of ['E', 'SE']) {
      expect(existsSync(join(out, d, `kiemtu_${d}_ske.json`))).toBe(true);
      expect(existsSync(join(out, d, `kiemtu_${d}_tex.png`))).toBe(true);
      expect(existsSync(join(out, d, `kiemtu_${d}.sprite.json`))).toBe(true);
    }
    const written = JSON.parse(readFileSync(join(out, 'batch-report.json'), 'utf8')) as BatchReport;
    expect(written.dirs[0]!.clips[0]).toMatchObject({ name: 'idle', frames: 2, status: 'ok' });
  });

  it('a failing direction makes the batch fail and the clip status fail', () => {
    const root = setup(true);
    const run = runBatch(join(root, 'batch.json'), join(root, 'out'));
    expect(run.report.ok).toBe(false);
    expect(run.report.dirs.find((d) => d.dir === 'E')!.ok).toBe(true);
    const se = run.report.dirs.find((d) => d.dir === 'SE')!;
    expect(se.ok).toBe(false);
    expect(se.clips[0]!.status).toBe('fail');
    expect(se.clips[0]!.counts.hard).toBeGreaterThan(0);
  });

  it('rejects a project of another character or a duplicate direction', () => {
    const root = setup();
    const batch = JSON.parse(readFileSync(join(root, 'batch.json'), 'utf8')) as { projects: string[] };
    writeFileSync(
      join(root, 'dup.json'),
      JSON.stringify({ character: 'kiem-tu', projects: [batch.projects[0], batch.projects[0]] }),
    );
    expect(() => runBatch(join(root, 'dup.json'), join(root, 'o'))).toThrow(/twice/);
    writeFileSync(join(root, 'other.json'), JSON.stringify({ character: 'the-tu', projects: [batch.projects[0]] }));
    expect(() => runBatch(join(root, 'other.json'), join(root, 'o'))).toThrow(/character/);
  });
});

describe('batch path safety', () => {
  it('uses the original entry for capture staging and Cocos commands when bundled outside the repo', async () => {
    const root = setup();
    const bundleDir = mkdtempSync(join(tmpdir(), 'vgtd-relocated-batch-'));
    const bundle = join(bundleDir, 'script.mjs');
    const trace = join(bundleDir, 'commands.jsonl');
    const entry = join(root, 'tools/sprite/scripts/batch.ts');
    const out = join(root, 'out');
    await build({
      entryPoints: [join(process.cwd(), 'scripts/batch.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: bundle,
      banner: {
        js: `import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); process.argv=[process.argv[0],${JSON.stringify(entry)},'--batch',${JSON.stringify(join(root, 'batch.json'))},'--out',${JSON.stringify(out)},'--capture','--keep-staged'];`,
      },
      plugins: [
        {
          name: 'stub-cocos-processes',
          setup(b) {
            b.onResolve({ filter: /^node:child_process$/ }, () => ({ path: 'commands', namespace: 'capture-stub' }));
            b.onLoad({ filter: /.*/, namespace: 'capture-stub' }, () => ({
              contents: `import {appendFileSync} from 'node:fs'; export function spawnSync(exe,args){appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n'); return {status:0};}`,
            }));
          },
        },
      ],
    });
    execFileSync(process.execPath, [bundle], { env: { ...process.env, INIT_CWD: root } });
    const commands = readFileSync(trace, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    const client = join(root, 'apps/client-cocos');
    expect(commands[0]![0]).toBe(join(client, 'scripts/build-web.mjs'));
    expect(commands.slice(1).map((args) => args[0])).toEqual([
      join(client, 'scripts/capture.mjs'),
      join(client, 'scripts/capture.mjs'),
    ]);
    for (const dir of ['E', 'SE'])
      expect(existsSync(join(client, `assets/resources/dragonbones/_batch-kiem-tu-${dir}/kiemtu_${dir}_tex.png`))).toBe(
        true,
      );
    for (const dir of ['E', 'SE'])
      expect(
        existsSync(join(client, `assets/resources/dragonbones/_batch-kiem-tu-${dir}/kiemtu_${dir}.sprite.json`)),
      ).toBe(true);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
  });

  it('rejects a character that could escape the output / resources folders', () => {
    const root = setup();
    for (const bad of ['../x', 'a/b', 'a\b', '', 'X', '.', '..', '/abs']) {
      writeFileSync(join(root, 'bad.json'), JSON.stringify({ character: bad, projects: ['E/project.json'] }));
      expect(() => runBatch(join(root, 'bad.json'), join(root, 'o')), bad).toThrow(/slug/);
    }
    expect(assertSlug('kiem-tu', 'c')).toBe('kiem-tu');
    expect(assertSlug('the_tu2', 'c')).toBe('the_tu2');
  });

  it('rejects an invalid direction or stem in a project', () => {
    const root = setup();
    const p = JSON.parse(readFileSync(join(root, 'E/project.json'), 'utf8')) as Project;
    writeFileSync(join(root, 'E/project.json'), JSON.stringify({ ...p, direction: '../E' }));
    expect(() => runBatch(join(root, 'batch.json'), join(root, 'o'))).toThrow(/direction/);
    writeFileSync(join(root, 'E/project.json'), JSON.stringify({ ...p, stem: '../evil' }));
    expect(() => runBatch(join(root, 'batch.json'), join(root, 'o'))).toThrow(/stem/);
    expect(assertDirection('SE')).toBe('SE');
    expect(() => assertDirection('X')).toThrow();
  });

  it('assertInside refuses the root itself and anything outside it', () => {
    const root = join(tmpdir(), 'resources');
    expect(assertInside(root, join(root, '_batch-x-E'))).toContain('_batch-x-E');
    expect(() => assertInside(root, join(root, '..', 'other'))).toThrow(/outside/);
    expect(() => assertInside(root, root)).toThrow(/outside/);
    expect(() => assertInside(root, join(root, 'a', '..', '..', 'x'))).toThrow(/outside/);
  });
});

describe('reviewHtml', () => {
  const report = (character: string, gif?: string): BatchReport => ({
    format: 'vgtd-sprite-batch',
    version: 1,
    character,
    ok: false,
    dirs: [
      {
        dir: 'E',
        stem: 'x',
        ok: false,
        atlas: { pages: 1, width: 2048, height: 2048, regions: 60 },
        backlogEntries: 3,
        resolvedEntries: 1,
        folder: `${character}/E`,
        clips: [
          {
            name: 'run',
            frames: 12,
            durationSec: 0.5,
            kind: 'upright',
            status: 'warn',
            counts: { hard: 0, soft: 0, regression: 0, accepted: 2, info: 0 },
            ...(gif ? { gif } : {}),
          },
          {
            name: 'die',
            frames: 8,
            durationSec: 0.7,
            kind: 'free',
            status: 'fail',
            counts: { hard: 1, soft: 0, regression: 0, accepted: 0, info: 3 },
          },
        ],
      },
    ],
  });

  it('lists every character, direction and clip with GIFs and statuses', () => {
    const html = reviewHtml([report('kiem-tu', 'kiem-tu/E/run.gif'), report('the-tu')], 'Review <all>');
    expect(html).toContain('Review &lt;all&gt;');
    expect(html).toContain('id="c-kiem-tu"');
    expect(html).toContain('id="c-the-tu"');
    expect(html).toContain('<img src="kiem-tu/E/run.gif"');
    expect(html).toContain('no capture');
    expect(html.match(/class="chip fail"/g)!.length).toBeGreaterThan(0);
    expect(html).toContain('2 characters · 4 clips · 2 failing · 2 with accepted warnings');
    expect(html).toContain('kiem-tu/E/x_E.sprite.json');
  });
});
