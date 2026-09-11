import * as THREE from 'three';
import { WEAPONS, SLOT_ORDER, type WeaponId, type WeaponDef } from './defs';
import { buildViewModel, type ViewModel } from './viewmodels';
import type { Input } from '../core/input';
import type { Emitter } from '../core/events';
import type { GameEvents, Npc } from '../enemies/npc';
import type { ColliderWorld, Box } from '../world/colliders';
import type { FxPool } from '../fx/pools';
import { PAL } from '../render/palette';

/**
 * 武器系统:输入驱动,发出攻击请求;命中判定通过世界查询完成。
 * 步态摆动 ~1.68Hz;recoil 弹簧独立;切枪有守卫过渡;武士刀 4 阶段姿势机。
 */

interface AmmoState { inMag: number; reserve: number; }

/** boss 命中接口(boss.ts 实现) */
export interface HittableBoss {
  pos: THREE.Vector3;
  dead: boolean;
  takeHit(dmg: number, dir: THREE.Vector3, head: boolean): boolean;
}

export interface WeaponSystemCtx {
  camera: THREE.PerspectiveCamera;
  input: Input;
  colliders: ColliderWorld;
  enemies: Npc[];
  em: Emitter<GameEvents>;
  fx: FxPool;
  barricades: { box: Box; mesh: THREE.Mesh; hp: number }[];
  playerPos: THREE.Vector3;
  grappleAnchors: THREE.Vector3[];
  boss: HittableBoss | null;
}

type SlashPhase = 'idle' | 'windup' | 'contact' | 'follow' | 'recovery';

export class WeaponSystem {
  current: WeaponId = 'rifle';
  ammo: Record<WeaponId, AmmoState>;
  private vms: Record<WeaponId, ViewModel> = {} as never;
  private holder = new THREE.Group();
  private fireCd = 0;
  private reloadT = 0;
  private delayT = 0;           // 泵/栓
  private switchT = 0;          // 切枪过渡
  private ejectPending = -1;    // 开火后抛壳倒计时
  private recoil = 0;           // viewmodel 后坐弹簧
  private recoilCam = 0;        // 相机后坐累计(外部读取施加)
  private slashPhase: SlashPhase = 'idle';
  private slashT = 0;
  private slashReverse = false;
  private slashHitDone = false;
  private blockStamina = 100;
  blocking = false;
  blockFlash = 0;
  private ads = false;          // 狙击开镜
  private grappleCd = 0;
  private gaitPhase = 0;

  constructor(private ctx: WeaponSystemCtx) {
    for (const id of SLOT_ORDER) {
      const def = WEAPONS[id];
      this.vms[id] = buildViewModel(id);
      this.vms[id].group.visible = false;
      this.holder.add(this.vms[id].group);
    }
    this.ammo = {} as never;
    for (const id of SLOT_ORDER) {
      this.ammo[id] = { inMag: WEAPONS[id].magSize, reserve: WEAPONS[id].reserveStart };
    }
    this.vms.rifle.group.visible = true;
  }

  get object(): THREE.Group { return this.holder; }
  get def(): WeaponDef { return WEAPONS[this.current]; }
  get reloading(): boolean { return this.reloadT > 0; }
  setBoss(b: HittableBoss | null) { this.ctx.boss = b; }
  get isADS(): boolean { return this.ads; }
  get grappleReady(): boolean { return this.grappleCd <= 0; }

  /** 补给 */
  refillAll(frac = 0.5) {
    for (const id of SLOT_ORDER) {
      const d = WEAPONS[id];
      if (!Number.isFinite(d.magSize)) continue;
      const a = this.ammo[id];
      a.reserve = Math.min(d.reserveMax, a.reserve + Math.ceil(d.reserveMax * frac));
      a.inMag = d.magSize;
    }
    this.blockStamina = 100;
  }

  update(dt: number, gaitPhase: number, sprinting: boolean) {
    const { input, camera } = this.ctx;
    const inp = input.state;
    this.gaitPhase = gaitPhase;
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.delayT = Math.max(0, this.delayT - dt);
    this.switchT = Math.max(0, this.switchT - dt);
    this.grappleCd = Math.max(0, this.grappleCd - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.recoilCam = Math.max(0, this.recoilCam - dt * 1.8);
    this.blockFlash = Math.max(0, this.blockFlash - dt * 5);

    // 换弹
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const d = this.def;
        const a = this.ammo[this.current];
        const need = d.magSize - a.inMag;
        const take = Math.min(need, a.reserve);
        a.inMag += take; a.reserve -= take;
      }
    }

    // 切枪(守卫:切枪/装填中延迟生效)
    if (inp.weaponSlot && this.switchT <= 0 && this.reloadT <= 0) {
      const want = SLOT_ORDER[inp.weaponSlot - 1];
      if (want && want !== this.current) {
        this.vms[this.current].group.visible = false;
        this.current = want;
        this.vms[want].group.visible = true;
        this.switchT = 0.32;
        this.slashPhase = 'idle';
        this.ads = false;
      }
    }

    // R 装填
    if (inp.reloadQueued && this.reloadT <= 0 && this.delayT <= 0 && Number.isFinite(this.def.magSize)
      && this.ammo[this.current].inMag < this.def.magSize && this.ammo[this.current].reserve > 0) {
      this.reloadT = this.def.reloadTime;
    }

    // 狙击 ADS(RMB);武士刀 RMB 格挡
    const isKatana = this.current === 'katana';
    this.blocking = isKatana && inp.block && this.blockStamina > 1 && this.slashPhase === 'idle';
    if (!isKatana && inp.block && this.current === 'sniper') this.ads = true;
    else if (!inp.block) this.ads = false;
    if (this.blocking) this.blockStamina = Math.max(0, this.blockStamina - 30 * dt);
    else this.blockStamina = Math.min(100, this.blockStamina + 22 * dt);

    // 开火 / 斩击
    const d = this.def;
    const canFire = this.fireCd <= 0 && this.delayT <= 0 && this.reloadT <= 0 && this.switchT <= 0;
    if (isKatana) this.updateSlash(dt, canFire);
    else if (canFire && (d.auto ? inp.fire : inp.firePressed)) {
      const a = this.ammo[this.current];
      if (a.inMag > 0) {
        a.inMag--;
        this.fireShot();
      } else if (inp.firePressed) {
        this.reloadT = d.reloadTime; // 空仓自动装填
      }
    }

    // Q 抓钩
    if (inp.grappleQueued && this.grappleCd <= 0) this.fireGrapple();

    // 抛壳倒计时
    if (this.ejectPending >= 0) {
      this.ejectPending -= dt;
      if (this.ejectPending < 0) {
        const vm = this.vms[this.current];
        const wp = new THREE.Vector3();
        vm.ejector.getWorldPosition(wp);
        const right = new THREE.Vector3(1, 0.4, 0.2).normalize();
        this.ctx.fx.spawnCasing(wp, right.applyQuaternion(camera.quaternion));
      }
    }

    // ---- viewmodel 姿态 ----
    const vm = this.vms[this.current];
    const bobX = Math.sin(this.gaitPhase) * 0.016;
    const bobY = -Math.abs(Math.cos(this.gaitPhase)) * 0.009;
    const sprintDip = sprinting ? 0.03 : 0;
    const base = new THREE.Vector3(0.28, -0.24 + bobY - sprintDip, -0.5 + this.recoil * 0.6);
    if (this.ads) base.set(0, -0.12, -0.42);
    if (this.switchT > 0) base.y -= this.switchT * 1.2;
    if (this.reloadT > 0) base.y -= 0.1, base.z += 0.05;
    vm.group.position.lerp(base, Math.min(1, dt * 14));
    if (isKatana) {
      this.applyKatanaPose(vm);
    } else {
      vm.group.rotation.x = -this.recoil * 1.2 + (this.reloadT > 0 ? 0.5 : 0) + bobY * 0.8;
      vm.group.rotation.z = Math.sin(this.gaitPhase) * 0.02;
      vm.group.rotation.y = 0.06;
    }
    // 泵/栓动画
    if (vm.pump && this.delayT > 0) vm.pump.position.z = -0.20 + Math.sin(this.delayT * 12) * 0.04;
    if (vm.bolt) vm.bolt.position.x = this.delayT > 0 ? 0.075 : 0.045;
  }

  /** 相机后坐(由 player 施加后清零累计) */
  consumeRecoilCam(): number { const v = this.recoilCam; this.recoilCam = 0; return v; }

  /* ---------------- 开火 ---------------- */
  private fireShot() {
    const d = this.def;
    const { camera, colliders, enemies, em, fx } = this.ctx;
    this.fireCd = d.fireInterval;
    this.delayT = d.delayTime;
    this.recoil = Math.min(1, this.recoil + d.recoilKick * 3);
    this.recoilCam += d.recoilCam;
    this.ejectPending = d.ejectAt;

    const vm = this.vms[this.current];
    const muzzleWorld = new THREE.Vector3();
    vm.muzzle.getWorldPosition(muzzleWorld);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

    // 枪口反馈
    fx.spawnMuzzleShards(muzzleWorld, this.lookDir(), d.id === 'shotgun' ? 12 : 2);
    fx.spawnSmoke(muzzleWorld, this.lookDir());

    const origin = camera.position.clone();
    const baseDir = this.lookDir();
    for (let p = 0; p < d.pellets; p++) {
      const dir = baseDir.clone();
      if (d.spread > 0) {
        dir.x += (Math.random() - 0.5) * d.spread;
        dir.y += (Math.random() - 0.5) * d.spread;
        dir.z += (Math.random() - 0.5) * d.spread * 0.2;
        dir.normalize();
      }
      this.hitscan(origin, dir, d.damage, d.barricadeMul);
    }
    void right; void em;
  }

  private lookDir(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.ctx.camera.quaternion).normalize();
  }

  /* ---------------- 命中判定(共享世界查询) ---------------- */
  hitscan(origin: THREE.Vector3, dir: THREE.Vector3, damage: number, barricadeMul = 1): void {
    const { colliders, enemies, em } = this.ctx;
    const maxDist = 120;
    const wallHit = colliders.raycast(origin, dir, maxDist);
    const wallDist = wallHit ? wallHit.dist : maxDist;

    // 敌人:射线-球(头)/射线-胶囊(身)
    let bestEnemy: Npc | null = null;
    let bestDist = wallDist;
    let head = false;
    for (const e of enemies) {
      if (e.dead) continue;
      // 头
      const headC = e.headWorld();
      const hd = raySphere(origin, dir, headC, e.model.headRadius * 1.15);
      // 身(胶囊:肚中心±0.6)
      const bodyA = new THREE.Vector3(e.pos.x, e.pos.y + 0.5, e.pos.z);
      const bodyB = new THREE.Vector3(e.pos.x, e.pos.y + 1.5, e.pos.z);
      const bd = rayCapsule(origin, dir, bodyA, bodyB, 0.42);
      const hitD = hd !== null && (bd === null || hd <= bd) ? hd : bd;
      const isHead = hitD !== null && hd !== null && hitD === hd;
      if (hitD !== null && hitD < bestDist) {
        bestDist = hitD; bestEnemy = e; head = isHead;
      }
    }
    if (bestEnemy) {
      bestEnemy.takeHit(damage, dir, head, em);
      return;
    }
    // boss(头/身球)
    const boss = this.ctx.boss;
    if (boss && !boss.dead) {
      const headC = boss.pos.clone().add(new THREE.Vector3(0, 2.95, 0));
      const bodyC = boss.pos.clone().add(new THREE.Vector3(0, 1.75, 0));
      const hd = raySphere(origin, dir, headC, 0.7);
      const bd = raySphere(origin, dir, bodyC, 1.12);
      const hitD = hd !== null && (bd === null || hd <= bd) ? hd : bd;
      if (hitD !== null && hitD < bestDist) {
        boss.takeHit(damage, dir, hitD === hd);
        return;
      }
    }
    // 路障
    for (const bar of this.ctx.barricades) {
      if (bar.hp <= 0) continue;
      const h = rayBox(origin, dir, bar.box);
      if (h !== null && h < bestDist) {
        bar.hp -= damage * barricadeMul;
        if (bar.hp <= 0) {
          bar.mesh.visible = false;
          const idx = this.ctx.colliders.boxes.indexOf(bar.box);
          if (idx >= 0) this.ctx.colliders.boxes.splice(idx, 1);
        }
        return;
      }
    }
  }

  /* ---------------- 武士刀 4 阶段 ---------------- */
  private updateSlash(dt: number, canFire: boolean) {
    const inp = this.ctx.input.state;
    if (this.slashPhase === 'idle') {
      if (canFire && (inp.fire || inp.firePressed) && !this.blocking) {
        this.slashPhase = 'windup';
        this.slashT = 0;
        this.slashReverse = !this.slashReverse;
        this.slashHitDone = false;
        this.fireCd = this.def.fireInterval;
      }
      return;
    }
    this.slashT += dt;
    const timings = { windup: 0.13, contact: 0.1, follow: 0.17, recovery: 0.2 };
    if (this.slashPhase === 'windup' && this.slashT >= timings.windup) {
      this.slashPhase = 'contact'; this.slashT = 0;
      // 接触瞬间判定 + 蓝弧(不是 mouse-down)
      this.slashContact();
    } else if (this.slashPhase === 'contact' && this.slashT >= timings.contact) {
      this.slashPhase = 'follow'; this.slashT = 0;
    } else if (this.slashPhase === 'follow' && this.slashT >= timings.follow) {
      this.slashPhase = 'recovery'; this.slashT = 0;
    } else if (this.slashPhase === 'recovery' && this.slashT >= timings.recovery) {
      this.slashPhase = 'idle';
    }
  }

  private slashContact() {
    const { camera, enemies, em, fx, playerPos } = this.ctx;
    const dir = this.lookDir();
    const flat = dir.clone().setY(0).normalize();
    fx.spawnSlashArc(
      new THREE.Vector3(playerPos.x, playerPos.y + 1.3, playerPos.z),
      flat, this.slashReverse,
    );
    for (const e of enemies) {
      if (e.dead) continue;
      const to = new THREE.Vector3().subVectors(e.pos, playerPos);
      const dist = to.length();
      if (dist > 2.4) continue;
      const ang = Math.acos(THREE.MathUtils.clamp(to.clone().setY(0).normalize().dot(flat), -1, 1));
      if (ang > 1.15) continue;
      e.takeHit(this.def.damage, dir, false, em);
    }
    // boss 也在刀刃扇内
    const boss = this.ctx.boss;
    if (boss && !boss.dead) {
      const to = new THREE.Vector3().subVectors(boss.pos, playerPos);
      if (to.length() < 3.4 && to.clone().setY(0).normalize().dot(flat) > 0.35) {
        boss.takeHit(this.def.damage, dir, false);
      }
    }
    // 路障
    for (const bar of this.ctx.barricades) {
      if (bar.hp <= 0) continue;
      const c = new THREE.Vector3().addVectors(bar.box.min, bar.box.max).multiplyScalar(0.5);
      const to = new THREE.Vector3().subVectors(c, playerPos);
      if (to.length() < 2.6 && to.setY(0).normalize().dot(flat) > 0.4) {
        bar.hp -= this.def.damage * this.def.barricadeMul;
        if (bar.hp <= 0) {
          bar.mesh.visible = false;
          const idx = this.ctx.colliders.boxes.indexOf(bar.box);
          if (idx >= 0) this.ctx.colliders.boxes.splice(idx, 1);
        }
      }
    }
    void camera;
  }

  /** viewmodel 的刀姿态(多轴)——由 update 内统一应用 */
  applyKatanaPose(vm: ViewModel) {
    if (this.current !== 'katana') return;
    const rev = this.slashReverse ? 1 : -1;
    const p = this.slashPhase;
    const t = this.slashT;
    if (p === 'idle') {
      vm.group.rotation.set(0.15 * rev, 0.35 * rev, 0.5 * rev);
    } else if (p === 'windup') {
      const k = t / 0.13;
      vm.group.rotation.set((-0.5 - 0.4 * k) * rev, (0.35 + 0.5 * k) * rev, (0.5 + 0.7 * k) * rev);
    } else if (p === 'contact') {
      const k = t / 0.1;
      vm.group.rotation.set((0.6 + 0.4 * k) * rev, (0.85 - 1.5 * k) * rev, (1.2 - 1.6 * k) * rev);
    } else if (p === 'follow') {
      const k = t / 0.17;
      vm.group.rotation.set((1.0 - 0.9 * k) * rev, (-0.65 + 0.7 * k) * rev, (-0.4 + 0.9 * k) * rev);
    } else {
      const k = t / 0.2;
      vm.group.rotation.set((0.1 - 0.05 * k) * rev, (0.05 - 0.3 * k) * rev, (0.5 - 0.4 * k) * rev);
    }
    if (this.blocking) vm.group.rotation.set(0.9, 0.9, 1.35);
  }

  /* ---------------- 抓钩 ---------------- */
  private fireGrapple() {
    const { camera, colliders, enemies, fx, grappleAnchors, playerPos, em } = this.ctx;
    this.grappleCd = 2.8;
    const origin = camera.position.clone();
    const dir = this.lookDir();
    // 优先敌人
    let target: { kind: 'enemy'; e: Npc; d: number } | { kind: 'anchor'; p: THREE.Vector3; d: number } | { kind: 'wall'; p: THREE.Vector3; d: number } | null = null;
    for (const e of enemies) {
      if (e.dead) continue;
      const c = new THREE.Vector3(e.pos.x, e.pos.y + 1.1, e.pos.z);
      const t = raySphere(origin, dir, c, 0.55);
      if (t !== null && t < 45 && (!target || t < target.d)) target = { kind: 'enemy', e, d: t };
    }
    for (const a of grappleAnchors) {
      const t = raySphere(origin, dir, a, 0.7);
      if (t !== null && t < 60 && (!target || t < target.d)) target = { kind: 'anchor', p: a, d: t };
    }
    if (!target) {
      const h = colliders.raycast(origin, dir, 60);
      if (h && h.box.tag !== 'rail') {
        target = { kind: 'wall', p: origin.clone().addScaledVector(dir, h.dist), d: h.dist };
      }
    }
    if (!target) return;
    const hitPos = target.kind === 'enemy'
      ? new THREE.Vector3(target.e.pos.x, target.e.pos.y + 1.1, target.e.pos.z)
      : target.kind === 'anchor' ? target.p : (target as { p: THREE.Vector3 }).p;
    fx.spawnGrappleLine(
      new THREE.Vector3(playerPos.x, playerPos.y + 1.3, playerPos.z),
      hitPos, 0.3,
    );
    if (target.kind === 'enemy') {
      const pull = new THREE.Vector3().subVectors(playerPos, target.e.pos).setY(0).normalize();
      target.e.vel.addScaledVector(pull, 13);
      em.emit('killFeed', { text: '拽倒 +30', points: 30 });
    } else if (target.kind === 'anchor') {
      const pull = new THREE.Vector3().subVectors(hitPos, playerPos).normalize();
      this.pendingPlayerPull = pull;
    }
    void hitPos;
  }

  pendingPlayerPull: THREE.Vector3 | null = null;
  consumePlayerPull(): THREE.Vector3 | null {
    const p = this.pendingPlayerPull;
    this.pendingPlayerPull = null;
    return p;
  }

  get hudAmmo(): { inMag: number; reserve: number } {
    const a = this.ammo[this.current];
    return { inMag: a.inMag, reserve: a.reserve };
  }
  ammoFor(id: WeaponId): AmmoState { return this.ammo[id]; }
  get slashPhaseName(): SlashPhase { return this.slashPhase; }
  get stamina(): number { return this.blockStamina; }
  get scopeT(): number { return this.ads ? 1 : 0; }
}

/* ---------- 数学工具 ---------- */
export function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number | null {
  const oc = new THREE.Vector3().subVectors(o, c);
  const b = oc.dot(d);
  const cc = oc.dot(oc) - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number): number | null {
  // 简化:三球采样(下/中/上)
  const mid = a.clone().lerp(b, 0.5);
  const r1 = raySphere(o, d, a, r);
  const r2 = raySphere(o, d, mid, r);
  const r3 = raySphere(o, d, b, r);
  const cands = [r1, r2, r3].filter((x): x is number => x !== null);
  return cands.length ? Math.min(...cands) : null;
}

export function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: Box): number | null {
  const inv = new THREE.Vector3(1 / (d.x || 1e-9), 1 / (d.y || 1e-9), 1 / (d.z || 1e-9));
  let tmin = 0, tmax = Infinity;
  for (let ax = 0; ax < 3; ax++) {
    const oo = ax === 0 ? o.x : ax === 1 ? o.y : o.z;
    const ii = ax === 0 ? inv.x : ax === 1 ? inv.y : inv.z;
    const mn = ax === 0 ? b.min.x : ax === 1 ? b.min.y : b.min.z;
    const mx = ax === 0 ? b.max.x : ax === 1 ? b.max.y : b.max.z;
    let t1 = (mn - oo) * ii, t2 = (mx - oo) * ii;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export const INK = PAL.ink;
