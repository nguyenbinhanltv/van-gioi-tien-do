import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodePng } from '@vgtd/rig';
import {
  POSE_JOINTS,
  auditProjectVariant,
  compareVariantCell,
  emptyBacklog,
  runProject,
  toPremultiplied,
  toStraight,
  validateBacklog,
  type Project,
  type VariantCellAnnotation,
} from '../src/index.js';
import { figureImage, makeMaster, makeSheet } from './helpers.js';

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const annotation = (): VariantCellAnnotation => {
  const joints = Object.fromEntries(
    POSE_JOINTS.map((name, i) => [name, { x: 100 + i, y: 100 + i }]),
  ) as VariantCellAnnotation['master'];
  return { master: joints, edited: structuredClone(joints), face: { rect: { x: 110, y: 24, width: 36, height: 36 } } };
};
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'vgtd-variant-'));
  writeFileSync(join(dir, 'master.png'), encodePng(makeMaster()));
  const sheet = makeSheet(
    2,
    1,
    256,
    [0, 1].map(() => ({ height: 208, cx: 128, sole: 232 })),
  );
  const png = encodePng(toPremultiplied(sheet));
  writeFileSync(join(dir, 't1.png'), png);
  writeFileSync(join(dir, 't2.png'), png);
  const master: Project = {
    character: 'test',
    direction: 'E',
    stem: 't1',
    master: 'master.png',
    scale: 1,
    clips: [{ name: 'idle', tableId: 'idle', sheet: 't1.png', cols: 2, frames: 2, durationSec: 1, loop: true }],
  };
  const masterBytes = Buffer.from(JSON.stringify(master));
  writeFileSync(join(dir, 't1.json'), masterBytes);
  writeFileSync(join(dir, 'annotations.json'), JSON.stringify([annotation(), annotation()]));
  const project: Project = {
    ...master,
    stem: 't2',
    variant: {
      kind: 'edit-from-master-v1',
      category: 'tier',
      id: 'T2',
      masterProject: 't1.json',
      masterProjectSha256: sha(masterBytes),
      edit: { tool: 'test-edit-tool', prompt: 'Change clothing only, preserve all poses and faces.' },
      thresholds: { minSilhouetteIou: 0.95, maxJointDistancePx: 1, minFaceSimilarity: 0.99 },
    },
    clips: master.clips.map((c) => ({
      ...c,
      sheet: 't2.png',
      variant: { masterSheetSha256: sha(png), annotations: 'annotations.json' },
    })),
  };
  return { dir, project, master };
}

describe('edit-from-master variants', () => {
  it('audits through the lightweight CLI without building an atlas', () => {
    const { dir, project } = fixture();
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project));
    const cwd = fileURLToPath(new URL('../', import.meta.url));
    const invoke = () =>
      spawnSync(
        process.execPath,
        [resolve(cwd, '../rig/scripts/run-ts.mjs'), 'scripts/variant-check.ts', '--project', join(dir, 'project.json')],
        { cwd, encoding: 'utf8' },
      );
    const good = invoke();
    expect(good.status, good.stderr).toBe(0);
    expect(JSON.parse(good.stdout).clips[0].metrics).toHaveLength(2);
    const annotations = [annotation(), annotation()];
    (annotations[0]!.edited.hand_L as { x: number }).x += 10;
    writeFileSync(join(dir, 'annotations.json'), JSON.stringify(annotations));
    const bad = invoke();
    expect(bad.status, bad.stderr).toBe(1);
    expect(JSON.parse(bad.stdout).findings[0].gate).toBe('poseLock');
  });

  it('pins external calibration and handles selected cells from grouped sheets', () => {
    const { dir, project, master } = fixture();
    const calibration = Buffer.from('{"scale":1}');
    writeFileSync(join(dir, 'calibration.json'), calibration);
    const selection = { rows: 1, cells: [1, 0] };
    const bytes = Buffer.from(
      JSON.stringify({
        ...master,
        preparation: { kind: 'square-cell-dpi-v1', calibration: 'calibration.json' },
        clips: master.clips.map((c) => ({ ...c, sheetSelection: selection })),
      }),
    );
    writeFileSync(join(dir, 't1.json'), bytes);
    const p: Project = {
      ...project,
      variant: { ...project.variant!, masterProjectSha256: sha(bytes), masterCalibrationSha256: sha(calibration) },
      clips: project.clips.map((c) => ({ ...c, sheetSelection: selection })),
    };
    expect(auditProjectVariant(p, dir)!.findings).toEqual([]);
    writeFileSync(join(dir, 'calibration.json'), '{"scale":0.9}');
    expect(() => auditProjectVariant(p, dir)).toThrow(/master calibration: SHA256 mismatch/);
  });
  it('pins provenance and records every cell in normal project output', () => {
    const { dir, project } = fixture();
    const result = runProject(project, dir);
    expect(result.contract.qa.ok).toBe(true);
    expect(result.contract.variant!.source.id).toBe('T2');
    expect(result.contract.variant!.clips[0]!.metrics).toEqual(
      [0, 1].map((cell) => ({ cell, silhouetteIou: 1, maxJointDistancePx: 0, faceSimilarity: 1 })),
    );
    expect(JSON.parse(result.files.get('t2_E.sprite.json') as string).variant.clips[0].annotationsSha256).toBe(
      sha(readFileSync(join(dir, 'annotations.json'))),
    );
  });

  it('allows clothing recolor while checking the unchanged face and silhouette', () => {
    const a = toStraight(figureImage({ height: 208, cx: 128, sole: 232 }));
    const b = structuredClone(a);
    for (let y = 90; y < 130; y++)
      for (let x = 110; x < 146; x++) {
        const i = (y * 256 + x) * 4;
        b.data[i] = 180;
      }
    expect(compareVariantCell(a, b, annotation(), 0)).toEqual({
      cell: 0,
      silhouetteIou: 1,
      maxJointDistancePx: 0,
      faceSimilarity: 1,
    });
  });

  it('fails pose drift before translation alignment can conceal it', () => {
    const { dir, project } = fixture();
    writeFileSync(
      join(dir, 't2.png'),
      encodePng(
        toPremultiplied(
          makeSheet(
            2,
            1,
            256,
            [0, 1].map(() => ({ height: 208, cx: 148, sole: 232 })),
          ),
        ),
      ),
    );
    const result = runProject(project, dir);
    expect(result.contract.qa.ok).toBe(false);
    expect(result.contract.qa.judged.some((j) => j.finding.gate === 'poseLock' && j.verdict === 'fail-hard')).toBe(
      true,
    );
  });

  it('fails joint drift and face recolor as hard findings', () => {
    const { dir, project } = fixture();
    const annotations = [annotation(), annotation()];
    (annotations[0]!.edited.hand_R as { x: number }).x += 10;
    writeFileSync(join(dir, 'annotations.json'), JSON.stringify(annotations));
    const sheet = makeSheet(
      2,
      1,
      256,
      [0, 1].map(() => ({ height: 208, cx: 128, sole: 232, head: [10, 20, 30] as const })),
    );
    writeFileSync(join(dir, 't2.png'), encodePng(toPremultiplied(sheet)));
    const audit = auditProjectVariant(project, dir)!;
    expect(audit.findings.some((f) => f.metric === 'joint_distance_px')).toBe(true);
    expect(audit.findings.some((f) => f.gate === 'faceLock')).toBe(true);
    for (const finding of audit.findings)
      expect(() =>
        validateBacklog({
          ...emptyBacklog('test'),
          entries: [
            {
              clip: finding.clip,
              dir: 'E',
              cell: finding.frame!,
              gate: finding.gate,
              metric: finding.metric!,
              value: finding.value!,
              limit: finding.limit!,
              note: 'cannot waive',
              status: 'open',
            },
          ],
        }),
      ).toThrow(/hard/);
  });

  it('rejects changed hashes, motion timing, scale and missing cell evidence', () => {
    const { dir, project } = fixture();
    expect(() =>
      auditProjectVariant({ ...project, variant: { ...project.variant!, masterProjectSha256: '0'.repeat(64) } }, dir),
    ).toThrow(/SHA256/);
    expect(() =>
      auditProjectVariant(
        {
          ...project,
          clips: project.clips.map((c) => ({ ...c, variant: { ...c.variant!, masterSheetSha256: '0'.repeat(64) } })),
        },
        dir,
      ),
    ).toThrow(/SHA256/);
    expect(() =>
      auditProjectVariant({ ...project, clips: project.clips.map((c) => ({ ...c, durationSec: 2 })) }, dir),
    ).toThrow(/motion\/timing/);
    expect(() => auditProjectVariant({ ...project, scale: 0.8 }, dir)).toThrow(/scale/);
    expect(() => auditProjectVariant({ ...project, scale: undefined }, dir)).toThrow(/locked explicit scale/);
    expect(() =>
      auditProjectVariant({ ...project, clips: project.clips.map((c) => ({ ...c, variant: undefined })) }, dir),
    ).toThrow(/hashed reference/);
    writeFileSync(join(dir, 'annotations.json'), '[]');
    expect(() => auditProjectVariant(project, dir)).toThrow(/every cell/);
  });

  it('reports rear-face occlusion as explicitly unmeasured, and rejects hiding a front face', () => {
    const { dir, project, master } = fixture();
    const annotations = [annotation(), annotation()].map((a) => ({ ...a, face: { occluded: 'rear of head' } }));
    writeFileSync(join(dir, 'annotations.json'), JSON.stringify(annotations));
    expect(() => auditProjectVariant(project, dir)).toThrow(/rear-facing/);
    const bytes = Buffer.from(JSON.stringify({ ...master, direction: 'N' }));
    writeFileSync(join(dir, 't1.json'), bytes);
    const audit = auditProjectVariant(
      { ...project, direction: 'N', variant: { ...project.variant!, masterProjectSha256: sha(bytes) } },
      dir,
    )!;
    expect(audit.findings.every((f) => f.measurement === 'unmeasured')).toBe(true);
    expect(audit.clips[0]!.metrics[0]!.faceSimilarity).toBeNull();
  });
});
