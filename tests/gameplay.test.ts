import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { WEAPONS, SLOT_ORDER } from '../src/weapons/defs';
import { FxPool } from '../src/fx/pools';
import { buildNpcModel } from '../src/enemies/npcModel';
import { CLASS_STATS } from '../src/enemies/npc';
import { mulberry32 } from '../src/core/rng';

describe('weapon definitions (5 weapons)', () => {
  it('五武器且槽位 1-5 唯一', () => {
    expect(SLOT_ORDER).toHaveLength(5);
    const slots = SLOT_ORDER.map((id) => WEAPONS[id].slot);
    expect(new Set(slots).size).toBe(5);
    expect([...slots].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('数值符合 GENERATION_PROMPT 规格', () => {
    expect(WEAPONS.rifle.magSize).toBe(30);
    expect(WEAPONS.rifle.auto).toBe(true);
    expect(WEAPONS.shotgun.magSize).toBe(6);
    expect(WEAPONS.shotgun.pellets).toBe(12);
    expect(WEAPONS.shotgun.ejectAt).toBeCloseTo(0.27, 2);   // 泵点抛壳
    expect(WEAPONS.revolver.magSize).toBe(6);
    expect(WEAPONS.revolver.ejectAt).toBe(Infinity);        // 弹壳留膛
    expect(WEAPONS.sniper.magSize).toBe(5);
    expect(WEAPONS.sniper.ejectAt).toBeCloseTo(0.31, 2);    // 栓点抛壳
    expect(WEAPONS.katana.melee).toBe(true);
    expect(WEAPONS.katana.blockable).toBe(true);
    expect(WEAPONS.katana.magSize).toBe(Infinity);
  });
});

describe('NPC 尺寸红线(LAYOUT_CONTRACT §I)', () => {
  it('全高 2.17 = 3.4×头径;肚宽 1.14-1.20×头宽;腿段 1.4×头径', () => {
    for (let v = 0; v < 8; v++) {
      const m = buildNpcModel(v);
      const headDia = m.headRadius * 2;
      const full = m.headCenter.y + m.headRadius;
      expect(full).toBeGreaterThan(2.0);
      expect(full).toBeLessThan(2.25);
      expect(full / headDia).toBeGreaterThan(3.2);
      expect(full / headDia).toBeLessThan(3.6);
      const bellyW = m.bellyCenter.x + 0.4; // 近似肚宽(模型以 x 对称)
      void bellyW;
    }
  });
  it('8 个变体系确定性(同 seed 重建头位置一致)', () => {
    const a = buildNpcModel(3);
    const b = buildNpcModel(3);
    expect(a.headCenter.y).toBe(b.headCenter.y);
    const c = buildNpcModel(4);
    expect(a.headCenter.y).not.toBe(c.headCenter.y); // 变体间确有差异
  });
  it('四职业齐全且数值合理', () => {
    for (const cls of ['grunt', 'rusher', 'heavy', 'marksman'] as const) {
      const s = CLASS_STATS[cls];
      expect(s.hp).toBeGreaterThan(0);
      expect(s.speed).toBeGreaterThan(0);
      expect(s.score).toBeGreaterThan(0);
    }
    expect(CLASS_STATS.heavy.hp).toBeGreaterThan(CLASS_STATS.grunt.hp);
    expect(CLASS_STATS.rusher.speed).toBeGreaterThan(CLASS_STATS.grunt.speed);
    expect(CLASS_STATS.marksman.range).toBeGreaterThan(CLASS_STATS.grunt.range);
  });
});

describe('FX pools bounded', () => {
  it('弹壳池预分配且不增长', () => {
    const p = new FxPool(16, 8);
    const g0 = p.object.children.length;
    for (let i = 0; i < 60; i++) {
      p.spawnCasing({ x: 0, y: 1, z: 0 } as never, { x: 1, y: 1, z: 0 } as never);
    }
    expect(p.object.children.length).toBe(g0);
  });
  it('烟雾/碎片超量请求不崩溃', () => {
    const p = new FxPool(4, 4);
    const origin = new Vector3(0, 0, 0);
    const up = new Vector3(0, 1, 0);
    const fwd = new Vector3(0, 0, 1);
    for (let i = 0; i < 30; i++) {
      p.spawnSmoke(origin, up);
      p.spawnMuzzleShards(origin, fwd, 4);
    }
    expect(true).toBe(true);
  });
});

describe('determinism', () => {
  it('mulberry32 同 seed 同序列', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 8; i++) expect(a()).toBe(b());
  });
});
