/**
 * Asset BUDGET GATE (P1-3) – deterministic, no AI, no external tools.
 *
 * Reads the packed atlas directory produced by `npm run pack` (tutien-atlas JSON + PNG pages, tileset.json/png)
 * and fails on:
 *   - atlas page not power of two, or larger than the platform cap (2048 Web/Mobile; 4096 only for PC *map* atlases),
 *   - missing padding (< ATLAS_PADDING_PX) or missing extrude (edge pixels not replicated into the padding ring),
 *   - icon atlases / frames that are not 48 / 64 / 128 square,
 *   - tile size that is not 64x32 (@1x) or 128x64 (@2x),
 *   - initial-package size estimate over the Web budget (25 MB).
 * Numbers come from @vgtd/shared where it defines them; the few it does not (icon sizes, extrude width, the
 * non-asset part of the initial package) are local constants below with the doc they come from.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BUDGETS, TILE_WIDTH, TILE_HEIGHT } from '@vgtd/shared';
import { checkChibi, renderChibiMarkdown, type ChibiReport } from './chibi.mjs';

const require = createRequire(import.meta.url);
const { decodePNG } = require('../lib/png.js') as { decodePNG: (buf: Buffer) => RGBAImage };

// ---- constants not (yet) in @vgtd/shared --------------------------------------------------------------------
/** Icon export sizes (docs/05-ui-ux-icon.md, docs/00 section 3: "Icon: ... xuất 48 / 64 / 128"). */
export const ICON_SIZES: readonly number[] = [48, 64, 128];
/** Minimum extrude (docs/02-asset-matrix-2d.md: "padding 2 px + extrude 1 px"; tile atlas uses 2, docs/04). */
export const EXTRUDE_MIN_PX = 1;
/** Non-asset part of the Web initial package (docs/02 table): engine+code 6 MB, audio 1 MB, spare 2 MB. */
export const INITIAL_PACKAGE_RESERVED_MB = 6 + 1 + 2;
/** PC map atlases (only these may reach ATLAS_MAX_PC) are named with this prefix. */
export const PC_MAP_ATLAS_PREFIX = 'atl_map';
const COMPRESSED_EXT = ['.ktx2', '.webp', '.astc'];
const MB = 1024 * 1024;

export type Platform = 'web' | 'mobile' | 'pc';

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export interface Frame {
  name: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Page {
  file: string;
  width: number;
  height: number;
}
export interface AtlasInfo {
  name: string;
  source: string;
  kind: 'atlas' | 'tileset';
  padding: number;
  pages: Page[];
  frames: Frame[];
}
export interface Finding {
  level: 'error' | 'warn';
  code: string;
  msg: string;
}
export interface AtlasRow {
  name: string;
  page: string;
  size: string;
  frames: number;
  bytes: number;
  cap: number;
}
export interface BudgetOptions {
  atlasDir: string;
  /** Compressed output (ktx2/webp/astc); used for the size estimate only when it actually contains such files. */
  distDir?: string;
  platform?: Platform;
  /** Defaults to BUDGETS.INITIAL_DOWNLOAD_MB_WEB. */
  limitMb?: number;
  reservedMb?: number;
  checkPixels?: boolean;
  /** Exported chibi armatures (apps/client-cocos/assets/resources/dragonbones); enables the chibi runtime gate (D71). */
  chibiDir?: string;
}
export interface BudgetReport {
  platform: Platform;
  findings: Finding[];
  rows: AtlasRow[];
  estimate: {
    assetBytes: number;
    reservedMb: number;
    totalMb: number;
    limitMb: number;
    basis: 'compressed' | 'png-upper-bound';
    enforced: boolean;
  };
  chibi?: ChibiReport;
  ok: boolean;
}

export const isPow2 = (n: number): boolean => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

/** Max page size for an atlas on a platform (docs/02: 4096 only for PC map atlases). */
export function atlasCap(name: string, platform: Platform): number {
  return platform === 'pc' && name.startsWith(PC_MAP_ATLAS_PREFIX) ? BUDGETS.ATLAS_MAX_PC : BUDGETS.ATLAS_MAX_WEB_MOBILE;
}

// ---- loading ----------------------------------------------------------------------------------------------
function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadAtlases(dir: string, findings: Finding[]): AtlasInfo[] {
  const out: AtlasInfo[] = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    let j: any;
    try {
      j = readJson(path.join(dir, f));
    } catch (e) {
      findings.push({ level: 'error', code: 'JSON_INVALID', msg: `${f}: ${(e as Error).message}` });
      continue;
    }
    if (j?.format === 'tutien-atlas') {
      out.push({
        name: String(j.name),
        source: f,
        kind: 'atlas',
        padding: Number(j.padding),
        pages: (j.pages ?? []).map((p: any) => ({ file: p.file, width: p.width, height: p.height })),
        frames: Object.entries<any>(j.frames ?? {}).map(([name, fr]) => ({ name, page: fr.page, x: fr.x, y: fr.y, w: fr.w, h: fr.h })),
      });
    } else if (j?.format === 'tutien-tileset') {
      out.push({
        name: 'tileset',
        source: f,
        kind: 'tileset',
        padding: Number(j.padding),
        pages: [{ file: j.image, width: j.imageWidth, height: j.imageHeight }],
        frames: (j.tiles ?? []).map((t: any) => ({ name: t.name, page: 0, x: t.x, y: t.y, w: t.w, h: t.h })),
      });
    }
  }
  return out;
}

// ---- individual checks ------------------------------------------------------------------------------------
function checkPages(a: AtlasInfo, platform: Platform, findings: Finding[]): void {
  const cap = atlasCap(a.name, platform);
  for (const p of a.pages) {
    if (!isPow2(p.width) || !isPow2(p.height)) {
      findings.push({ level: 'error', code: 'ATLAS_NOT_POT', msg: `${p.file}: ${p.width}x${p.height} không phải lũy thừa 2` });
    }
    if (p.width > cap || p.height > cap) {
      findings.push({ level: 'error', code: 'ATLAS_TOO_LARGE', msg: `${p.file}: ${p.width}x${p.height} vượt ${cap} (${platform}${cap === BUDGETS.ATLAS_MAX_PC ? ', atlas map PC' : ''})` });
    }
  }
}

function checkGeometry(a: AtlasInfo, findings: Finding[]): void {
  const pad = BUDGETS.ATLAS_PADDING_PX;
  if (!(a.padding >= pad)) {
    findings.push({ level: 'error', code: 'PADDING_MISSING', msg: `${a.source}: padding khai báo ${a.padding}, cần >= ${pad}` });
  }
  const eff = Math.max(pad, 0);
  for (const f of a.frames) {
    const page = a.pages[f.page];
    if (!page) {
      findings.push({ level: 'error', code: 'FRAME_BAD_PAGE', msg: `${a.source}: ${f.name} trỏ page ${f.page}` });
      continue;
    }
    if (f.x < eff || f.y < eff || f.x + f.w + eff > page.width || f.y + f.h + eff > page.height) {
      findings.push({ level: 'error', code: 'PADDING_MISSING', msg: `${a.source}: ${f.name} cách mép trang < ${eff}px` });
    }
  }
  // Frames inflated by the padding must not overlap: there is room for `pad` of extrude around each one.
  for (let i = 0; i < a.frames.length; i++) {
    for (let j = i + 1; j < a.frames.length; j++) {
      const p = a.frames[i]!;
      const q = a.frames[j]!;
      if (p.page !== q.page) continue;
      const ox = Math.min(p.x + p.w + eff, q.x + q.w + eff) - Math.max(p.x - eff, q.x - eff);
      const oy = Math.min(p.y + p.h + eff, q.y + q.h + eff) - Math.max(p.y - eff, q.y - eff);
      if (ox > 0 && oy > 0) {
        findings.push({ level: 'error', code: 'PADDING_MISSING', msg: `${a.source}: ${p.name} và ${q.name} gần nhau hơn ${2 * eff}px (không đủ chỗ padding/extrude)` });
      }
    }
  }
}

const px = (img: RGBAImage, x: number, y: number): [number, number, number, number] => {
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
};

/** Verify that the `ring` pixels around a frame replicate the nearest edge pixel (same rule as pack_atlas blitExtrude). */
export function extrudeMismatches(img: RGBAImage, f: Frame, ring: number): number {
  let bad = 0;
  for (let y = f.y - ring; y < f.y + f.h + ring; y++) {
    for (let x = f.x - ring; x < f.x + f.w + ring; x++) {
      if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) continue;
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const sx = Math.min(f.x + f.w - 1, Math.max(f.x, x));
      const sy = Math.min(f.y + f.h - 1, Math.max(f.y, y));
      const s = px(img, sx, sy);
      const d = px(img, x, y);
      const same = s[3] === 0 ? d[3] === 0 : s[0] === d[0] && s[1] === d[1] && s[2] === d[2] && s[3] === d[3];
      if (!same) bad++;
    }
  }
  return bad;
}

function checkExtrude(a: AtlasInfo, dir: string, findings: Finding[]): void {
  const imgs = new Map<number, RGBAImage>();
  for (const f of a.frames) {
    const page = a.pages[f.page];
    if (!page) continue;
    let img = imgs.get(f.page);
    if (!img) {
      const file = path.join(dir, page.file);
      if (!fs.existsSync(file)) {
        findings.push({ level: 'error', code: 'PAGE_MISSING', msg: `${page.file} không tồn tại` });
        return;
      }
      img = decodePNG(fs.readFileSync(file));
      imgs.set(f.page, img);
    }
    const bad = extrudeMismatches(img, f, EXTRUDE_MIN_PX);
    if (bad > 0) {
      findings.push({ level: 'error', code: 'EXTRUDE_MISSING', msg: `${page.file}: ${f.name} thiếu extrude ${EXTRUDE_MIN_PX}px (${bad} pixel viền không khớp mép ảnh)` });
    }
  }
}

function checkIcons(a: AtlasInfo, findings: Finding[]): void {
  const m = /^atl_icon_(\d+)$/.exec(a.name);
  if (!m) return;
  const n = Number(m[1]);
  if (!ICON_SIZES.includes(n)) {
    findings.push({ level: 'error', code: 'ICON_SIZE', msg: `${a.name}: kích thước icon ${n} không thuộc ${ICON_SIZES.join('/')}` });
  }
  for (const f of a.frames) {
    if (f.w !== n || f.h !== n) {
      findings.push({ level: 'error', code: 'ICON_SIZE', msg: `${a.name}: ${f.name} là ${f.w}x${f.h}, cần ${n}x${n}` });
    }
  }
}

function checkTiles(a: AtlasInfo, dir: string, findings: Finding[]): void {
  if (a.kind !== 'tileset') return;
  const ts = readJson(path.join(dir, a.source)) as { tileWidth: number; tileHeight: number };
  const ok =
    (ts.tileWidth === TILE_WIDTH && ts.tileHeight === TILE_HEIGHT) ||
    (ts.tileWidth === 2 * TILE_WIDTH && ts.tileHeight === 2 * TILE_HEIGHT);
  if (!ok) {
    findings.push({ level: 'error', code: 'TILE_SIZE', msg: `tile ${ts.tileWidth}x${ts.tileHeight}, cần ${TILE_WIDTH}x${TILE_HEIGHT} @1x hoặc ${2 * TILE_WIDTH}x${2 * TILE_HEIGHT} @2x` });
  }
}

// ---- package size estimate ----------------------------------------------------------------------------------
function dirBytes(dir: string, accept: (name: string) => boolean): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(accept).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
}

// ---- entry point --------------------------------------------------------------------------------------------
export function runBudget(opts: BudgetOptions): BudgetReport {
  const platform = opts.platform ?? 'web';
  const findings: Finding[] = [];
  const rows: AtlasRow[] = [];
  if (!fs.existsSync(opts.atlasDir)) {
    findings.push({ level: 'error', code: 'NO_ATLAS', msg: `Không có thư mục atlas ${opts.atlasDir}` });
  }
  const atlases = fs.existsSync(opts.atlasDir) ? loadAtlases(opts.atlasDir, findings) : [];
  if (fs.existsSync(opts.atlasDir) && atlases.length === 0) {
    findings.push({ level: 'error', code: 'NO_ATLAS', msg: `Không tìm thấy atlas (tutien-atlas / tutien-tileset JSON) trong ${opts.atlasDir}` });
  }
  for (const a of atlases) {
    checkPages(a, platform, findings);
    checkGeometry(a, findings);
    checkIcons(a, findings);
    checkTiles(a, opts.atlasDir, findings);
    if (opts.checkPixels !== false) checkExtrude(a, opts.atlasDir, findings);
    for (const p of a.pages) {
      const file = path.join(opts.atlasDir, p.file);
      rows.push({
        name: a.name,
        page: p.file,
        size: `${p.width}x${p.height}`,
        frames: a.frames.filter((f) => a.pages[f.page] === p).length,
        bytes: fs.existsSync(file) ? fs.statSync(file).size : 0,
        cap: atlasCap(a.name, platform),
      });
    }
  }

  const compressedBytes = opts.distDir ? dirBytes(opts.distDir, (n) => COMPRESSED_EXT.some((e) => n.endsWith(e))) : 0;
  const useCompressed = compressedBytes > 0;
  const assetBytes = useCompressed
    ? compressedBytes + dirBytes(opts.distDir!, (n) => n.endsWith('.json') && n !== 'compress_manifest.json')
    : dirBytes(opts.atlasDir, (n) => n.endsWith('.png') || n.endsWith('.json'));
  const reservedMb = opts.reservedMb ?? INITIAL_PACKAGE_RESERVED_MB;
  const limitMb = opts.limitMb ?? BUDGETS.INITIAL_DOWNLOAD_MB_WEB;
  // D71: the player's own class (worst class), one direction, loco group only, at the `full` tier (desktop worst case).
  const chibi = opts.chibiDir ? checkChibi(opts.chibiDir) : undefined;
  if (chibi) findings.push(...chibi.findings);
  const playerMb = chibi ? chibi.initialPlayerMB.full : 0;
  const totalMb = assetBytes / MB + reservedMb + playerMb;
  const enforced = platform === 'web';
  if (enforced && totalMb > limitMb) {
    findings.push({
      level: 'error',
      code: 'INITIAL_PACKAGE_OVER',
      msg: `Gói tải đầu ước tính ${totalMb.toFixed(2)} MB (asset ${(assetBytes / MB).toFixed(2)} + dự phòng ${reservedMb}) vượt ${limitMb} MB`,
    });
  }
  if (!useCompressed) {
    findings.push({ level: 'warn', code: 'NOT_COMPRESSED', msg: 'Chưa có KTX2/WebP/ASTC (thiếu basisu/astcenc/cwebp): ước tính dùng PNG nên là cận trên' });
  }
  return {
    platform,
    findings,
    rows,
    chibi,
    estimate: { assetBytes, reservedMb, totalMb, limitMb, basis: useCompressed ? 'compressed' : 'png-upper-bound', enforced },
    ok: !findings.some((f) => f.level === 'error'),
  };
}

// ---- reporting ----------------------------------------------------------------------------------------------
export function renderMarkdown(r: BudgetReport): string {
  const kb = (n: number): string => (n / 1024).toFixed(1);
  const lines: string[] = [];
  lines.push(`## Asset budget gate – ${r.ok ? 'PASS' : 'FAIL'} (${r.platform})`, '');
  lines.push('| Atlas | Trang | Kích thước | Frame | KB | Trần |', '| --- | --- | --- | ---: | ---: | ---: |');
  for (const x of r.rows) lines.push(`| ${x.name} | ${x.page} | ${x.size} | ${x.frames} | ${kb(x.bytes)} | ${x.cap} |`);
  const e = r.estimate;
  lines.push('', '| Gói tải đầu (Web) | Giá trị |', '| --- | ---: |');
  lines.push(`| Asset procgen (${e.basis}) | ${(e.assetBytes / MB).toFixed(2)} MB |`);
  lines.push(`| Engine + audio + dự phòng (docs/02) | ${e.reservedMb} MB |`);
  if (r.chibi) lines.push(`| Người chơi: nhóm loco 1 hướng, tier full, ASTC (D71) | ${r.chibi.initialPlayerMB.full.toFixed(2)} MB |`);
  lines.push(`| **Ước tính** | **${e.totalMb.toFixed(2)} MB** |`);
  lines.push(`| Ngân sách | ${e.limitMb} MB${e.enforced ? '' : ' (không áp dụng cho nền tảng này)'} |`);
  if (r.chibi) lines.push('', renderChibiMarkdown(r.chibi));
  const errs = r.findings.filter((f) => f.level === 'error');
  const warns = r.findings.filter((f) => f.level === 'warn');
  lines.push('', `**${errs.length} lỗi, ${warns.length} cảnh báo**`);
  for (const f of errs) lines.push(`- ❌ \`${f.code}\` ${f.msg}`);
  for (const f of warns) lines.push(`- ⚠️ \`${f.code}\` ${f.msg}`);
  return lines.join('\n') + '\n';
}
