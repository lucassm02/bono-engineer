/** Small deterministic PRNG (mulberry32) so synthetic sessions are reproducible from a seed. */
export class Rng {
  #s: number;

  constructor(seed: number) {
    this.#s = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform [0, 1). */
  next(): number {
    this.#s = (this.#s + 0x6d2b79f5) >>> 0;
    let t = this.#s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Approximately normal (mean 0, sd 1), Box–Muller. */
  normal(): number {
    const u = Math.max(1e-12, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Normal with given sd, clamped to ±3 sd. */
  gauss(sd: number): number {
    return Math.max(-3, Math.min(3, this.normal())) * sd;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  u32(): number {
    return Math.floor(this.next() * 4294967296) >>> 0;
  }

  /** Derives an independent child generator. */
  fork(salt: number): Rng {
    return new Rng((this.u32() ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
  }
}
