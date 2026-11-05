/**
 * Chunk streaming (docs/06-toi-uu-render.md §5, docs/02 "Streaming map"):
 *  - P0 visible chunks (camera diamond ∩ rect), P1 ring (visible ±1 ∪ load window), P2 chunks the camera reaches
 *    in 2 s (3 s flying), P3 prefetch window.
 *  - queue ordered by priority then distance to camera; ≤ 4 parallel (2 in combat).
 *  - chunks outside the keep window (7×7) and unused for 30 s are unloaded; the window centre has hysteresis so
 *    walking along a chunk border does not flip the set.
 */
import {
  CHUNK_SIZE,
  STREAM_KEEP_RADIUS,
  STREAM_LOAD_RADIUS,
  STREAM_PREFETCH_RADIUS,
  chunkKey,
  chunkOf,
  screenToTile,
  tileToScreen,
} from '@vgtd/shared';
import type { ChunkCoord, Rect, Vec2 } from '@vgtd/shared';
import type { ChunkData, ChunkLoader } from './types.js';

export type StreamTier = 'low' | 'medium' | 'high';

export interface StreamWindows {
  /** Radius of the must-load window around the camera chunk (1 → 3×3, 2 → 5×5). */
  loadRadius: number;
  /** Radius of the prefetch window (2 → 5×5). */
  prefetchRadius: number;
  /** Chunks outside this radius (3 → 7×7) become evictable. */
  keepRadius: number;
  maxParallel: number;
  maxParallelCombat: number;
}

/**
 * `medium` is the documented default (3×3 load / 5×5 prefetch / 7×7 keep from @vgtd/shared).
 * `low` (Web / weak mobile) skips ring prefetch and keeps 5×5; `high` loads 5×5 up front.
 * The low/high variants are an interpretation of the "quality tier" requirement, not spec numbers.
 */
export const STREAM_TIERS: Readonly<Record<StreamTier, StreamWindows>> = {
  low: {
    loadRadius: STREAM_LOAD_RADIUS,
    prefetchRadius: STREAM_LOAD_RADIUS,
    keepRadius: STREAM_PREFETCH_RADIUS,
    maxParallel: 2,
    maxParallelCombat: 1,
  },
  medium: {
    loadRadius: STREAM_LOAD_RADIUS,
    prefetchRadius: STREAM_PREFETCH_RADIUS,
    keepRadius: STREAM_KEEP_RADIUS,
    maxParallel: 4,
    maxParallelCombat: 2,
  },
  high: {
    loadRadius: STREAM_PREFETCH_RADIUS,
    prefetchRadius: STREAM_PREFETCH_RADIUS,
    keepRadius: STREAM_KEEP_RADIUS,
    maxParallel: 4,
    maxParallelCombat: 2,
  },
};

export enum ChunkPriority {
  Visible = 0,
  Ring = 1,
  Ahead = 2,
  Prefetch = 3,
}

// ------------------------------------------------------------------ geometry
/** Screen-space diamond of a chunk (N, E, S, W vertices). */
function chunkDiamond(c: ChunkCoord): Vec2[] {
  const i0 = c.ci * CHUNK_SIZE;
  const j0 = c.cj * CHUNK_SIZE;
  return [
    tileToScreen(i0, j0),
    tileToScreen(i0 + CHUNK_SIZE, j0),
    tileToScreen(i0 + CHUNK_SIZE, j0 + CHUNK_SIZE),
    tileToScreen(i0, j0 + CHUNK_SIZE),
  ];
}

/** Exact diamond ∩ axis-aligned rect test (separating axis theorem; touching counts as no overlap). */
export function diamondIntersectsRect(d: Vec2[], r: Rect): boolean {
  const xs = d.map((p) => p.x);
  const ys = d.map((p) => p.y);
  if (Math.max(...xs) <= r.x || Math.min(...xs) >= r.x + r.width) return false;
  if (Math.max(...ys) <= r.y || Math.min(...ys) >= r.y + r.height) return false;
  // Diamond edge normals; the rect corners are projected onto each.
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
  for (let k = 0; k < 4; k++) {
    const a = d[k]!;
    const b = d[(k + 1) % 4]!;
    const nx = b.y - a.y;
    const ny = a.x - b.x;
    const dd = d.map((p) => p.x * nx + p.y * ny);
    const cc = corners.map((p) => p.x * nx + p.y * ny);
    if (Math.max(...dd) <= Math.min(...cc) || Math.min(...dd) >= Math.max(...cc)) return false;
  }
  return true;
}

/** Chunks whose diamond intersects the camera rect (screen px @1x). */
export function chunksInRect(r: Rect): ChunkCoord[] {
  const t = [
    screenToTile(r.x, r.y),
    screenToTile(r.x + r.width, r.y),
    screenToTile(r.x, r.y + r.height),
    screenToTile(r.x + r.width, r.y + r.height),
  ];
  const ci0 = Math.floor(Math.min(...t.map((p) => p.i)) / CHUNK_SIZE);
  const ci1 = Math.floor(Math.max(...t.map((p) => p.i)) / CHUNK_SIZE);
  const cj0 = Math.floor(Math.min(...t.map((p) => p.j)) / CHUNK_SIZE);
  const cj1 = Math.floor(Math.max(...t.map((p) => p.j)) / CHUNK_SIZE);
  const out: ChunkCoord[] = [];
  for (let cj = cj0; cj <= cj1; cj++) {
    for (let ci = ci0; ci <= ci1; ci++) {
      if (diamondIntersectsRect(chunkDiamond({ ci, cj }), r)) out.push({ ci, cj });
    }
  }
  return out;
}

function offsetRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height };
}

function chebyshev(a: ChunkCoord, b: ChunkCoord): number {
  return Math.max(Math.abs(a.ci - b.ci), Math.abs(a.cj - b.cj));
}

// ------------------------------------------------------------------ planning
export interface StreamInput {
  /** Camera rect in screen px @1x (y down). */
  camera: Rect;
  /** Camera velocity in screen px / s (for the look-ahead set). */
  velocity?: Vec2;
  flying?: boolean;
  inCombat?: boolean;
}

export interface WantedChunk extends ChunkCoord {
  priority: ChunkPriority;
}

export interface WantedSet {
  centre: ChunkCoord;
  wanted: Map<string, WantedChunk>;
  visible: ChunkCoord[];
}

/** Pure: which chunks are wanted, and at which priority, for a given (hysteresis-stabilised) centre chunk. */
export function computeWantedChunks(input: StreamInput, centre: ChunkCoord, windows: StreamWindows): WantedSet {
  const wanted = new Map<string, WantedChunk>();
  const want = (c: ChunkCoord, priority: ChunkPriority): void => {
    const k = chunkKey(c.ci, c.cj);
    const cur = wanted.get(k);
    if (!cur || priority < cur.priority) wanted.set(k, { ci: c.ci, cj: c.cj, priority });
  };
  const visible = chunksInRect(input.camera);
  for (const c of visible) want(c, ChunkPriority.Visible);
  for (const c of visible) {
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) want({ ci: c.ci + di, cj: c.cj + dj }, ChunkPriority.Ring);
  }
  const win = (radius: number, p: ChunkPriority): void => {
    for (let dj = -radius; dj <= radius; dj++) {
      for (let di = -radius; di <= radius; di++) want({ ci: centre.ci + di, cj: centre.cj + dj }, p);
    }
  };
  win(windows.loadRadius, ChunkPriority.Ring);
  const v = input.velocity;
  if (v && (v.x !== 0 || v.y !== 0)) {
    const s = input.flying ? 3 : 2;
    // Spec: camera rect after 2 s (3 s flying). We also sample the half-way rect so fast camera moves
    // (flying) cannot skip chunks swept in between.
    for (const f of [0.5, 1]) {
      for (const c of chunksInRect(offsetRect(input.camera, v.x * s * f, v.y * s * f))) want(c, ChunkPriority.Ahead);
    }
  }
  win(windows.prefetchRadius, ChunkPriority.Prefetch);
  return { centre, wanted, visible };
}

/** Pure: loaded chunks that may be unloaded (outside the keep window and unused for ≥ holdMs). */
export function chunksToEvict(
  loaded: Iterable<{ ci: number; cj: number; lastWanted: number }>,
  centre: ChunkCoord,
  keepRadius: number,
  now: number,
  holdMs: number,
): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  for (const c of loaded) {
    if (chebyshev(c, centre) > keepRadius && now - c.lastWanted >= holdMs) out.push({ ci: c.ci, cj: c.cj });
  }
  return out;
}

// ------------------------------------------------------------------ manager
export type ChunkStatus = 'queued' | 'loading' | 'loaded' | 'missing' | 'failed';

interface Entry {
  coord: ChunkCoord;
  status: ChunkStatus;
  priority: ChunkPriority;
  lastWanted: number;
  data: ChunkData | null;
  abort?: AbortController;
  failedAt?: number;
}

export interface ChunkStreamerOptions {
  tier?: StreamTier;
  /** Unload delay once outside the keep window (spec: 30 s). */
  evictHoldMs?: number;
  /** Camera-centre chunk only changes after the camera centre is this many tiles past the border (default 4). */
  hysteresisTiles?: number;
  /** Retry a failed load after this delay. */
  retryMs?: number;
  onLoaded?: (coord: ChunkCoord, data: ChunkData) => void;
  onUnloaded?: (coord: ChunkCoord) => void;
  onError?: (coord: ChunkCoord, err: unknown) => void;
}

export class ChunkStreamer {
  private readonly entries = new Map<string, Entry>();
  private centre: ChunkCoord | null = null;
  private windows: StreamWindows;
  private lastInput: StreamInput | null = null;
  private lastWanted: WantedSet | null = null;
  private lastNow = 0;
  private readonly evictHoldMs: number;
  private readonly hysteresisTiles: number;
  private readonly retryMs: number;

  constructor(
    private readonly loader: ChunkLoader,
    private readonly opts: ChunkStreamerOptions = {},
  ) {
    this.windows = STREAM_TIERS[opts.tier ?? 'medium'];
    this.evictHoldMs = opts.evictHoldMs ?? 30_000;
    this.hysteresisTiles = opts.hysteresisTiles ?? 4;
    this.retryMs = opts.retryMs ?? 5_000;
  }

  setTier(tier: StreamTier): void {
    this.windows = STREAM_TIERS[tier];
  }

  get tierWindows(): StreamWindows {
    return this.windows;
  }

  get centreChunk(): ChunkCoord | null {
    return this.centre;
  }

  status(c: ChunkCoord): ChunkStatus | undefined {
    return this.entries.get(chunkKey(c.ci, c.cj))?.status;
  }

  get(c: ChunkCoord): ChunkData | null {
    const e = this.entries.get(chunkKey(c.ci, c.cj));
    return e?.status === 'loaded' ? e.data : null;
  }

  /** Chunks that are resolved (loaded or known-missing). */
  resolvedChunks(): ChunkCoord[] {
    return [...this.entries.values()]
      .filter((e) => e.status === 'loaded' || e.status === 'missing')
      .map((e) => e.coord);
  }

  /** True when every currently visible chunk is resolved: hide the ink cover. */
  visibleReady(): boolean {
    if (!this.lastWanted) return false;
    return this.lastWanted.visible.every((c) => {
      const s = this.status(c);
      return s === 'loaded' || s === 'missing';
    });
  }

  /** Run every ~200 ms. Returns the wanted set (for debug overlays / tests). */
  update(input: StreamInput, now: number): WantedSet {
    this.lastInput = input;
    this.lastNow = now;
    const centre = this.resolveCentre(input.camera);
    const plan = computeWantedChunks(input, centre, this.windows);
    this.lastWanted = plan;

    for (const w of plan.wanted.values()) {
      const k = chunkKey(w.ci, w.cj);
      let e = this.entries.get(k);
      if (!e) {
        e = { coord: { ci: w.ci, cj: w.cj }, status: 'queued', priority: w.priority, lastWanted: now, data: null };
        this.entries.set(k, e);
      }
      e.priority = w.priority;
      e.lastWanted = now;
      if (e.status === 'failed' && now - (e.failedAt ?? 0) >= this.retryMs) e.status = 'queued';
    }
    // Queued but no longer wanted: drop silently.
    for (const [k, e] of this.entries) {
      if (e.status === 'queued' && !plan.wanted.has(k)) this.entries.delete(k);
    }
    // Eviction: outside keep window and unused for evictHoldMs. In-flight loads there are aborted.
    const evict = chunksToEvict(
      [...this.entries.values()]
        .filter((e) => e.status !== 'queued')
        .map((e) => ({ ci: e.coord.ci, cj: e.coord.cj, lastWanted: e.lastWanted })),
      centre,
      this.windows.keepRadius,
      now,
      this.evictHoldMs,
    );
    for (const c of evict) this.unload(c);
    this.pump();
    return plan;
  }

  /** Teleport / respawn: cancel in-flight loads and the queue; the next update() starts fresh around the new camera. */
  teleport(): void {
    for (const [k, e] of this.entries) {
      if (e.status === 'queued' || e.status === 'loading') {
        e.abort?.abort();
        this.entries.delete(k);
      }
    }
    this.centre = null;
    this.lastWanted = null;
  }

  /** Release everything (leaving the map). */
  dispose(): void {
    for (const e of this.entries.values()) {
      e.abort?.abort();
      if (e.status === 'loaded') this.opts.onUnloaded?.(e.coord);
    }
    this.entries.clear();
    this.centre = null;
    this.lastWanted = null;
  }

  // ---------------------------------------------------------------- internals
  private resolveCentre(cam: Rect): ChunkCoord {
    const t = screenToTile(cam.x + cam.width / 2, cam.y + cam.height / 2);
    const raw = chunkOf(t.i, t.j);
    if (!this.centre) return (this.centre = raw);
    if (raw.ci === this.centre.ci && raw.cj === this.centre.cj) return this.centre;
    const m = this.hysteresisTiles;
    const { ci, cj } = this.centre;
    const outside =
      t.i < ci * CHUNK_SIZE - m ||
      t.i >= (ci + 1) * CHUNK_SIZE + m ||
      t.j < cj * CHUNK_SIZE - m ||
      t.j >= (cj + 1) * CHUNK_SIZE + m;
    if (outside) this.centre = raw;
    return this.centre;
  }

  private pump(): void {
    const input = this.lastInput;
    if (!input) return;
    const limit = input.inCombat ? this.windows.maxParallelCombat : this.windows.maxParallel;
    let active = 0;
    const queued: Entry[] = [];
    for (const e of this.entries.values()) {
      if (e.status === 'loading') active++;
      else if (e.status === 'queued') queued.push(e);
    }
    if (active >= limit || queued.length === 0) return;
    const t = screenToTile(input.camera.x + input.camera.width / 2, input.camera.y + input.camera.height / 2);
    const dist = (c: ChunkCoord): number =>
      Math.hypot((c.ci + 0.5) * CHUNK_SIZE - t.i, (c.cj + 0.5) * CHUNK_SIZE - t.j);
    queued.sort(
      (a, b) =>
        a.priority - b.priority || dist(a.coord) - dist(b.coord) || a.coord.cj - b.coord.cj || a.coord.ci - b.coord.ci,
    );
    for (const e of queued) {
      if (active >= limit) break;
      this.start(e);
      active++;
    }
  }

  private start(e: Entry): void {
    const ac = new AbortController();
    e.abort = ac;
    e.status = 'loading';
    const stale = (): boolean => ac.signal.aborted || this.entries.get(chunkKey(e.coord.ci, e.coord.cj)) !== e;
    this.loader.load(e.coord, ac.signal).then(
      (data) => {
        if (stale()) return;
        e.abort = undefined;
        e.data = data;
        e.status = data ? 'loaded' : 'missing';
        if (data) this.opts.onLoaded?.(e.coord, data);
        this.pump();
      },
      (err: unknown) => {
        if (stale()) return;
        e.abort = undefined;
        e.status = 'failed';
        e.failedAt = this.lastNow;
        this.opts.onError?.(e.coord, err);
        this.pump();
      },
    );
  }

  private unload(c: ChunkCoord): void {
    const k = chunkKey(c.ci, c.cj);
    const e = this.entries.get(k);
    if (!e) return;
    e.abort?.abort();
    this.entries.delete(k);
    if (e.status === 'loaded') this.opts.onUnloaded?.(e.coord);
  }
}
