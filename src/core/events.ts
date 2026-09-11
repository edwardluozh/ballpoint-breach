/** 轻量类型化事件总线:仿真与视觉解耦(武器发攻击请求,敌人发伤害/生命周期事件)。 */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(p: never) => void>>();
  on<K extends keyof E>(k: K, fn: (p: E[K]) => void): () => void {
    let s = this.map.get(k);
    if (!s) { s = new Set(); this.map.set(k, s); }
    s.add(fn as never);
    return () => s!.delete(fn as never);
  }
  emit<K extends keyof E>(k: K, p: E[K]) {
    const s = this.map.get(k);
    if (s) for (const fn of s) (fn as (x: E[K]) => void)(p);
  }
  clear() { this.map.clear(); }
}
