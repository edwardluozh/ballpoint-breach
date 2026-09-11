import * as THREE from 'three';
import { Emitter } from '../core/events';
import { buildNpcModel, animateNpc, type NpcClass, type NpcModelParts } from './npcModel';
import type { ColliderWorld } from '../world/colliders';
import type { NavGraph } from '../world/navgraph';
import { PAL } from '../render/palette';

/** 全局事件(仿真↔视觉解耦) */
export interface GameEvents extends Record<string, unknown> {
  enemyAttackProjectile: { from: THREE.Vector3; to: THREE.Vector3; dmg: number; enemy: Npc };
  enemyAttackMelee: { dmg: number; enemy: Npc };
  enemyDamaged: { enemy: Npc; head: boolean };
  enemyDied: { enemy: Npc; impactDir: THREE.Vector3; head: boolean };
  playerHit: { dmg: number; fromDir: THREE.Vector3 };   // fromDir: 伤害来源相对玩家(水平)
  killFeed: { text: string; points: number };
  playerHeal: { amount: number };
}

export const CLASS_STATS: Record<NpcClass, {
  hp: number; speed: number; range: number; cooldown: number;
  dmg: number; projectile: boolean; projSpeed: number; score: number; label: string;
}> = {
  grunt: { hp: 60, speed: 3.2, range: 26, cooldown: 1.6, dmg: 8, projectile: true, projSpeed: 17, score: 100, label: '小兵' },
  rusher: { hp: 45, speed: 6.3, range: 1.8, cooldown: 1.05, dmg: 14, projectile: false, projSpeed: 0, score: 130, label: '突进者' },
  heavy: { hp: 170, speed: 2.25, range: 2.1, cooldown: 1.8, dmg: 22, projectile: false, projSpeed: 0, score: 260, label: '重装' },
  marksman: { hp: 50, speed: 2.6, range: 42, cooldown: 3.1, dmg: 16, projectile: true, projSpeed: 27, score: 180, label: '神射手' },
};

type FsmState = 'seek' | 'combat' | 'stagger';

export interface NpcCtx {
  dt: number;
  playerPos: THREE.Vector3;       // 脚底
  playerEye: THREE.Vector3;
  colliders: ColliderWorld;
  nav: NavGraph;
  em: Emitter<GameEvents>;
  others: Npc[];
  now: number;
}

let nextId = 1;

export class Npc {
  readonly id = nextId++;
  readonly cls: NpcClass;
  readonly variantSeed: number;
  model: NpcModelParts;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  dead = false;
  deadTime = 0;
  state: FsmState = 'seek';
  private stateTimer = 0;
  private attackCooldown = 0;
  private staggerT = 0;
  private attackAnimT = 0;
  private gait = 0;
  private navPath: number[] = [];
  private navIdx = 0;
  private repathTimer = 0;
  private stuckTimer = 0;
  private lastPos = new THREE.Vector3();
  private strafeDir = 1;
  private strafePhase = 0;
  private losCache = false;
  private losTimer = 0;
  private wantMove = new THREE.Vector3();

  constructor(cls: NpcClass, variantSeed: number, spawn: THREE.Vector3) {
    this.cls = cls;
    this.variantSeed = variantSeed;
    this.model = buildNpcModel(variantSeed, cls);
    this.hp = this.maxHp = CLASS_STATS[cls].hp;
    this.pos.copy(spawn);
    this.lastPos.copy(spawn);
    this.syncTransform();
  }

  get eyePos(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + 1.85, this.pos.z);
  }
  headWorld(out = new THREE.Vector3()): THREE.Vector3 {
    out.copy(this.model.headCenter).applyMatrix4(this.model.group.matrixWorld);
    return out;
  }

  syncTransform() {
    this.model.group.position.copy(this.pos);
    this.model.group.rotation.y = this.yaw;
  }

  takeHit(dmg: number, dir: THREE.Vector3, head: boolean, em: Emitter<GameEvents>, now = 0): boolean {
    if (this.dead) return false;
    const d = head ? dmg * 2.4 : dmg;
    this.hp -= d;
    em.emit('enemyDamaged', { enemy: this, head });
    if (this.hp <= 0) {
      this.dead = true;
      this.deadTime = now;
      em.emit('enemyDied', { enemy: this, impactDir: dir.clone().normalize(), head });
      return true;
    }
    // 击退 + 踉跄
    this.vel.addScaledVector(dir.clone().setY(0).normalize(), head ? 3.4 : 2.1);
    this.state = 'stagger';
    this.stateTimer = this.staggerT = head ? 0.34 : 0.22;
    return false;
  }

  update(ctx: NpcCtx) {
    if (this.dead) return;
    const st = CLASS_STATS[this.cls];
    const dt = ctx.dt;

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.attackAnimT = Math.max(0, this.attackAnimT - dt * 4);
    if (this.staggerT > 0) this.staggerT = Math.max(0, this.staggerT - dt);

    if (this.state === 'stagger') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.state = 'seek';
    }

    const toPlayer = new THREE.Vector3().subVectors(ctx.playerPos, this.pos);
    const dist = toPlayer.length();

    // 视线(0.15s 缓存:raycast 全盒遍历是主要逻辑开销)
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.15;
      this.losCache = ctx.colliders.lineOfSight(
        new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z), ctx.playerEye);
    }
    const los = this.losCache;

    if (this.state !== 'stagger') {
      this.state = (dist <= st.range && los) ? 'combat' : 'seek';
    }

    this.wantMove.set(0, 0, 0);
    if (this.state === 'seek') {
      this.navigate(ctx, toPlayer, dist);
    } else if (this.state === 'combat') {
      // 面向玩家 + strafe + 攻击
      this.yaw = Math.atan2(toPlayer.x, toPlayer.z);
      this.strafePhase += dt * 1.7;
      const strafeSign = Math.sin(this.strafePhase) > 0 ? 1 : -1;
      const side = new THREE.Vector3(toPlayer.z, 0, -toPlayer.x).normalize();
      const desired = st.range > 6 ? st.range * 0.55 : 1.2;
      const fwdAmount = dist > desired ? 0.8 : dist < desired * 0.6 ? -0.5 : 0;
      this.wantMove
        .addScaledVector(toPlayer.clone().setY(0).normalize(), fwdAmount)
        .addScaledVector(side, strafeSign * 0.55);
      if (this.attackCooldown <= 0 && los) {
        this.attack(ctx, toPlayer);
      }
    }

    // 分离
    for (const o of ctx.others) {
      if (o === this || o.dead) continue;
      const d = this.pos.distanceTo(o.pos);
      if (d < 0.85 && d > 1e-4) {
        this.wantMove.addScaledVector(
          new THREE.Vector3().subVectors(this.pos, o.pos).setY(0).normalize(), (0.85 - d) * 2.2);
      }
    }

    // 移动 + 碰撞
    if (this.wantMove.lengthSq() > 1e-6) {
      const spd = st.speed * (this.state === 'stagger' ? 0.3 : 1);
      const move = this.wantMove.clone().setY(0).normalize().multiplyScalar(spd * dt);
      const applied = ctx.colliders.resolveHorizontal(this.pos, move, 0.33, 1.9);
      // 卡死检测:请求移动但实际位移过小
      const want = move.length(), got = applied.length();
      if (want > 0.02 && got < want * 0.25) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 0.45) {
          this.recoverStuck(ctx);
          this.stuckTimer = 0;
        }
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
      }
      this.gait += got * 1.7;
    }
    // 击退速度衰减
    this.pos.addScaledVector(this.vel, dt);
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));

    // 重力/支撑
    const gh = ctx.colliders.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.4, 0.5);
    if (this.pos.y > gh + 0.02) {
      this.pos.y = Math.max(gh, this.pos.y - 14 * dt); // 下落
    } else {
      this.pos.y = gh;
    }

    this.syncTransform();
    const speed01 = Math.min(1, this.wantMove.length());
    animateNpc(this.model, this.gait, speed01, this.attackAnimT, this.staggerT);
  }

  private attack(ctx: NpcCtx, toPlayer: THREE.Vector3) {
    const st = CLASS_STATS[this.cls];
    this.attackCooldown = st.cooldown * (0.85 + ((this.id * 37) % 10) / 33);
    this.attackAnimT = 1;
    if (st.projectile) {
      const from = this.eyePos;
      const to = ctx.playerEye.clone();
      ctx.em.emit('enemyAttackProjectile', { from, to, dmg: st.dmg, enemy: this });
    } else {
      ctx.em.emit('enemyAttackMelee', { dmg: st.dmg, enemy: this });
      ctx.em.emit('playerHit', { dmg: st.dmg, fromDir: toPlayer.clone().setY(0).normalize().negate() });
    }
  }

  /** 寻路 + 沿路径走 */
  private navigate(ctx: NpcCtx, toPlayer: THREE.Vector3, dist: number) {
    const dt = ctx.dt;
    this.repathTimer -= dt;
    if (this.navPath.length === 0 || this.repathTimer <= 0) {
      this.repathTimer = 1.1 + ((this.id * 53) % 10) / 20;
      const myFloor = Math.abs(this.pos.y) < 1.2 ? 0 : Math.round(this.pos.y / 3);
      const start = ctx.nav.nearest(this.pos, this.pos.y < 1.2 ? 0 : undefined);
      const goal = ctx.nav.nearest(ctx.playerPos, ctx.playerPos.y < 1.2 ? 0 : undefined);
      if (start >= 0 && goal >= 0) {
        this.navPath = ctx.nav.findPath(start, goal);
        this.navIdx = 0;
      }
    }
    // 目标点:路径节点或玩家本体
    let target: THREE.Vector3 | null = null;
    while (this.navIdx < this.navPath.length) {
      const node = ctx.nav.nodes[this.navPath[this.navIdx]];
      const np = node.pos;
      const flatD = Math.hypot(np.x - this.pos.x, np.z - this.pos.z);
      const reachable = flatD < 1.6 || (flatD < 2.4 && ctx.colliders.lineOfSight(this.eyePos, np.clone().setY(np.y + 1.2)));
      if (reachable && Math.abs(np.y - this.pos.y) < 2.6) {
        this.navIdx++;
        continue;
      }
      target = np;
      break;
    }
    if (!target) target = ctx.playerPos;
    const dir = new THREE.Vector3().subVectors(target, this.pos).setY(0);
    if (dir.lengthSq() > 1e-4) {
      dir.normalize();
      this.yaw = Math.atan2(dir.x, dir.z);
      this.wantMove.copy(dir);
    }
  }

  /** 卡死恢复:放弃当前目标,选择确定性可行邻居或逃逸向 */
  private recoverStuck(ctx: NpcCtx) {
    this.navPath = [];
    // 确定性逃逸:与当前位置相对墙的法线合成的开阔向
    const probe = new THREE.Vector3(Math.cos(this.id * 2.4), 0, Math.sin(this.id * 2.4));
    for (let i = 0; i < 4; i++) {
      const dir = probe.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * Math.PI / 2);
      const hit = ctx.colliders.raycast(
        new THREE.Vector3(this.pos.x, this.pos.y + 0.9, this.pos.z), dir, 2.2);
      if (!hit) {
        this.wantMove.copy(dir);
        this.pos.addScaledVector(dir, 0.05); // 轻推脱离穿透
        return;
      }
    }
    this.wantMove.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
}

/* ---------- 敌方投射物(小红墨点) ---------- */

interface Projectile {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dmg: number;
  reflected: boolean;
  fromEnemy: boolean;
  mesh: THREE.Line;
  trail: THREE.Vector3[];
}

const projMatRed = new THREE.LineBasicMaterial({ color: PAL.red, transparent: true, opacity: 0.95 });
const projMatInk = new THREE.LineBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.95 });

export class ProjectilePool {
  private items: Projectile[] = [];
  private group = new THREE.Group();
  /** 预分配 5 点轨迹缓冲,避免每帧 dispose/new 几何 */
  private static TRAIL_N = 5;

  constructor(private max = 64) {
    for (let i = 0; i < max; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ProjectilePool.TRAIL_N * 3), 3));
      const mesh = new THREE.Line(g, projMatRed);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.items.push({
        alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), dmg: 0,
        reflected: false, fromEnemy: true, mesh, trail: [],
      });
    }
  }

  get object(): THREE.Group { return this.group; }

  spawn(from: THREE.Vector3, dir: THREE.Vector3, speed: number, dmg: number, fromEnemy = true) {
    const p = this.items.find((x) => !x.alive);
    if (!p) return;
    p.alive = true;
    p.pos.copy(from);
    p.vel.copy(dir).normalize().multiplyScalar(speed);
    p.dmg = dmg;
    p.fromEnemy = fromEnemy;
    p.reflected = false;
    p.mesh.material = projMatRed;
    p.mesh.visible = true;
    p.trail = [from.clone()];
  }

  reflect(p: Projectile, newDir: THREE.Vector3) {
    p.reflected = true;
    p.fromEnemy = false;
    p.vel.copy(newDir).normalize().multiplyScalar(p.vel.length() * 1.15);
    p.mesh.material = projMatInk;
  }

  /** 返回被玩家格挡检测所需的活跃弹列表 */
  active(): Projectile[] { return this.items.filter((p) => p.alive); }

  update(
    dt: number,
    ctx: {
      colliders: ColliderWorld;
      playerEye: THREE.Vector3; playerPos: THREE.Vector3;
      enemies: Npc[];
      em: Emitter<GameEvents>;
      playerBlocks: boolean;
      playerBlockDir: THREE.Vector3;
      onPlayerBlockReflect?: (p: unknown, dir: THREE.Vector3) => void;
    },
  ) {
    for (const p of this.items) {
      if (!p.alive) continue;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.y -= 3.5 * dt; // 轻微下坠
      p.trail.push(p.pos.clone());
      if (p.trail.length > ProjectilePool.TRAIL_N - 1) p.trail.shift();
      // 预分配缓冲更新(无 GC)
      const attr = p.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < ProjectilePool.TRAIL_N; i++) {
        const pt = p.trail[Math.min(i, p.trail.length - 1)] ?? p.pos;
        arr[i * 3] = pt.x; arr[i * 3 + 1] = pt.y; arr[i * 3 + 2] = pt.z;
      }
      attr.needsUpdate = true;

      // 撞墙
      const hit = ctx.colliders.raycast(p.pos.clone().addScaledVector(p.vel, -dt), p.vel.clone().normalize(), p.vel.length() * dt + 0.1);
      if (hit && hit.box.tag !== 'rail') { this.kill(p); continue; }

      if (p.fromEnemy) {
        const pc = new THREE.Vector3(ctx.playerPos.x, ctx.playerPos.y + 1.0, ctx.playerPos.z);
        // 武士刀格挡反弹:弹在近处且来向在玩家视线前方
        if (ctx.playerBlocks && p.pos.distanceTo(pc) < 1.9) {
          const toBullet = p.vel.clone().normalize().negate();
          if (toBullet.dot(ctx.playerBlockDir) > 0.35) {
            this.reflect(p, toBullet);
            continue;
          }
        }
        // 打玩家(球近似)
        if (p.pos.distanceTo(pc) < 0.62) {
          this.kill(p);
          ctx.em.emit('playerHit', {
            dmg: p.dmg,
            fromDir: p.vel.clone().setY(0).normalize(),
          });
          continue;
        }
      } else {
        // 反弹后打敌人
        for (const e of ctx.enemies) {
          if (e.dead) continue;
          const c = new THREE.Vector3(e.pos.x, e.pos.y + 1.15, e.pos.z);
          if (p.pos.distanceTo(c) < 0.62) {
            this.kill(p);
            e.takeHit(p.dmg * 1.6, p.vel.clone().normalize(), false, ctx.em);
            ctx.em.emit('killFeed', { text: '反弹击中 +150', points: 150 });
            break;
          }
        }
      }
      if (p.pos.y < -5 || Math.abs(p.pos.x) > 60 || Math.abs(p.pos.z) > 60) this.kill(p);
    }
  }

  private kill(p: Projectile) {
    p.alive = false;
    p.mesh.visible = false;
  }
}
