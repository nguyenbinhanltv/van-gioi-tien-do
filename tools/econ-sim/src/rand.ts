import { rngFloat, rngSeed, type RngState } from '@vgtd/shared';

/** Deterministic random source over the shared splitmix/xoshiro PRNG (no Math.random). */
export class Rand {
  private s: RngState;
  constructor(seed: number) {
    this.s = rngSeed(seed);
  }
  next(): number {
    const [v, s] = rngFloat(this.s);
    this.s = s;
    return v;
  }
  /** standard normal (Box-Muller) */
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  /** Poisson count; a normal approximation for large lambda */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda >= 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }
  /** Binomial count: Poisson for rare events, normal approximation otherwise */
  binom(n: number, p: number): number {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return Math.floor(n);
    n = Math.floor(n);
    const mean = n * p;
    if (p < 0.05 || mean < 30) return Math.min(n, this.poisson(mean));
    return Math.min(n, Math.max(0, Math.round(mean + Math.sqrt(mean * (1 - p)) * this.normal())));
  }
  /** sum of `count` independent uniform integers in [a, b] */
  sumUniform(count: number, a: number, b: number): number {
    if (count <= 0) return 0;
    const mean = (a + b) / 2;
    if (count <= 8) {
      let t = 0;
      for (let i = 0; i < count; i++) t += a + Math.floor(this.next() * (b - a + 1));
      return t;
    }
    const varOne = ((b - a + 1) ** 2 - 1) / 12;
    return Math.max(0, Math.round(count * mean + Math.sqrt(count * varOne) * this.normal()));
  }
  /** index drawn from weights */
  pick(weights: readonly number[]): number {
    let t = 0;
    for (const w of weights) t += w;
    let r = this.next() * t;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}
