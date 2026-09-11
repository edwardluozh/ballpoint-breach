import * as THREE from 'three';
import { Emitter } from '../core/events';
import { PAL } from '../render/palette';
import type { ColliderWorld } from '../world/colliders';
import type { GameEvents } from './npc';

/**
 * THE DOODLER:纸白大圆身 + 石墨 4-5 尖平顶皇冠 + 红怒脸 + 奶油色铅笔横持。
 * FSM:telegraph → charge / sweep / slam / throw / summon;受击累积 → stagger;
 * 半血以下二阶段(更快)。死亡 → victory + 大团死亡墨水(经事件)。
 */

type Phase = 'enter' | 'idle' | 'telegraph' | 'charge' | 'sweep' | 'slam' | 'throw' | 'summon' | 'stagger' | 'dead';

export class Boss {
  group = new THREE.Group();
  pos = new THREE.Vector3(0, 0, -40);
  vel = new THREE.Vector3();
  yaw = 0;
  hpMax = 1400;
  hp = 1400;
  dead = false;
  phase: Phase = 'enter';
  private timer = 1.2;
  private nextAttack = 'charge' as 'charge' | 'sweep' | 'slam' | 'throw' | 'summon';
  private staggerAcc = 0;
  private gait = 0;
  private pencil!: THREE.Group;
  private bodyRoot!: THREE.Group;
  private chargeDir = new THREE.Vector3();

  constructor(private em: Emitter<GameEvents>, private colliders: ColliderWorld) {
    this.build();
  }

  get phase2(): boolean { return this.hp < this.hpMax * 0.5; }
  private get speedMul(): number { return this.phase2 ? 1.4 : 1; }
  private get cdMul(): number { return this.phase2 ? 0.68 : 1; }

  private build() {
    const g = this.group;
    const body = this.bodyRoot = new THREE.Group();
    g.add(body);
    const matRed = new THREE.LineBasicMaterial({ color: PAL.red, transparent: true, opacity: 0.95 });
    const matInk = new THREE.LineBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.9 });
    const matGraphite = new THREE.LineBasicMaterial({ color: PAL.graphite, transparent: true, opacity: 0.95 });
    const matPaper = new THREE.MeshBasicMaterial({ color: PAL.paperWhite, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

    const fan = (pts: THREE.Vector3[], mat: THREE.Material, z = -0.01) => {
      const verts: number[] = [];
      for (let i = 1; i < pts.length - 1; i++) {
        verts.push(0, 0, z, pts[i].x, pts[i].y, z, pts[i + 1].x, pts[i + 1].y, z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, mat);
    };

    // 大圆身(总高 ~3.6:0.9 腿 + 2.1 肚 + 0.6 头部融合)
    const bellyC = new THREE.Vector3(0, 1.75, 0);
    const bellyPts: THREE.Vector3[] = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const r = 1.05 * (1 + Math.sin(i * 2.7) * 0.05);
      bellyPts.push(new THREE.Vector3(bellyC.x + Math.cos(a) * r * 0.92, bellyC.y + Math.sin(a) * r, 0));
    }
    body.add(fan(bellyPts, matPaper));
    body.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(bellyPts), matRed));
    // 头部融合圆(上身)
    const headC = new THREE.Vector3(0, 2.95, 0);
    const headPts: THREE.Vector3[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      headPts.push(new THREE.Vector3(headC.x + Math.cos(a) * 0.62, headC.y + Math.sin(a) * 0.6, 0));
    }
    body.add(fan(headPts, matPaper));
    body.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(headPts), matRed));

    // 石墨 4-5 尖平顶皇冠
    const crownPts: THREE.Vector3[] = [];
    const spikes = 5;
    for (let i = 0; i <= spikes * 2; i++) {
      const t = i / (spikes * 2);
      const x = -0.55 + t * 1.1;
      const y = (i % 2 === 0) ? 3.62 + 0.12 : 3.78 + 0.1;
      crownPts.push(new THREE.Vector3(x, y, 0));
    }
    body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.55, 3.55, 0), new THREE.Vector3(0.55, 3.55, 0)]), matGraphite));
    body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(crownPts), matGraphite));
    body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(crownPts.map((p) => p.clone().add(new THREE.Vector3(0, -0.22, 0)))), matGraphite));

    // 红怒脸
    const faceY = 2.95;
    for (const s of [-1, 1]) {
      // 粗红怒眉(V 形)
      body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(s * 0.12, faceY + 0.22, 0.02),
        new THREE.Vector3(s * 0.4, faceY + 0.3, 0.02)]), matRed));
      body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(s * 0.12, faceY + 0.19, 0.02),
        new THREE.Vector3(s * 0.4, faceY + 0.27, 0.02)]), matRed));
      // 红眼
      body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(s * 0.24, faceY + 0.06, 0.02),
        new THREE.Vector3(s * 0.34, faceY + 0.06, 0.02)]), matRed));
      body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(s * 0.24, faceY + 0.02, 0.02),
        new THREE.Vector3(s * 0.34, faceY + 0.02, 0.02)]), matRed));
    }
    // 怒嘴(下弯)
    body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.22, faceY - 0.28, 0.02),
      new THREE.Vector3(0, faceY - 0.18, 0.02),
      new THREE.Vector3(0.22, faceY - 0.28, 0.02)]), matRed));

    // 腿(两条粗短线)
    for (const s of [-1, 1]) {
      body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(s * 0.35, 0.9, 0), new THREE.Vector3(s * 0.4, 0.05, 0)]), matRed));
    }
    // 手臂(两段)
    for (const s of [-1, 1]) {
      body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(s * 0.95, 2.1, 0), new THREE.Vector3(s * 1.25, 1.7, 0), new THREE.Vector3(s * 0.75, 1.45, 0.1)]), matRed));
    }

    // 奶油色铅笔横持胸前(短,两端可见)
    const pencil = this.pencil = new THREE.Group();
    const pencilLen = 1.35;
    const pw = 0.09;
    const pmat = new THREE.MeshBasicMaterial({ color: 0xf3e6c2, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const quad = [
      new THREE.Vector3(-pencilLen / 2, -pw, 0), new THREE.Vector3(pencilLen / 2, -pw, 0),
      new THREE.Vector3(pencilLen / 2, pw, 0), new THREE.Vector3(-pencilLen / 2, pw, 0),
    ];
    pencil.add(fan(quad, pmat, 0));
    pencil.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(quad), matInk));
    // 笔尖(木色三角+深尖)
    pencil.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(pencilLen / 2, -pw, 0), new THREE.Vector3(pencilLen / 2 + 0.14, 0, 0), new THREE.Vector3(pencilLen / 2, pw, 0)]), matInk));
    pencil.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(pencilLen / 2 + 0.08, -0.03, 0.001), new THREE.Vector3(pencilLen / 2 + 0.14, 0, 0.001),
      new THREE.Vector3(pencilLen / 2 + 0.08, 0.03, 0.001)]), matGraphite));
    // 笔擦
    pencil.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-pencilLen / 2, -pw, 0), new THREE.Vector3(-pencilLen / 2 - 0.1, -pw * 0.8, 0),
      new THREE.Vector3(-pencilLen / 2 - 0.1, pw * 0.8, 0), new THREE.Vector3(-pencilLen / 2, pw, 0)]), matRed));
    pencil.position.set(0, 1.5, 0.55);
    body.add(pencil);
  }

  takeHit(dmg: number, dir: THREE.Vector3, head: boolean): boolean {
    if (this.dead) return false;
    this.hp -= head ? dmg * 1.6 : dmg;
    this.staggerAcc += head ? dmg * 0.1 : dmg * 0.05;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.phase = 'dead';
      return true;
    }
    if (this.staggerAcc > 130 && this.phase !== 'charge') {
      this.staggerAcc = 0;
      this.phase = 'stagger';
      this.timer = 0.8;
      this.vel.addScaledVector(dir.clone().setY(0).normalize(), 2.5);
    }
    return false;
  }

  update(dt: number, ctx: {
    playerPos: THREE.Vector3; playerEye: THREE.Vector3;
    onProjectile: (from: THREE.Vector3, to: THREE.Vector3, dmg: number) => void;
    onSummon: () => void;
  }) {
    if (this.dead) return;
    const toPlayer = new THREE.Vector3().subVectors(ctx.playerPos, this.pos);
    const dist = toPlayer.length();
    const flat = toPlayer.clone().setY(0).normalize();

    this.timer -= dt;
    switch (this.phase) {
      case 'enter':
        if (this.timer <= 0) { this.phase = 'idle'; this.timer = 0.6; }
        break;
      case 'idle': {
        this.yaw = Math.atan2(flat.x, flat.z);
        // 缓慢逼近
        if (dist > 6) this.pos.addScaledVector(flat, 2.1 * this.speedMul * dt);
        if (this.timer <= 0) {
          this.phase = 'telegraph';
          this.timer = 0.55 * this.cdMul;
          // 选招
          this.nextAttack = dist < 3.2 ? (Math.sin(this.gait) > 0 ? 'sweep' : 'slam')
            : dist > 14 ? 'throw'
              : (['charge', 'throw', 'summon', 'charge'] as const)[Math.floor(this.hp / 200) % 4];
        }
        break;
      }
      case 'telegraph':
        // 前倾蓄力姿势
        if (this.timer <= 0) {
          this.phase = this.nextAttack;
          this.timer = this.nextAttack === 'charge' ? 1.1
            : this.nextAttack === 'sweep' ? 0.45
              : this.nextAttack === 'slam' ? 0.6
                : this.nextAttack === 'throw' ? 0.4 : 0.5;
          if (this.nextAttack === 'charge') this.chargeDir.copy(flat);
        }
        break;
      case 'charge':
        this.pos.addScaledVector(this.chargeDir, 13 * this.speedMul * dt);
        this.vel.copy(this.chargeDir).multiplyScalar(0.5);
        if (dist < 2.4) {
          ctx.onProjectile(this.pos.clone().setY(1.5), ctx.playerEye.clone(), 26); // 冲撞伤害复用命中
        }
        if (this.timer <= 0) { this.phase = 'idle'; this.timer = 1.1 * this.cdMul; }
        break;
      case 'sweep':
        if (this.timer <= 0) {
          if (dist < 3.6) ctx.onProjectile(this.pos.clone().setY(1.5), ctx.playerEye.clone(), 22);
          this.phase = 'idle'; this.timer = 1.2 * this.cdMul;
        }
        break;
      case 'slam':
        if (this.timer <= 0) {
          if (dist < 4.5) ctx.onProjectile(this.pos.clone().setY(2.5), ctx.playerEye.clone(), 30);
          this.phase = 'idle'; this.timer = 1.3 * this.cdMul;
        }
        break;
      case 'throw':
        if (this.timer <= 0) {
          ctx.onProjectile(this.pos.clone().setY(2.2), ctx.playerEye.clone(), 18);
          this.phase = 'idle'; this.timer = 1.0 * this.cdMul;
        }
        break;
      case 'summon':
        if (this.timer <= 0) {
          ctx.onSummon();
          this.phase = 'idle'; this.timer = 1.6 * this.cdMul;
        }
        break;
      case 'stagger':
        if (this.timer <= 0) { this.phase = 'idle'; this.timer = 0.5; }
        break;
    }

    // 击退速度
    this.pos.addScaledVector(this.vel, dt);
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 5));
    // 支撑
    const gh = this.colliders.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.4, 0.5);
    this.pos.y = gh;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -34, 34);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -44, 30);

    // 动画
    this.gait += dt * 3;
    const walkBob = this.phase === 'charge' ? 0.12 : 0.05;
    this.bodyRoot.position.y = Math.abs(Math.sin(this.gait)) * walkBob;
    const lean = this.phase === 'telegraph' ? 0.25 : this.phase === 'charge' ? 0.35
      : this.phase === 'stagger' ? -0.2 : 0.05;
    this.bodyRoot.rotation.x = lean + (this.phase === 'stagger' ? Math.sin(this.timer * 30) * 0.1 : 0);
    // 铅笔姿态
    if (this.phase === 'sweep') this.pencil.rotation.z = Math.sin(this.timer * 14) * 1.4;
    else if (this.phase === 'slam') this.pencil.position.y = 1.5 + Math.sin(this.timer * 5) * 0.8;
    else this.pencil.rotation.z = Math.sin(this.gait * 0.5) * 0.15;

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }
}
