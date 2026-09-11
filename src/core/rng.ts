/** 确定性随机:所有笔触变化必须来自 seed,禁止 Math.random()。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 整数 hash(用于 per-vertex/per-object 稳定抖动) */
export function hash1(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** 浮点 hash(着色器外用) */
export function hash2(a: number, b: number): number {
  return hash1(Math.imul(Math.round(a * 8192), 73856093) ^ Math.imul(Math.round(b * 8192), 19349663));
}

export class Rng {
  private f: () => number;
  constructor(seed: number) { this.f = mulberry32(seed); }
  next(): number { return this.f(); }
  range(min: number, max: number): number { return min + (max - min) * this.f(); }
  int(min: number, maxInclusive: number): number { return Math.floor(this.range(min, maxInclusive + 1 - 1e-9)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.min(arr.length - 1, Math.floor(this.f() * arr.length))]; }
  chance(p: number): boolean { return this.f() < p; }
  /** [-1,1] 近似正态 */
  signed(): number { return (this.f() + this.f() - 1); }
}
