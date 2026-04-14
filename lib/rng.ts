// Deterministic PRNG (Mulberry32) + Box-Muller for Gaussians. Seed-reproducible.

export class Rng {
  private state: number;
  constructor(seed: number) {
    // Coerce seed into a 32-bit unsigned int.
    this.state = (seed | 0) >>> 0 || 1;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, n). */
  nextInt(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Standard normal via Box-Muller. */
  normal(): number {
    let u1 = 0,
      u2 = 0;
    while (u1 === 0) u1 = this.next();
    while (u2 === 0) u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}
