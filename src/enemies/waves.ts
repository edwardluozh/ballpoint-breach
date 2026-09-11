import * as THREE from 'three';
import { Npc } from './npc';
import type { NpcClass } from './npcModel';
import type { Emitter } from '../core/events';
import type { GameEvents } from './npc';

/** 五波:Grunt/Rusher/Heavy/Marksman;波 5 = THE DOODLER(boss 由 BossSystem 接管)。 */
const WAVES: { cls: NpcClass; count: number }[][] = [
  [{ cls: 'grunt', count: 4 }],
  [{ cls: 'grunt', count: 6 }, { cls: 'rusher', count: 2 }],
  [{ cls: 'grunt', count: 5 }, { cls: 'rusher', count: 3 }, { cls: 'heavy', count: 1 }],
  [{ cls: 'grunt', count: 6 }, { cls: 'rusher', count: 3 }, { cls: 'heavy', count: 2 }, { cls: 'marksman', count: 2 }],
  [{ cls: 'grunt', count: 4 }, { cls: 'rusher', count: 2 }, { cls: 'heavy', count: 1 }, { cls: 'marksman', count: 1 }], // + boss
];

export interface WaveState {
  wave: number;            // 1..5
  enemiesLeft: number;
  intermission: number;    // >0 → 倒计时中
  bossActive: boolean;
  cleared: boolean;
  totalWaves: number;
}

export class WaveManager {
  state: WaveState = { wave: 0, enemiesLeft: 0, intermission: 3.5, bossActive: false, cleared: false, totalWaves: 5 };
  private spawnQueue: { cls: NpcClass; delay: number }[] = [];
  private spawnCursor = 0;
  private allSpawns: THREE.Vector3[] = [];

  constructor(
    spawns: THREE.Vector3[],
    private em: Emitter<GameEvents>,
    private onSpawn: (npc: Npc) => void,
    private onBossWave: () => void,
    private onAllCleared: () => void,
  ) {
    this.allSpawns = spawns;
  }

  update(dt: number, alive: number, playerPos?: THREE.Vector3) {
    const s = this.state;
    if (s.cleared) return;

    if (s.intermission > 0) {
      s.intermission -= dt;
      if (s.intermission <= 0) this.startWave(s.wave + 1);
      return;
    }

    // 出队
    for (const q of this.spawnQueue) q.delay -= dt;
    while (this.spawnQueue.length && this.spawnQueue[0].delay <= 0 && alive + 1 < 24) {
      const q = this.spawnQueue.shift()!;
      // 寻找最远生成点(玩家相反侧,狩猎感)
      const sp = this.selectFarSpawn(playerPos);
      const npc = new Npc(q.cls, (this.spawnCursor * 7) % 8, sp.clone());
      this.spawnCursor++;
      this.onSpawn(npc);
    }

    s.enemiesLeft = alive + this.spawnQueue.length;
    if (s.enemiesLeft === 0 && s.intermission <= 0) {
      // 波清
      this.em.emit('killFeed', { text: `第 ${s.wave} 波已清除 · 喘口气 +800`, points: 800 });
      if (s.wave >= 5) {
        s.cleared = true;
        this.onAllCleared();
        return;
      }
      s.intermission = 6;
    }
  }

  private startWave(n: number) {
    const s = this.state;
    s.wave = n;
    this.spawnQueue = [];
    let d = 0;
    for (const g of WAVES[n - 1]) {
      for (let i = 0; i < g.count; i++) {
        this.spawnQueue.push({ cls: g.cls, delay: d });
        d += 0.55;
      }
    }
    if (n === 5) {
      this.em.emit('killFeed', { text: '涂鸦大王来了', points: 0 });
      this.onBossWave();
    }
  }

  begin() { if (this.state.wave === 0 && this.state.intermission > 0) { /* 初始倒计时已设 */ } }

  private selectFarSpawn(playerPos?: THREE.Vector3): THREE.Vector3 {
    if (!playerPos || this.allSpawns.length === 0) {
      return this.allSpawns[this.spawnCursor % this.allSpawns.length];
    }

    // 寻找距离玩家最远的生成点(最小 18-25m)
    let best: THREE.Vector3 | null = null;
    let bestDist = 0;
    const pFlat = new THREE.Vector3(playerPos.x, 0, playerPos.z);

    for (const sp of this.allSpawns) {
      const spFlat = new THREE.Vector3(sp.x, 0, sp.z);
      const dist = pFlat.distanceTo(spFlat);
      // 优先选择远距离点(18m+),如果都远就选最远的
      if (dist > bestDist && dist >= 18) {
        bestDist = dist;
        best = sp;
      }
    }

    // 如果没有符合条件的,选相对较远的
    if (!best) {
      for (const sp of this.allSpawns) {
        const spFlat = new THREE.Vector3(sp.x, 0, sp.z);
        const dist = pFlat.distanceTo(spFlat);
        if (dist > bestDist) {
          bestDist = dist;
          best = sp;
        }
      }
    }

    return best || this.allSpawns[0];
  }
}
