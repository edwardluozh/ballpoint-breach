import * as THREE from 'three';
import { Rng } from '../core/rng';
import { PAL } from '../render/palette';

/**
 * 死亡墨水:红圆珠笔,不是 gore 也不是通用粒子。
 * 流程:整体红剪影 0.10s → 识别性碎块(头/躯干/四肢/武器/笔触/墨滴)顺击向分离
 * → 地面/墙面持久沉积(≈60s),多确定性变体。
 * 全部有界池化。
 */

const matRedFill = new THREE.MeshBasicMaterial({
  color: PAL.red, transparent: true, opacity: 0.42, side: THREE.DoubleSide,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
const matRedFill2 = new THREE.MeshBasicMaterial({
  color: 0xb02741, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
});
const matRedLine = new THREE.LineBasicMaterial({ color: PAL.red, transparent: true, opacity: 0.8 });
const matRedLineSoft = new THREE.LineBasicMaterial({ color: PAL.red, transparent: true, opacity: 0.4 });

/** 不规则"多孔主池"多边形(非圆、非同心、有干刷缺口) */
function blobPoly(rng: Rng, r: number, squash: number, lobes = 7): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const n = 16 + Math.floor(rng.next() * 5);
  const notch = 1 + Math.floor(rng.next() * 2);   // 1-2 处凹陷(干刷洞)
  const notchAt = rng.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let rr = r * (0.68 + rng.next() * 0.5);
    if (notch > 0 && Math.abs(a - notchAt) < 0.5) rr *= 0.42;          // 缺口
    if (notch > 1 && Math.abs(a - notchAt - Math.PI) < 0.35) rr *= 0.6;
    pts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr * squash, 0));
  }
  return pts;
}

function fanMesh(pts: THREE.Vector3[], mat: THREE.Material): THREE.Mesh {
  const verts: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    verts.push(0, 0, 0, pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

function outlineLoop(pts: THREE.Vector3[], mat: THREE.LineBasicMaterial): THREE.LineLoop {
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
}

/* ================= 地面血渍 ================= */
/** 主池 + 偏移回声 + ≥3 方向拖痕 + ~7 卫星滴;沿 dir 拉伸(方向性) */
function buildFloorDecal(dirFlat: THREE.Vector3, seed: number): THREE.Group {
  const rng = new Rng(9000 + seed * 131);
  const g = new THREE.Group();
  const dir = dirFlat.clone().normalize();
  const along = new THREE.Vector3(dir.x, dir.y, 0);      // decal 局部 x 对齐击向
  const perp = new THREE.Vector3(-along.y, along.x, 0);
  const place = (p: THREE.Vector3) => new THREE.Vector3(p.x * 1.35 + 0, p.y, 0); // 本地拉伸

  // 主池(多孔)
  const mainPts = blobPoly(rng, 0.5, 0.72).map((p) =>
    new THREE.Vector3(p.x * 1.4, p.y * 0.8, 0));
  g.add(fanMesh(mainPts, matRedFill));
  g.add(outlineLoop(mainPts, matRedLineSoft));
  // 偏移回声(小,错开)
  const echoPts = blobPoly(rng, 0.26, 0.8).map((p) => p.clone().add(new THREE.Vector3(0.55 + rng.next() * 0.3, -0.3 - rng.next() * 0.2, 0)));
  g.add(fanMesh(echoPts, matRedFill2));
  // ≥3 方向拖痕(沿击向的更长)
  const streakCount = 3 + Math.floor(rng.next() * 2);
  for (let i = 0; i < streakCount; i++) {
    const ang = (i / streakCount) * Math.PI * 2 + rng.next() * 0.8;
    const len = (0.35 + rng.next() * 0.5) * (Math.abs(Math.cos(ang - Math.PI)) * 0.8 + 0.5);
    const wid = 0.05 + rng.next() * 0.05;
    const p0 = new THREE.Vector3(Math.cos(ang) * 0.3, Math.sin(ang) * 0.2, 0);
    const p1 = p0.clone().add(new THREE.Vector3(Math.cos(ang) * len, Math.sin(ang) * len * 0.6, 0));
    const quad = [
      p0.clone().addScaledVector(new THREE.Vector3(0, wid, 0), 1),
      p0.clone().addScaledVector(new THREE.Vector3(0, -wid, 0), 1),
      p1.clone().addScaledVector(new THREE.Vector3(0, -wid * 0.4, 0), 1),
      p1.clone().addScaledVector(new THREE.Vector3(0, wid * 0.4, 0), 1),
    ];
    g.add(fanMesh(quad, matRedFill2));
    g.add(outlineLoop(quad, matRedLineSoft));
  }
  // ~7 卫星滴(大小不一)
  const drops = 6 + Math.floor(rng.next() * 3);
  for (let i = 0; i < drops; i++) {
    const ang = rng.next() * Math.PI * 2;
    const d = 0.5 + rng.next() * 0.85;
    const r = 0.015 + rng.next() * 0.05;
    const c = new THREE.Vector3(Math.cos(ang) * d, Math.sin(ang) * d * 0.6, 0);
    const pts = blobPoly(rng, r, 0.8, 6);
    const grp = new THREE.Group();
    grp.position.copy(c);
    grp.add(fanMesh(pts, i % 2 ? matRedFill2 : matRedFill));
    g.add(grp);
  }
  void perp; void place;
  g.rotation.x = -Math.PI / 2;   // 贴地
  return g;
}

/* ================= 墙面血渍 ================= */
/** 2 撕裂撞击体 + ≥3 不等长重力垂滴 + 中/针状脱离滴 */
function buildWallDecal(seed: number): THREE.Group {
  const rng = new Rng(17000 + seed * 173);
  const g = new THREE.Group();
  // 两个撕裂撞击体(不等大,上下错开)
  for (const [r, off] of [[0.42, -0.1], [0.2, 0.42]] as const) {
    const pts = blobPoly(rng, r, 1.1).map((p) => p.clone().add(new THREE.Vector3(rng.signed() * 0.15, off, 0)));
    g.add(fanMesh(pts, matRedFill));
    g.add(outlineLoop(pts, matRedLineSoft));
  }
  // ≥3 垂滴(不等长,弯曲,末端变宽)
  const drips = 3 + Math.floor(rng.next() * 2);
  for (let i = 0; i < drips; i++) {
    const x = rng.signed() * 0.5;
    const len = 0.25 + rng.next() * 0.85;
    const wid = 0.03 + rng.next() * 0.04;
    const bend = rng.signed() * 0.12;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      pts.push(new THREE.Vector3(x + bend * t * t, -0.1 - t * len, 0));
    }
    for (let k = 5; k >= 0; k--) {
      const t = k / 5;
      const w = wid * (0.5 + Math.sin((1 - t) * 0.7) * 1.1);
      pts.push(new THREE.Vector3(x + bend * t * t + w, -0.1 - t * len, 0));
    }
    g.add(fanMesh(pts, matRedFill2));
    g.add(outlineLoop(pts, matRedLineSoft));
  }
  // 脱离滴(中/针)
  for (let i = 0; i < 6 + Math.floor(rng.next() * 4); i++) {
    const r = rng.next() < 0.4 ? 0.012 : 0.03 + rng.next() * 0.03;
    const c = new THREE.Vector3(rng.signed() * 0.8, -0.9 - rng.next() * 0.8, 0);
    const grp = new THREE.Group();
    grp.position.copy(c);
    grp.add(fanMesh(blobPoly(rng, r, 1, 5), matRedFill2));
    g.add(grp);
  }
  return g;
}

/* ================= 飞散碎片 ================= */
interface Frag {
  alive: boolean;
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number; maxLife: number;
  landed: boolean;
}

/* ================= 总系统 ================= */
export class DeathInkSystem {
  private decals: { obj: THREE.Group; life: number }[] = [];
  private maxDecals = 26;
  private frags: Frag[] = [];
  private group = new THREE.Group();
  private silhouettes: { obj: THREE.Group; life: number }[] = [];

  constructor() {
    for (let i = 0; i < 72; i++) {
      const holder = new THREE.Object3D();
      holder.visible = false;
      this.group.add(holder);
      this.frags.push({ alive: false, obj: holder, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, maxLife: 1, landed: false });
    }
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Group();
      s.visible = false;
      this.group.add(s);
      this.silhouettes.push({ obj: s, life: 0 });
    }
  }

  get object(): THREE.Group { return this.group; }

  /** 死亡触发:剪影 + 碎片 + 沉积。pos = 敌脚底;dir = 击向;wallHit = 背后近墙信息 */
  trigger(pos: THREE.Vector3, dir: THREE.Vector3, seed: number,
          groundAt: (x: number, z: number) => number,
          wallNormal: THREE.Vector3 | null) {
    const rng = new Rng(31000 + seed * 977);
    // ---- 红剪影(0.10s):头圈+肚圈+腿线+臂线的粗红线组 ----
    const sil = this.silhouettes.find((s) => s.life <= 0);
    if (sil) {
      sil.obj.clear();
      const thick = new THREE.LineBasicMaterial({ color: PAL.red, transparent: true, opacity: 0.95, linewidth: 2 });
      const c1 = new THREE.Vector3(0, 1.86, 0), c2 = new THREE.Vector3(0, 1.28, 0);
      sil.obj.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2;
          return new THREE.Vector3(c1.x + Math.cos(a) * 0.33, c1.y + Math.sin(a) * 0.33, 0);
        })), thick));
      sil.obj.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2;
          return new THREE.Vector3(c2.x + Math.cos(a) * 0.385, c2.y + Math.sin(a) * 0.42, 0);
        })), thick));
      for (const s of [-1, 1]) {
        sil.obj.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(s * 0.13, 0.95, 0), new THREE.Vector3(s * 0.16, 0.06, 0)]), thick));
        sil.obj.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(s * 0.3, 1.42, 0), new THREE.Vector3(s * 0.52, 1.3, 0), new THREE.Vector3(s * 0.4, 1.0, 0)]), thick));
      }
      sil.obj.position.copy(pos);
      sil.obj.rotation.y = rng.next() * Math.PI * 2;
      sil.obj.visible = true;
      sil.life = 0.10;
    }

    // ---- 碎片:头/躯干/2肢/武器/2笔触/6-10 墨滴 ----
    const spawnFrag = (build: (o: THREE.Group) => void, speed: number, spread: number, life = 0.9) => {
      const f = this.frags.find((x) => !x.alive);
      if (!f) return;
      f.alive = true; f.landed = false;
      f.life = f.maxLife = life * (0.7 + rng.next() * 0.6);
      f.obj.clear();
      build(f.obj as THREE.Group);
      f.obj.visible = true;
      f.obj.position.set(pos.x, pos.y + 0.9 + rng.next() * 1.1, pos.z);
      f.vel.copy(dir).multiplyScalar(speed)
        .add(new THREE.Vector3(rng.signed() * spread, 1.5 + rng.next() * 2.4, rng.signed() * spread));
      f.spin.set(rng.signed() * 9, rng.signed() * 9, rng.signed() * 9);
    };
    // 头(红圈)
    spawnFrag((o) => {
      o.add(outlineLoop(Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * 0.2, Math.sin(a) * 0.19, 0);
      }), matRedLine));
    }, 5.5, 1.2, 1.1);
    // 躯干(红不规则块)
    spawnFrag((o) => { o.add(fanMesh(blobPoly(rng, 0.24, 0.8), matRedFill)); o.add(outlineLoop(blobPoly(rng, 0.24, 0.8), matRedLine)); }, 4.2, 1.5, 1.0);
    // 两肢(短线)
    for (const s of [-1, 1]) {
      spawnFrag((o) => {
        o.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, -0.28, 0), new THREE.Vector3(rng.signed() * 0.1, 0.28, 0)]), matRedLine));
      }, 4.8, 1.8, 0.8);
    }
    // 武器(小矩形)
    spawnFrag((o) => {
      const q = [new THREE.Vector3(-0.03, -0.3, 0), new THREE.Vector3(0.03, -0.3, 0), new THREE.Vector3(0.03, 0.3, 0), new THREE.Vector3(-0.03, 0.3, 0)];
      o.add(outlineLoop(q, matRedLine));
    }, 6, 2.2, 0.9);
    // 2 笔触(弧线)
    for (let i = 0; i < 2; i++) {
      spawnFrag((o) => {
        const pts = Array.from({ length: 5 }, (_, k) => new THREE.Vector3(k * 0.09 - 0.18, Math.sin(k * 1.8) * 0.06, 0));
        o.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), matRedLineSoft));
      }, 5.5, 2.5, 0.7);
    }
    // 墨滴 6-10
    const drops = 6 + Math.floor(rng.next() * 5);
    for (let i = 0; i < drops; i++) {
      spawnFrag((o) => {
        const r = 0.015 + rng.next() * 0.03;
        o.add(fanMesh(blobPoly(rng, r, 1, 5), matRedFill2));
      }, 3.5 + rng.next() * 3, 2.8, 0.6);
    }

    // ---- 持久沉积 ----
    // 地面
    this.addDecal(buildFloorDecal(new THREE.Vector3(dir.x, 0, dir.z), seed),
      new THREE.Vector3(pos.x + dir.x * 0.8, groundAt(pos.x, pos.z) + 0.02, pos.z + dir.z * 0.8),
      rng.next() * Math.PI * 2);
    // 背墙
    if (wallNormal) {
      const wp = pos.clone().addScaledVector(wallNormal, -0.35);
      wp.y = pos.y + 1.3;
      const decal = buildWallDecal(seed + 3);
      // 面向:贴合墙面(decal 平面 xy,法线 +z → 朝墙外)
      this.addDecal(decal, wp.clone().addScaledVector(wallNormal, 0.06), Math.atan2(wallNormal.x, wallNormal.z));
    }
  }

  private addDecal(obj: THREE.Group, pos: THREE.Vector3, yaw: number) {
    obj.position.copy(pos);
    obj.rotation.y = yaw;
    // 墙面 decal 局部 y 朝世界下:已有内部 -y 垂滴;地面 decal 是 xz 平面
    this.group.add(obj);
    this.decals.push({ obj, life: 62 });
    while (this.decals.length > this.maxDecals) {
      const old = this.decals.shift()!;
      this.group.remove(old.obj);
    }
  }

  update(dt: number, groundAt: (x: number, z: number) => number) {
    // 剪影
    for (const s of this.silhouettes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.obj.visible = false; }
    }
    // 碎片
    for (const f of this.frags) {
      if (!f.alive) continue;
      f.life -= dt;
      if (f.life <= 0) { f.alive = false; f.obj.visible = false; continue; }
      const fade = Math.min(1, f.life / (f.maxLife * 0.4));
      f.obj.scale.setScalar(Math.max(0.05, fade));
      if (!f.landed) {
        f.vel.y -= 16 * dt;
        f.obj.position.addScaledVector(f.vel, dt);
        f.obj.rotation.x += f.spin.x * dt;
        f.obj.rotation.y += f.spin.y * dt;
        f.obj.rotation.z += f.spin.z * dt;
        const gy = groundAt(f.obj.position.x, f.obj.position.z) + 0.02;
        if (f.obj.position.y <= gy) {
          if (Math.abs(f.vel.y) > 2.4) { f.obj.position.y = gy; f.vel.y = -f.vel.y * 0.3; f.vel.x *= 0.5; f.vel.z *= 0.5; f.spin.multiplyScalar(0.4); }
          else { f.obj.position.y = gy; f.landed = true; }
        }
      }
    }
    // 沉积寿命
    for (const d of this.decals) d.life -= dt;
    while (this.decals.length && this.decals[0].life <= 0) {
      const old = this.decals.shift()!;
      this.group.remove(old.obj);
    }
  }
}
