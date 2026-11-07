/** Reviewed source origins preserve dynamic poses without fitting or changing scale. */
import { CELL_PX } from './types.js';

export interface AuthoredOrigin {
  /** Default anatomical-pelvis; lattice-root explicitly preserves authored pelvis travel. */
  readonly kind?: 'anatomical-pelvis' | 'lattice-root';
  /** Reviewed pelvis or fixed lattice registration X in normalized256 source coordinates, BEFORE slice inset. */
  readonly pelvisX: number;
  /** Fixed source ground in the same coordinates; only allowed with vertical keep. */
  readonly groundY?: number;
  readonly reason: string;
  /** Human-reviewed source landmark/image reference; not an automatic anatomical measurement. */
  readonly evidence: string;
}
export interface OriginMeasurement extends AuthoredOrigin {
  readonly source: { readonly x: number; readonly y: number };
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
}

export function validateAuthoredOrigins(clip: {
  readonly frames: number;
  readonly vertical?: 'sole' | 'keep';
  readonly authoredOrigins?: Readonly<Record<string, AuthoredOrigin>>;
}): void {
  const grounds = new Set<number>();
  const roots = new Set<number>();
  for (const [key, e] of Object.entries(clip.authoredOrigins ?? {})) {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= clip.frames)
      throw new Error(`authored origin '${key}' is not a valid clip-local frame`);
    if (
      !e ||
      (e.kind !== undefined && !['anatomical-pelvis', 'lattice-root'].includes(e.kind)) ||
      !Number.isFinite(e.pelvisX) ||
      e.pelvisX < 0 ||
      e.pelvisX >= CELL_PX ||
      typeof e.reason !== 'string' ||
      !e.reason.trim() ||
      typeof e.evidence !== 'string' ||
      !e.evidence.trim()
    )
      throw new Error('authored origin requires a finite pelvis X and reviewed reason/evidence');
    if (e.kind === 'lattice-root') {
      if (e.reason !== 'preserve authored root travel')
        throw new Error('lattice-root requires reason: preserve authored root travel');
      roots.add(e.pelvisX);
    }
    if (e.groundY !== undefined) {
      if (clip.vertical !== 'keep' || !Number.isFinite(e.groundY) || e.groundY < 0 || e.groundY > CELL_PX)
        throw new Error('authored ground requires vertical keep and a finite source ground');
      grounds.add(e.groundY);
    }
  }
  if (grounds.size > 1) throw new Error('authored ground must be fixed across a clip, never fitted per frame');
  if (
    roots.size > 1 ||
    (roots.size &&
      Array.from({ length: clip.frames }, (_, i) => clip.authoredOrigins?.[i]).some(
        (e) => e?.kind !== 'lattice-root' || e.pelvisX !== [...roots][0],
      ))
  )
    throw new Error('lattice-root requires one fixed registration X on every clip cell');
  if (
    grounds.size &&
    Array.from({ length: clip.frames }, (_, i) => clip.authoredOrigins?.[i]?.groundY).some((y) => y !== [...grounds][0])
  )
    throw new Error('a custom keep ground must be declared identically on every clip cell');
}

/** Convert before-inset normalized cell coordinates into the actual sliced pixel plane. */
export function authoredOriginPoint(
  e: AuthoredOrigin,
  width: number,
  height: number,
  inset: number,
  defaultY: number,
): { x: number; y: number } {
  const p = {
    x: (e.pelvisX / CELL_PX) * width - inset,
    y: e.groundY === undefined ? defaultY : (e.groundY / CELL_PX) * height - inset,
  };
  if (p.x < 0 || p.x >= width - 2 * inset || p.y < 0 || p.y > height - 2 * inset)
    throw new Error('authored origin falls outside the sliced source cell');
  return p;
}
