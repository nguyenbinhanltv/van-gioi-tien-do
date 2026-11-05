import { TilePos, tileCenter } from '../core/IsoMath.js';

/**
 * Lưới đi được. Lưới tìm đường là lưới ô (i, j); hình thoi chỉ là cách vẽ, nên A* chạy
 * trên lưới vuông 8 hướng, rồi chuyển kết quả sang màn hình bằng tileToScreen.
 */
export interface WalkGrid {
  readonly width: number;
  readonly height: number;
  isWalkable(i: number, j: number): boolean;
}

export interface PathOptions {
  /** Giới hạn số nút mở rộng để không chặn frame trên máy yếu (mặc định 6000). */
  maxExpanded?: number;
  /** Rút gọn đường bằng kiểm tra tầm nhìn thẳng (mặc định true). */
  smooth?: boolean;
  /** Đích bị chặn thì tìm ô đi được gần nhất trong bán kính này (mặc định 6). */
  snapRadius?: number;
}

const SQRT2 = Math.SQRT2;
const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Heap nhị phân theo f, lưu chỉ số nút. */
class MinHeap {
  private items: number[] = [];
  constructor(private readonly f: Float64Array) {}
  get size(): number { return this.items.length; }
  clear(): void { this.items.length = 0; }
  push(n: number): void {
    const a = this.items, f = this.f;
    a.push(n);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[a[p]] <= f[a[k]]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): number {
    const a = this.items, f = this.f;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < a.length && f[a[l]] < f[a[m]]) m = l;
        if (r < a.length && f[a[r]] < f[a[m]]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

export class IsoPathfinder {
  private g: Float64Array;
  private f: Float64Array;
  private parent: Int32Array;
  private stamp: Uint32Array;      // "thế hệ" của lần tìm: khỏi phải xóa mảng mỗi lần
  private closed: Uint32Array;
  private gen = 0;
  private heap: MinHeap;

  constructor(private readonly grid: WalkGrid) {
    const n = grid.width * grid.height;
    this.g = new Float64Array(n);
    this.f = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new MinHeap(this.f);
  }

  private walk(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.grid.width && j < this.grid.height && this.grid.isWalkable(i, j);
  }

  /** Ô đi được gần nhất quanh (i, j), tìm theo vòng vuông tăng dần. */
  nearestWalkable(t: TilePos, radius = 6): TilePos | null {
    if (this.walk(t.i, t.j)) return t;
    for (let r = 1; r <= radius; r++) {
      let best: TilePos | null = null, bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = t.i + di, j = t.j + dj;
        const d = di * di + dj * dj;
        if (d < bestD && this.walk(i, j)) { best = { i, j }; bestD = d; }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * A* 8 hướng, chi phí chéo √2, heuristic octile, cấm cắt góc (đi chéo chỉ khi hai ô
   * kề vuông góc đều đi được). Trả về danh sách điểm thế giới (tâm ô) không gồm điểm xuất phát.
   */
  findPath(start: TilePos, goal: TilePos, opts: PathOptions = {}): TilePos[] | null {
    const { maxExpanded = 6000, smooth = true, snapRadius = 6 } = opts;
    const W = this.grid.width;
    const s = this.nearestWalkable(start, 2);
    const e = this.nearestWalkable(goal, snapRadius);
    if (!s || !e) return null;
    if (s.i === e.i && s.j === e.j) return [tileCenter(e)];

    this.gen = (this.gen + 1) >>> 0 || 1;
    const gen = this.gen;
    const h = (i: number, j: number) => {
      const dx = Math.abs(i - e.i), dy = Math.abs(j - e.j);
      return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
    };
    const startIdx = s.j * W + s.i, goalIdx = e.j * W + e.i;
    this.heap.clear();
    this.g[startIdx] = 0;
    this.f[startIdx] = h(s.i, s.j);
    this.parent[startIdx] = -1;
    this.stamp[startIdx] = gen;
    this.heap.push(startIdx);

    let expanded = 0;
    while (this.heap.size > 0) {
      const cur = this.heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goalIdx) return this.buildPath(goalIdx, smooth);
      if (++expanded > maxExpanded) return null;

      const ci = cur % W, cj = (cur / W) | 0;
      for (const [di, dj, cost] of NEIGHBORS) {
        const ni = ci + di, nj = cj + dj;
        if (!this.walk(ni, nj)) continue;
        if (di !== 0 && dj !== 0 && (!this.walk(ci + di, cj) || !this.walk(ci, cj + dj))) continue;
        const ni2 = nj * W + ni;
        if (this.closed[ni2] === gen) continue;
        const ng = this.g[cur] + cost;
        if (this.stamp[ni2] !== gen || ng < this.g[ni2]) {
          this.stamp[ni2] = gen;
          this.g[ni2] = ng;
          this.f[ni2] = ng + h(ni, nj);
          this.parent[ni2] = cur;
          this.heap.push(ni2);
        }
      }
    }
    return null;
  }

  private buildPath(goalIdx: number, smooth: boolean): TilePos[] {
    const W = this.grid.width;
    const tiles: TilePos[] = [];
    for (let n = goalIdx; n !== -1; n = this.parent[n]) tiles.push({ i: n % W, j: (n / W) | 0 });
    tiles.reverse();
    const pts = smooth ? this.stringPull(tiles) : tiles;
    return pts.slice(1).map(tileCenter);
  }

  /** Bỏ các điểm giữa khi hai điểm nhìn thẳng thấy nhau (đường đi bớt răng cưa). */
  private stringPull(tiles: TilePos[]): TilePos[] {
    if (tiles.length <= 2) return tiles;
    const out: TilePos[] = [tiles[0]];
    let anchor = 0;
    for (let k = 2; k < tiles.length; k++) {
      if (!this.lineOfSight(tiles[anchor], tiles[k])) {
        out.push(tiles[k - 1]);
        anchor = k - 1;
      }
    }
    out.push(tiles[tiles.length - 1]);
    return out;
  }

  /**
   * Tầm nhìn thẳng giữa tâm hai ô bằng duyệt ô kiểu Amanatides–Woo (supercover):
   * mọi ô mà đoạn thẳng đi qua phải đi được; đi qua đúng góc thì cả hai ô kề phải đi được.
   */
  lineOfSight(a: TilePos, b: TilePos): boolean {
    let i = a.i, j = a.j;
    const di = b.i - a.i, dj = b.j - a.j;
    const si = Math.sign(di), sj = Math.sign(dj);
    const adi = Math.abs(di), adj = Math.abs(dj);
    let tMaxI = adi === 0 ? Infinity : 0.5 / adi, tMaxJ = adj === 0 ? Infinity : 0.5 / adj;
    const tDI = adi === 0 ? Infinity : 1 / adi, tDJ = adj === 0 ? Infinity : 1 / adj;
    while (i !== b.i || j !== b.j) {
      if (Math.abs(tMaxI - tMaxJ) < 1e-9) {
        if (!this.walk(i + si, j) || !this.walk(i, j + sj)) return false;
        i += si; j += sj; tMaxI += tDI; tMaxJ += tDJ;
      } else if (tMaxI < tMaxJ) { i += si; tMaxI += tDI; }
      else { j += sj; tMaxJ += tDJ; }
      if (!this.walk(i, j)) return false;
    }
    return true;
  }
}
