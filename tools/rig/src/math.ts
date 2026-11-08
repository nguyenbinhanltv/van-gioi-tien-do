/**
 * 2D math for rig evaluation. Rig space = pivot space (docs/03, ADR-021): origin at the feet, x right, **y up**,
 * angles in degrees, counter-clockwise positive. The DragonBones exporter flips y/rotation at the file boundary.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Local bone transform (no shear): translate, rotate (deg, CCW), scale. */
export interface LocalTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

/** Affine matrix [a c tx; b d ty], column vectors. */
export interface Mat {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export const DEG = Math.PI / 180;
export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export function composeLocal(t: LocalTransform): Mat {
  const r = t.rotation * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos * t.scaleX, b: sin * t.scaleX, c: -sin * t.scaleY, d: cos * t.scaleY, tx: t.x, ty: t.y };
}

/** parent · child */
export function mulMat(p: Mat, ch: Mat): Mat {
  return {
    a: p.a * ch.a + p.c * ch.b,
    b: p.b * ch.a + p.d * ch.b,
    c: p.a * ch.c + p.c * ch.d,
    d: p.b * ch.c + p.d * ch.d,
    tx: p.a * ch.tx + p.c * ch.ty + p.tx,
    ty: p.b * ch.tx + p.d * ch.ty + p.ty,
  };
}

export function applyMat(m: Mat, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty };
}

export function invertMat(m: Mat): Mat {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) throw new RangeError('singular matrix');
  const ia = m.d / det;
  const ib = -m.b / det;
  const ic = -m.c / det;
  const id = m.a / det;
  return { a: ia, b: ib, c: ic, d: id, tx: -(ia * m.tx + ic * m.ty), ty: -(ib * m.tx + id * m.ty) };
}

/** World rotation (deg) of a matrix's x axis. */
export function matRotation(m: Mat): number {
  return Math.atan2(m.b, m.a) / DEG;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest signed angle difference b − a in degrees, in (−180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * CSS-style cubic bezier easing: control points (x1,y1), (x2,y2) with endpoints (0,0) and (1,1); returns y for a given
 * progress x in [0,1]. Same parameterisation as the DragonBones `curve: [x1, y1, x2, y2]` field.
 */
export function cubicBezierEase(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bez = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 40; i++) {
    t = (lo + hi) / 2;
    const bx = bez(x1, x2, t);
    if (Math.abs(bx - x) < 1e-7) break;
    if (bx < x) lo = t;
    else hi = t;
  }
  return bez(y1, y2, t);
}
