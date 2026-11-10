import { Graphics, Label, Mask, Node, Sprite, UIRenderer, dragonBones, director } from 'cc';

/**
 * `?drawdbg=1`: where do the draw calls come from? Walks the Canvas in render order (depth first, children order = draw order),
 * groups consecutive visible renderables that the 2D batcher can merge (same texture + blend state; a Mask, a Graphics or an
 * un-batched armature always breaks) and reports the runs. The estimate is compared with the engine's real `numDrawCalls`
 * (device counter) so we know it can be trusted. Output: `window.__vgtdDrawDbg()` -> { est, real, runs[] } and a console table.
 *
 * Debug aid only: nothing in the game depends on it, and it costs nothing unless called.
 */
export interface DrawRun {
  /** what the run draws: `tex:<uuid8>` | `label:<font>` | `graphics` | `armature` | `mask` | `other` */
  key: string;
  count: number;
  /** path of the first node of the run (for finding it) */
  first: string;
  last: string;
}

function pathOf(n: Node, root: Node): string {
  const parts: string[] = [];
  for (let c: Node | null = n; c && c !== root; c = c.parent) parts.push(c.name);
  return parts.reverse().join('/');
}

/** Batch key of a renderable, or null when it draws nothing. `solo` = never merges with its neighbours. */
function keyOf(c: UIRenderer): { key: string; solo: boolean } | null {
  if (!c.enabledInHierarchy || c.color.a === 0) return null;
  const blend = `${(c as unknown as { srcBlendFactor?: number }).srcBlendFactor ?? 0}/${(c as unknown as { dstBlendFactor?: number }).dstBlendFactor ?? 0}`;
  if (c instanceof Sprite) {
    const tex = c.spriteFrame?.texture;
    return tex ? { key: `tex:${tex.getId().slice(0, 8)} ${blend}`, solo: false } : null;
  }
  if (c instanceof Label) {
    if (!c.string) return null;
    // the texture a label batches by is its `spriteFrame` (the shared letter / bitmap atlas page in CHAR / BITMAP cache mode, a private
    // `_ttfSpriteFrame` texture in NONE mode); the key also carries the cache mode so a mixed run shows up
    const tex = c.spriteFrame as unknown as { getId?(): string; texture?: { getId(): string } } | null;
    const id = tex?.texture?.getId() ?? tex?.getId?.();
    return { key: `label:${c.cacheMode}:${id ? id.slice(0, 8) : '?'} ${blend}`, solo: false };
  }
  if (c instanceof Graphics) return { key: 'graphics', solo: true };
  if (c instanceof Mask) return { key: 'mask', solo: true };
  const name = c.constructor.name;
  if (/Armature/.test(name)) {
    const batch = (c as unknown as { enableBatch?: boolean }).enableBatch === true;
    return { key: batch ? 'armature(batch)' : 'armature', solo: !batch };
  }
  return { key: `other:${name}`, solo: true };
}

export function collectDrawRuns(root: Node): { runs: DrawRun[]; est: number; real: number } {
  const runs: DrawRun[] = [];
  let prevKey = '';
  let prevSolo = true;
  const visit = (n: Node): void => {
    if (!n.activeInHierarchy) return;
    for (const c of n.getComponents(UIRenderer)) {
      const k = keyOf(c);
      if (!k) continue;
      const p = pathOf(n, root);
      if (runs.length && !k.solo && !prevSolo && k.key === prevKey) {
        const r = runs[runs.length - 1]!;
        r.count++;
        r.last = p;
      } else runs.push({ key: k.key, count: 1, first: p, last: p });
      prevKey = k.key;
      prevSolo = k.solo;
    }
    for (const ch of n.children) visit(ch);
  };
  visit(root);
  const real = director.root?.device?.numDrawCalls ?? 0;
  return { runs, est: runs.length, real };
}

/** Runs grouped by kind and by layer (first two path segments), plus the raw run list. */
export function summarize(root: Node): {
  est: number;
  real: number;
  byKey: Record<string, number>;
  layers: Array<[string, number]>;
  runs: string[];
} {
  const { runs, est, real } = collectDrawRuns(root);
  const byKey: Record<string, number> = {};
  const perLayer: Record<string, number> = {};
  for (const r of runs) {
    const k = r.key.split(' ')[0]!.replace(/:[0-9a-f]{8}$/, ':*');
    byKey[k] = (byKey[k] ?? 0) + 1;
    const layer = r.first.split('/').slice(0, 2).join('/') || '(root)';
    perLayer[layer] = (perLayer[layer] ?? 0) + 1;
  }
  const layers = Object.entries(perLayer)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14);
  return { est, real, byKey, layers, runs: runs.map((r) => `${r.count}x ${r.key} ${r.first}`) };
}

/**
 * `window.__vgtdBatchTrace(reset?)`: which component STARTS each 2D batch. Wraps the engine's `Batcher2D.autoMergeBatches` (called when
 * the next renderable cannot join the running batch: other texture / material / render-data hash; it receives the first component of
 * the batch being flushed) and counts, per node path with digits folded (`Slot3` -> `Slot#`), how often a batch started at it. Returns { frames, perFrame: [[key, n per frame]...] } since the
 * last reset. Debug aid only.
 */
function installBatchTrace(root: Node): void {
  const b = (director.root as unknown as { batcher2D?: Record<string, unknown> })?.batcher2D as
    (Record<string, unknown> & { autoMergeBatches(c?: UIRenderer): void }) | undefined;
  if (!b || b.__traced) return;
  b.__traced = true;
  let counts: Record<string, number> = {};
  let frames = 0;
  const orig = b.autoMergeBatches.bind(b);
  b.autoMergeBatches = (comp?: UIRenderer) => {
    // (release builds mangle the engine's `_private` fields: only the component handed in by the engine is usable)
    if (comp) {
      const key = `${comp.constructor.name} ${pathOf(comp.node, root).replace(/[0-9]+/g, '#')}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    orig(comp);
  };
  const g = globalThis as unknown as Record<string, unknown>;
  const tick = (): void => {
    frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  g.__vgtdBatchTrace = (reset = false) => {
    const perFrame: Array<[string, number]> = [];
    for (const k of Object.keys(counts)) perFrame.push([k, Math.round((counts[k]! / Math.max(1, frames)) * 100) / 100]);
    perFrame.sort((x, y) => y[1] - x[1]);
    const out = { frames, perFrame };
    if (reset) {
      counts = {};
      frames = 0;
    }
    return out;
  };
}

/** Publishes `window.__vgtdDrawDbg()`; call once with the Canvas node. */
export function installDrawDebug(root: Node): void {
  (globalThis as unknown as Record<string, unknown>).__vgtdDrawDbg = () => summarize(root);
  installDrawExperiments(root);
  installBatchTrace(root);
}

/**
 * Debug experiments (`window.__vgtdDrawExp(name)`), applied to the live scene so a batching idea can be tried in seconds; read the
 * effect from `window.__vgtdPerf.drawCalls` a second later. Never used by the game.
 */
const EXPERIMENTS: Record<string, (root: Node) => void> = {
  hideCombatHud: (root) => {
    const n = root.getChildByPath('Hud/CombatHud');
    if (n) n.active = false;
  },
  labelsChar: (root) => root.getComponentsInChildren(Label).forEach((l) => (l.cacheMode = Label.CacheMode.CHAR)),
  labelsBitmap: (root) => root.getComponentsInChildren(Label).forEach((l) => (l.cacheMode = Label.CacheMode.BITMAP)),
  armatureBatch: (root) =>
    root.getComponentsInChildren(dragonBones.ArmatureDisplay).forEach((a) => (a.enableBatch = true)),
  hideArmatures: (root) =>
    root.getComponentsInChildren(dragonBones.ArmatureDisplay).forEach((a) => (a.node.active = false)),
  /** deactivate L3 children outside the view (+ margin): are off-screen props / actors costing draw calls and batch breaks? */
  cullL3: (root) => {
    const world = root.getChildByName('World');
    const l3 = world?.getChildByName('L3_YSort');
    if (!world || !l3) return;
    const z = world.scale.x || 1;
    const margin = 320;
    const w = 1280 / 2 + margin,
      h = 720 / 2 + margin; // design-size view (FIXED_HEIGHT 720, 16:9 in the harness)
    for (const ch of l3.children) {
      const x = ch.position.x * z + world.position.x;
      const y = ch.position.y * z + world.position.y;
      ch.active = Math.abs(x) <= w && Math.abs(y) <= h;
    }
  },
  hideShadows: (root) => {
    const n = root.getChildByPath('World/L2_Shadow');
    if (n) n.active = false;
  },
};

export function installDrawExperiments(root: Node): void {
  (globalThis as unknown as Record<string, unknown>).__vgtdDrawExp = (name: string) => {
    // `hide:<path>` / `show:<path>`: toggle one node (path under the Canvas, or `*Prefix` = every child of the parent named Prefix...)
    const m = /^(hide|show):(.+)$/.exec(name);
    if (m) {
      const [parentPath, prefix] = m[2]!.includes('*') ? m[2]!.split('*') : [m[2]!, ''];
      const parent = root.getChildByPath(parentPath!);
      if (!parent) return `no node ${parentPath}`;
      const targets = m[2]!.includes('*') ? parent.children.filter((c) => c.name.startsWith(prefix!)) : [parent];
      targets.forEach((t) => (t.active = m[1] === 'show'));
      return `ok ${targets.length}`;
    }
    const f = EXPERIMENTS[name];
    if (!f) return `unknown experiment ${name}; try ${Object.keys(EXPERIMENTS).join(', ')}`;
    f(root);
    return 'ok';
  };
}
