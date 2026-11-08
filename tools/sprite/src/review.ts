import type { RegistrationEvidence } from './inherited-registration.js';
import type { OriginMeasurement } from './authored-origin.js';
import type { SimilarityCropMeasurement } from './similarity-crops.js';
/**
 * Batch report + owner review page. A batch report describes one character: every direction, every clip, the QA verdicts
 * and (when captured) the 2x GIF of the clip as rendered by the real Cocos runtime. `reviewHtml` turns one or more reports
 * into a single self-contained page (paths relative to the page).
 */
import type { ManualArtFinding } from './backlog.js';
import {
  headEvidenceKind,
  headLandmarkStart,
  headLandmarkEnd,
  type HeadMeasurement,
  type HeadLandmarks,
  type HeadEvidence,
} from './head-evidence.js';

export const BATCH_FORMAT = 'vgtd-sprite-batch' as const;

export type ClipStatus = 'ok' | 'warn' | 'fail';

export interface ClipReport {
  readonly inheritedRegistration?: readonly { readonly cell: number; readonly evidence: RegistrationEvidence }[];
  readonly similarityCrops?: readonly { readonly cell: number; readonly measurement: SimilarityCropMeasurement }[];
  readonly originEvidence?: readonly { readonly cell: number; readonly measurement: OriginMeasurement }[];
  readonly name: string;
  readonly frames: number;
  readonly durationSec: number;
  readonly kind: 'upright' | 'free';
  readonly status: ClipStatus;
  /** Verdict counts of this clip: hard failures, unlisted soft, regressions, accepted (backlog), info. */
  readonly counts: {
    readonly hard: number;
    readonly soft: number;
    readonly regression: number;
    readonly accepted: number;
    readonly info: number;
  };
  /** Relative path (to the report folder) of the 2x GIF, when captured. */
  readonly gif?: string;
  readonly unmeasuredFootSlide?: boolean;
  readonly headEvidence?: readonly { readonly cell: number; readonly measurement: HeadMeasurement }[];
}

export interface DirReport {
  readonly dir: string;
  readonly stem: string;
  readonly ok: boolean;
  readonly atlas: { readonly pages: number; readonly width: number; readonly height: number; readonly regions: number };
  readonly backlogEntries: number;
  readonly resolvedEntries: number;
  readonly manual?: readonly ManualArtFinding[];
  /** Folder of this direction's outputs, relative to the report. */
  readonly folder: string;
  readonly clips: readonly ClipReport[];
}

export interface BatchReport {
  readonly format: typeof BATCH_FORMAT;
  readonly version: 1;
  readonly character: string;
  readonly ok: boolean;
  readonly dirs: readonly DirReport[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function headLandmarkHtml(head: HeadLandmarks | HeadEvidence): string {
  if (head.kind === 'rear-breadth-only')
    return esc(
      `crown (${head.crown.x}, ${head.crown.y}); breadth left (${head.breadth.left.x}, ${head.breadth.left.y}), right (${head.breadth.right.x}, ${head.breadth.right.y}); shoulder occluder ${head.occluder}; no vertical span`,
    );
  const start = headLandmarkStart(head);
  const end = headLandmarkEnd(head);
  const label =
    head.kind === 'rear-skull-base' || head.kind === 'rear-base-ornament' || head.kind === 'rear-span-only'
      ? 'skull base'
      : head.kind === 'rear-crown-shoulder'
        ? 'shoulder midpoint'
        : head.kind === 'rear-crown-shoulder-single'
          ? 'visible shoulder (vertical distance)'
          : 'chin';
  const anchor =
    head.kind === 'rear-base-ornament'
      ? `; anchor definition: ${head.anchorDefinition}`
      : head.kind === 'rear-span-only'
        ? `; occludedSide ${head.occludedSide}; breadth occluder ${head.occluder}; no breadth measurement`
        : '';
  const shoulders =
    head.kind === 'rear-crown-shoulder'
      ? `; shoulderTop left (${head.shoulderTop.left.x}, ${head.shoulderTop.left.y}), right (${head.shoulderTop.right.x}, ${head.shoulderTop.right.y})`
      : head.kind === 'rear-crown-shoulder-single'
        ? `; visible ${head.occludedSide === 'left' ? 'right' : 'left'} shoulderTop (${head.shoulderTop.x}, ${head.shoulderTop.y}); occludedSide ${head.occludedSide}; occluder ${head.occluder}`
        : '';
  const breadth = head.breadth
    ? `; breadth left (${head.breadth.left.x}, ${head.breadth.left.y}), right (${head.breadth.right.x}, ${head.breadth.right.y})`
    : '';
  return esc(
    `${head.kind === 'rear-base-ornament' ? 'ornament anchor' : 'crown'} (${start.x}, ${start.y}), ${label} (${end.x}, ${end.y})${anchor}${shoulders}${breadth}`,
  );
}

const CSS = `
body{font:14px/1.4 system-ui,sans-serif;margin:0;background:#14171c;color:#e6e8eb}
header{padding:16px 24px;background:#1d2229;border-bottom:1px solid #2c333d;position:sticky;top:0;z-index:2}
h1{font-size:18px;margin:0 0 4px}h2{font-size:16px;margin:28px 24px 8px}h3{font-size:14px;margin:18px 24px 6px;color:#9fb0c3}
.sum{color:#9fb0c3}.grid{display:flex;flex-wrap:wrap;gap:12px;padding:0 24px}
.card{background:#1d2229;border:1px solid #2c333d;border-radius:8px;padding:8px;width:340px}
.card img{width:100%;image-rendering:auto;background:#0d0f12;border-radius:4px;display:block}
.card .nogif{height:120px;display:flex;align-items:center;justify-content:center;color:#6b7a8c;background:#0d0f12;border-radius:4px}
.name{font-weight:600}.meta{color:#9fb0c3;font-size:12px}
.chip{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;margin-left:6px}
.ok{background:#1f5f3b}.warn{background:#7a5a12}.fail{background:#7a1f1f}
a{color:#7db4ff}nav{padding:8px 24px}nav a{margin-right:14px}
`;

function chip(status: ClipStatus): string {
  return `<span class="chip ${status}">${status}</span>`;
}

/** One self-contained review page for the given characters. */
export function reviewHtml(reports: readonly BatchReport[], title = 'Sprite review'): string {
  const total = reports.flatMap((r) => r.dirs.flatMap((d) => d.clips));
  const bad = total.filter((c) => c.status === 'fail').length;
  const warn = total.filter((c) => c.status === 'warn' && c.counts.accepted > 0).length;
  const manualCount = reports.reduce((n, r) => n + r.dirs.reduce((m, d) => m + (d.manual?.length ?? 0), 0), 0);
  const nav = reports.map((r) => `<a href="#c-${esc(r.character)}">${esc(r.character)}</a>`).join('');
  const body = reports
    .map((r) => {
      const dirs = r.dirs
        .map((d) => {
          const manual = d.manual ?? [];
          const observations = manual.length
            ? `<div class="grid"><section class="card"><details><summary class="name">Manual art findings (${manual.length}) · ${manual.filter((e) => e.status === 'resolved').length} art-worker resolved</summary>${manual
                .map(
                  (e) =>
                    `<p><strong>${esc(e.clip)} / ${esc(e.dir)}: ${esc(e.kind)}</strong><br>cells ${e.cells.length ? e.cells.join(', ') : 'all'} · ${esc(e.severity)} · ${esc(e.reviewer)} · art status ${esc(e.status ?? 'open')}<br>${esc(e.note)}</p>`,
                )
                .join('')}</details></section></div>`
            : '';
          const cards = d.clips
            .map((c) => {
              const media = c.gif
                ? `<img src="${esc(c.gif)}" alt="${esc(`${r.character} ${d.dir} ${c.name}`)}" loading="lazy">`
                : '<div class="nogif">no capture</div>';
              const k = c.counts;
              const unmeasuredNote = c.unmeasuredFootSlide
                ? '<div class="meta">Foot slide UNMEASURED (migration pending)</div>'
                : '';
              const crops = c.similarityCrops?.length
                ? `<details><summary>Similarity crop windows (${c.similarityCrops.length})</summary>${c.similarityCrops.map(({ cell, measurement: e }) => `<p>cell ${cell}; ${esc(e.method)}; ${esc(e.frame.headKind)}; ${esc(e.reason ?? e.frame.widthSource ?? '')}<br>master ${esc(JSON.stringify(e.master))}<br>frame ${esc(JSON.stringify(e.frame))}</p>`).join('')}</details>`
                : '';
              const evidence =
                crops +
                (c.headEvidence?.length
                  ? `<details><summary>Head-size INFO evidence (${c.headEvidence.length})</summary>${c.headEvidence.map(({ cell, measurement: e }) => `<p>cell ${cell} · ${esc(e.kind ?? headEvidenceKind(e.frame))} | ${esc(e.reason)} · ${e.kind === 'rear-breadth-only' ? 'breadth-only (no vertical span)' : `head ${e.sizePx!.toFixed(2)} / master ${e.masterSizePx!.toFixed(2)} px`} · bbox ${e.bboxHeightPx} / ${e.masterBboxHeightPx} px<br>${headLandmarkHtml(e.frame)}<br>master ${headLandmarkHtml(e.master)}${e.breadthPx !== undefined ? `<br>skull breadth ${e.breadthPx.toFixed(2)} / master ${e.masterBreadthPx === undefined ? 'occluded (no ratio)' : e.masterBreadthPx.toFixed(2) + ' px'}` : ''}<br>${esc(e.frame.note)}</p>`).join('')}</details>`
                  : '');
              const inherited = c.inheritedRegistration?.length
                ? '<details><summary>Verified inherited-registration (' +
                  c.inheritedRegistration.length +
                  ')</summary>' +
                  c.inheritedRegistration
                    .map(({ cell, evidence: e }) => '<p>' + esc(JSON.stringify({ cell, ...e })) + '</p>')
                    .join('') +
                  '</details>'
                : '';
              const origins = c.originEvidence?.length
                ? `<details><summary>Authored-origin INFO evidence (${c.originEvidence.length})</summary>${c.originEvidence.map(({ cell, measurement: e }) => `<p>cell ${cell} ; ${esc(e.kind ?? 'anatomical-pelvis')} ; pelvisX ${e.pelvisX} ; groundY ${e.groundY ?? 'default'} ; source (${e.source.x}, ${e.source.y}) ; scale ${e.scale} ; dx ${e.dx}, dy ${e.dy}<br>${esc(e.reason)}<br>${esc(e.evidence)}</p>`).join('')}</details>`
                : '';
              return `<div class="card">${media}<div><span class="name">${esc(c.name)}</span>${chip(c.status)}</div>${unmeasuredNote}<div class="meta">${c.frames} frames, ${c.durationSec.toFixed(2)} s, ${esc(c.kind)}<br>hard ${k.hard} · soft ${k.soft} · regress ${k.regression} · accepted ${k.accepted} · info ${k.info}</div>${evidence}${origins}${inherited}</div>`;
            })
            .join('');
          return `<h3>${esc(r.character)} / ${esc(d.dir)} ${chip(d.ok ? 'ok' : 'fail')} <span class="sum">atlas ${d.atlas.pages}p ${d.atlas.width}x${d.atlas.height}, ${d.atlas.regions} regions · backlog ${d.backlogEntries} (${d.resolvedEntries} metric entries resolved) · manual ${manual.length} · <a href="${esc(d.folder)}/${esc(d.stem)}_${esc(d.dir)}.sprite.json">contract</a></span></h3>${observations}<div class="grid">${cards}</div>`;
        })
        .join('');
      return `<h2 id="c-${esc(r.character)}">${esc(r.character)} ${chip(r.ok ? 'ok' : 'fail')}</h2>${dirs}`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><header><h1>${esc(title)}</h1><div class="sum">${reports.length} characters · ${total.length} clips · ${bad} failing · ${warn} with accepted warnings · ${manualCount} manual art findings (GIFs are Cocos captures at 2x)</div></header><nav>${nav}</nav>${body}</body></html>\n`;
}
