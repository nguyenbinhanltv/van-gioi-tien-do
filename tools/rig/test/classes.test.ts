import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DRAWN_DIRECTIONS, type Direction } from '@vgtd/shared';
import { PAPERDOLL_SLOTS, type SlotId } from '@vgtd/character';
import {
  CHARACTER_IDS,
  CLASSES,
  KIEMTU_CLIPS,
  KIEMTU_REQUIRED_ROLES,
  SLOT_LAYOUT,
  authorClassSet,
  authorKiemTuSet,
  buildCharacterPackage,
  buildRigTemplate,
  buildViewerPackage,
  characterPaths,
  checkPartsManifest,
  clipSpec,
  encodePng,
  createImage,
  loadCharacterData,
  loadKiemTuData,
  packTemplateAtlas,
  partsSpec,
  partsSpecMarkdown,
  requiredOverlapPx,
  runQa,
  scanPartsFolder,
  specIdForClipName,
  validateRigSet,
  type CharacterId,
  type PartDims,
  type PartsManifest,
} from '../src/index.js';
import { engineRuntimePath, loadRuntime } from './helpers/dbRuntime.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SPEC_DOC = join(repoRoot, 'docs/art/parts-spec.md');

/** A synthetic parts manifest: every slot the class asks for, nominal sizes (what a first-pass painting would be). */
function nominalManifest(id: CharacterId, dirs: readonly Direction[] = DRAWN_DIRECTIONS): PartsManifest {
  const cls = CLASSES[id];
  const slots = [...cls.slots.required, ...cls.slots.optional.filter((s) => s === 'headwear')];
  const parts: Partial<Record<SlotId, PartDims>> = {};
  for (const s of slots) parts[s] = { width: SLOT_LAYOUT[s]!.w, height: SLOT_LAYOUT[s]!.h };
  return { character: id, directions: Object.fromEntries(dirs.map((d) => [d, parts])) };
}

describe('registry', () => {
  it('has the four Đạo Lộ with unique stems and a consistent weapon rule', () => {
    expect(CHARACTER_IDS).toEqual(['kiem-tu', 'the-tu', 'phap-tu', 'dan-phu-tu']);
    expect(new Set(CHARACTER_IDS.map((i) => CLASSES[i].stem)).size).toBe(4);
    const slotIds = new Set<SlotId>(PAPERDOLL_SLOTS.map((s) => s.id));
    for (const id of CHARACTER_IDS) {
      const c = CLASSES[id];
      expect(c.id).toBe(id);
      for (const s of [...c.slots.required, ...c.slots.optional]) expect(slotIds.has(s)).toBe(true);
      // the weapon slot is required exactly when the class has one
      expect(c.slots.required.includes('weapon_R')).toBe(c.weapon.slot === 'weapon_R');
      expect(c.slots.optional.includes('sword_back')).toBe(c.weapon.backSlot);
      expect(characterPaths(id).viewerDir).toBe(`apps/client-cocos/assets/resources/dragonbones/${id}`);
    }
    expect(CLASSES['the-tu'].weapon).toMatchObject({ kinds: ['gauntlets'], slot: null, hands: 'both' });
    expect(CLASSES['phap-tu'].weapon.kinds).toEqual(['staff', 'fan']);
    expect(CLASSES['dan-phu-tu'].weapon.kinds).toEqual(['whisk', 'brush']);
    expect(CLASSES['dan-phu-tu'].orbit).toEqual({ kind: 'talisman', count: 4 });
  });
});

describe('parts spec', () => {
  it('overlap formula reproduces the measured Kiếm tu needs and grows with angle and width', () => {
    expect(Math.abs(requiredOverlapPx(23, 90) - 31)).toBeLessThanOrEqual(3); // robe vs thigh, measured 31
    expect(Math.abs(requiredOverlapPx(18, 70) - 20)).toBeLessThanOrEqual(2); // vest vs sleeve, measured 20
    expect(requiredOverlapPx(20, 0)).toBe(0);
    expect(requiredOverlapPx(20, 90)).toBeGreaterThan(requiredOverlapPx(20, 45));
    expect(requiredOverlapPx(30, 60)).toBeGreaterThan(requiredOverlapPx(15, 60));
  });

  it('lists the right pieces per class and uses the class joint caps', () => {
    const kiem = partsSpec('kiem-tu');
    const the = partsSpec('the-tu');
    expect(kiem.parts.find((p) => p.slot === 'weapon_R')?.required).toBe(true);
    expect(the.parts.some((p) => p.slot === 'weapon_R')).toBe(false);
    expect(the.weapon).toMatch(/no weapon_R/);
    const shoulder = (spec: ReturnType<typeof partsSpec>) =>
      spec.parts.find((p) => p.slot === 'arm_R')!.joints.find((j) => j.joint === 'shoulder')!;
    expect(shoulder(kiem).capDeg).toBe(CLASSES['kiem-tu'].caps.shoulder);
    expect(shoulder(kiem).overlapPx).toBeGreaterThan(shoulder(the).overlapPx); // Kiếm tu raises the arm further
  });

  // regenerate with: RIG_GEN_PARTS_SPEC=1 npm run gen:parts-spec -w @vgtd/rig
  (process.env.RIG_GEN_PARTS_SPEC ? it : it.skip)('writes docs/art/parts-spec.md', () => {
    writeFileSync(SPEC_DOC, partsSpecMarkdown());
    expect(readFileSync(SPEC_DOC, 'utf-8')).toContain('Đặc tả mảnh');
  });

  it('docs/art/parts-spec.md is the committed output of the generator', () => {
    // prettier re-pads Markdown tables: compare modulo whitespace and separator-row dashes
    const norm = (t: string) =>
      t
        .replace(/-{2,}/g, '-')
        .replace(/ +/g, ' ')
        .replace(/ ?\| ?/g, '|')
        .trim();
    expect(norm(readFileSync(SPEC_DOC, 'utf-8'))).toBe(norm(partsSpecMarkdown()));
  });
});

describe('rig template from parts', () => {
  it.each(CHARACTER_IDS)('%s: valid RigSet for all 5 directions, weapon rules and draw order enforced', (id) => {
    const set = buildRigTemplate(nominalManifest(id));
    expect(Object.keys(set.rigs)).toEqual([...DRAWN_DIRECTIONS]);
    expect(validateRigSet(set, { requireRoles: KIEMTU_REQUIRED_ROLES }).filter((i) => i.severity === 'error')).toEqual(
      [],
    );
    const cls = CLASSES[id];
    for (const rig of Object.values(set.rigs)) {
      const names = rig!.slots.map((s) => s.name);
      expect(names.includes('weapon_R')).toBe(cls.weapon.slot === 'weapon_R');
      for (const c of cls.chains) expect(rig!.chains!.some((x) => x.name === c.name)).toBe(true);
      if (cls.weapon.backSlot)
        expect(rig!.slots.every((s) => s.name !== 'sword_back' || s.attachment === null)).toBe(true);
    }
  });

  it('rejects manifests that break the class rules', () => {
    const base = nominalManifest('the-tu');
    const withWeapon: PartsManifest = {
      ...base,
      directions: { S: { ...base.directions.S!, weapon_R: { width: 10, height: 50 } } },
    };
    expect(checkPartsManifest(withWeapon).some((i) => /gauntlets/.test(i.message))).toBe(true);
    const { arm_R: _drop, ...rest } = base.directions.S!;
    expect(
      checkPartsManifest({ ...base, directions: { S: rest } }).some((i) =>
        /missing required piece 'arm_R'/.test(i.message),
      ),
    ).toBe(true);
    const phap = nominalManifest('phap-tu');
    const withBack: PartsManifest = {
      ...phap,
      directions: { S: { ...phap.directions.S!, sword_back: { width: 10, height: 52 } } },
    };
    expect(checkPartsManifest(withBack).some((i) => /no sheathed weapon/.test(i.message))).toBe(true);
    const orbit = { ...base, directions: { S: { ...base.directions.S!, orbit_front: { width: 10, height: 10 } } } };
    expect(checkPartsManifest(orbit).some((i) => /sprite nodes/.test(i.message))).toBe(true);
    expect(() => buildRigTemplate(withWeapon)).toThrow(/gauntlets/);
    expect(
      checkPartsManifest({
        character: 'the-tu',
        directions: { SW: base.directions.S! } as PartsManifest['directions'],
      }).some((i) => /mirrors/.test(i.message)),
    ).toBe(true);
  });

  it('scanPartsFolder reads PNG sizes and divides by the texture scale', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-parts-'));
    mkdirSync(join(dir, 'S'));
    writeFileSync(join(dir, 'S', 'body.png'), encodePng(createImage(44, 60)));
    writeFileSync(join(dir, 'S', 'notes.txt'), 'ignored');
    const m = scanPartsFolder(dir, 'the-tu');
    expect(m.directions.S!.body).toEqual({ width: 22, height: 30 });
    expect(Object.keys(m.directions)).toEqual(['S']);
  });
});

describe('animation re-targeting and export, every class', () => {
  it.each(CHARACTER_IDS)('%s: full clip set passes QA on every direction and exports', async (id) => {
    const cls = CLASSES[id];
    const set = buildRigTemplate(nominalManifest(id));
    for (const [dir, rig] of Object.entries(set.rigs)) {
      const clips = authorClassSet(id, rig!);
      expect(clips.map((c) => c.name)).toEqual([...KIEMTU_CLIPS]);
      for (const clip of clips) {
        const sid = specIdForClipName(clip.name);
        const errors = runQa(rig!, clip, {
          ...(sid ? { spec: clipSpec(sid) } : {}),
          weapon: cls.weapon.slot ? 'one' : 'none',
        }).issues.filter((i) => i.severity === 'error');
        expect(errors, `${id}/${dir}/${clip.name}`).toEqual([]);
      }
      if (dir !== 'E') continue;
      const atlas = packTemplateAtlas(rig!, `${cls.stem}_E_tex.png`);
      const pkg = buildCharacterPackage([{ rig: rig!, clips }], atlas, {
        name: `${cls.stem}_E`,
        armatureName: () => `${cls.stem}_E`,
      });
      expect(pkg.export.ske.version).toBe('5.5');
      if (engineRuntimePath()) {
        const loaded = (await loadRuntime()).load(pkg.export.ske, pkg.export.tex);
        expect(loaded.armatures).toEqual([`${cls.stem}_E`]);
      }
    }
  });

  it('classes override only what the weapon changes: same locomotion, different strikes', () => {
    const kiem = buildRigTemplate(nominalManifest('kiem-tu')).rigs.E!;
    const the = buildRigTemplate(nominalManifest('the-tu')).rigs.E!;
    const reference = authorKiemTuSet(the, { secondary: false });
    const retargeted = authorClassSet('the-tu', the, { secondary: false });
    const byName = (cs: { name: string }[], n: string) => cs.find((c) => c.name === n)!;
    for (const same of ['run', 'walk', 'die', 'hit', 'dash'])
      expect(JSON.stringify(byName(retargeted, same))).toBe(JSON.stringify(byName(reference, same)));
    for (const changed of ['attack', 'attack_2', 'attack_3', 'cast', 'channel', 'idle']) {
      expect(JSON.stringify(byName(retargeted, changed))).not.toBe(JSON.stringify(byName(reference, changed)));
    }
    // a Kiếm tu keeps its own hand-authored clips
    expect(JSON.stringify(authorClassSet('kiem-tu', kiem, { secondary: false }))).toBe(
      JSON.stringify(authorKiemTuSet(kiem, { secondary: false })),
    );
    // weapon QA: a Thể tu rig must never show a weapon piece
    const bad = buildRigTemplate(nominalManifest('kiem-tu')).rigs.E!;
    expect(
      runQa(bad, authorKiemTuSet(bad, { only: ['idle'] })[0]!, { weapon: 'none' }).issues.some(
        (i) => i.check === 'weapon',
      ),
    ).toBe(true);
  });
});

describe('per-character data and viewer export', () => {
  it('loadCharacterData follows the registry paths; unknown data fails clearly', () => {
    expect(loadCharacterData(repoRoot, 'kiem-tu').id).toBe(loadKiemTuData(repoRoot).id);
    expect(() => loadCharacterData(repoRoot, 'the-tu')).toThrow(/no rig data for 'the-tu' yet/);
  });

  it('buildViewerPackage for Kiếm tu matches the committed viewer files (same convention for every class)', () => {
    const dir = join(repoRoot, characterPaths('kiem-tu').viewerDir.replace('/kiem-tu', '/kiem-tu'));
    for (const f of buildViewerPackage(repoRoot, 'kiem-tu')) {
      expect(f.name.startsWith(CLASSES['kiem-tu'].stem)).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, `${f.name}_ske.json`), 'utf-8'))).toEqual(f.package.export.ske);
    }
  });
});
