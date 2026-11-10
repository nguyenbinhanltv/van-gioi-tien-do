/**
 * Chibi runtime budget gate (D71). Pure geometry: plans the per-direction bundles from the exported atlases
 * (no pixel work, no external encoder) and checks, per tier, with the fixed-rate ASTC sizes the Cocos build
 * produces for mobile (ASTC 4x4 for `1x`, 6x6 for `full`):
 *   - loco group download per direction,
 *   - whole direction bundle download,
 *   - GPU bytes of all authored directions of one class,
 *   - atlas pages are power of two and within the Web/Mobile cap,
 *   - initial package: reserved + map + the player's class (worst class) in one direction, loco group only.
 * The desktop WebP path is not estimated here (needs cwebp); `perf:p1` measures the real build.
 */
import { BUDGETS, CHIBI_RUNTIME } from '@vgtd/shared';
import { discoverSources, planBundle, TIERS, type PlannedBundle, type Tier } from '../runtime/chibi.mjs';
import { isPow2, type Finding } from './check.mjs';

const KB = 1024;
const MB = KB * KB;
export const astcBytes = (w: number, h: number, block: number): number =>
  Math.ceil(w / block) * Math.ceil(h / block) * 16;
const rgba8Bytes = (w: number, h: number): number => w * h * 4;

export interface ChibiRow {
  bundle: string;
  tier: Tier;
  locoKB: number;
  bundleKB: number;
  gpuKB: number;
  rgba8KB: number;
}
export interface ChibiReport {
  rows: ChibiRow[];
  /** Per class and tier: GPU MB for all directions present. */
  classGpuMB: Record<string, Record<Tier, number>>;
  /** Worst-case loco download (MB) of one player direction, per tier. */
  initialPlayerMB: Record<Tier, number>;
  findings: Finding[];
}

export function checkChibi(dragonbonesRoot: string): ChibiReport {
  const findings: Finding[] = [];
  const plans: PlannedBundle[] = discoverSources(dragonbonesRoot).map(planBundle);
  const rows: ChibiRow[] = [];
  const classGpuMB: Record<string, Record<Tier, number>> = {};
  const initialPlayerMB: Record<Tier, number> = { full: 0, '1x': 0 };
  if (plans.length === 0)
    findings.push({ level: 'error', code: 'NO_CHIBI', msg: `Không có armature chibi trong ${dragonbonesRoot}` });
  for (const p of plans) {
    for (const t of p.tiers) {
      const block = CHIBI_RUNTIME.ASTC_BLOCK[t.tier];
      let loco = 0;
      let all = 0;
      let rgba = 0;
      for (const pg of t.pages) {
        if (
          !isPow2(pg.width) ||
          !isPow2(pg.height) ||
          pg.width > BUDGETS.ATLAS_MAX_WEB_MOBILE ||
          pg.height > BUDGETS.ATLAS_MAX_WEB_MOBILE
        ) {
          findings.push({
            level: 'error',
            code: 'CHIBI_PAGE',
            msg: `${p.bundle}/${t.tier}/${pg.name}: ${pg.width}x${pg.height} không hợp lệ (POT, <= ${BUDGETS.ATLAS_MAX_WEB_MOBILE})`,
          });
        }
        const b = astcBytes(pg.width, pg.height, block);
        all += b;
        rgba += rgba8Bytes(pg.width, pg.height);
        if (pg.group === 'loco') loco += b;
      }
      const row: ChibiRow = {
        bundle: p.bundle,
        tier: t.tier,
        locoKB: loco / KB,
        bundleKB: all / KB,
        gpuKB: all / KB,
        rgba8KB: rgba / KB,
      };
      rows.push(row);
      if (row.locoKB > CHIBI_RUNTIME.LOCO_GROUP_KB_MAX[t.tier]) {
        findings.push({
          level: 'error',
          code: 'CHIBI_LOCO_OVER',
          msg: `${p.bundle} ${t.tier}: nhóm loco ${row.locoKB.toFixed(0)} KB > ${CHIBI_RUNTIME.LOCO_GROUP_KB_MAX[t.tier]} KB`,
        });
      }
      if (row.bundleKB > CHIBI_RUNTIME.BUNDLE_KB_MAX[t.tier]) {
        findings.push({
          level: 'error',
          code: 'CHIBI_BUNDLE_OVER',
          msg: `${p.bundle} ${t.tier}: bundle ${row.bundleKB.toFixed(0)} KB > ${CHIBI_RUNTIME.BUNDLE_KB_MAX[t.tier]} KB`,
        });
      }
      (classGpuMB[p.classId] ??= { full: 0, '1x': 0 })[t.tier] += all / MB;
      initialPlayerMB[t.tier] = Math.max(initialPlayerMB[t.tier], loco / MB);
    }
  }
  for (const [cls, v] of Object.entries(classGpuMB)) {
    for (const tier of TIERS) {
      if (v[tier] > CHIBI_RUNTIME.CLASS_GPU_MB_MAX[tier]) {
        findings.push({
          level: 'error',
          code: 'CHIBI_CLASS_GPU_OVER',
          msg: `${cls} ${tier}: GPU ${v[tier].toFixed(1)} MB > ${CHIBI_RUNTIME.CLASS_GPU_MB_MAX[tier]} MB`,
        });
      }
    }
  }
  return { rows, classGpuMB, initialPlayerMB, findings };
}

export function renderChibiMarkdown(r: ChibiReport): string {
  const L: string[] = [
    '### Chibi runtime bundles (ASTC, D71)',
    '',
    '| Bundle | Tier | loco KB | bundle KB | RGBA8 KB (fallback GPU) |',
    '| --- | --- | ---: | ---: | ---: |',
  ];
  for (const x of r.rows)
    L.push(`| ${x.bundle} | ${x.tier} | ${x.locoKB.toFixed(0)} | ${x.bundleKB.toFixed(0)} | ${x.rgba8KB.toFixed(0)} |`);
  L.push('', '| Lớp | GPU 1x MB | GPU full MB |', '| --- | ---: | ---: |');
  for (const [c, v] of Object.entries(r.classGpuMB)) L.push(`| ${c} | ${v['1x'].toFixed(1)} | ${v.full.toFixed(1)} |`);
  L.push('');
  return L.join('\n');
}
