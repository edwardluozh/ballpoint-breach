import * as THREE from 'three';
import { PAL } from '../render/palette';
import { Rng } from '../core/rng';

/**
 * 有界瞬态效果池:弹壳(重力/翻滚/落地反弹/退役)、枪口橙碎片、纸白烟涂鸦、
 * 武士刀蓝墨弧、抓钩蓝线。全部预分配,无运行时增长。
 */

interface Casing {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  life: number;
  mesh: THREE.LineSegments;
}
interface FxItem {
  alive: boolean;
  life: number; maxLife: number;
  obj: THREE.Object3D;
  vel?: THREE.Vector3;
}

const rng = new Rng(777);

export class FxPool {
  private casings: Casing[] = [];
  private items: FxItem[] = [];
  private group = new THREE.Group();

  constructor(casingMax = 48, itemMax = 96) {
    // 弹壳:更可见的立体外壳(放大3倍,金色)
    for (let i = 0; i < casingMax; i++) {
      const g = new THREE.BufferGeometry();
      const s = 0.026;
      const h = 0.045;
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        -s, -h, 0, s, -h, 0,  s, -h, 0, s, h, 0,  s, h, 0, -s, h, 0,  -s, h, 0, -s, -h, 0,
        -s, -h, 0.01, s, -h, 0.01,  s, -h, 0.01, s, h, 0.01,  s, h, 0.01, -s, h, 0.01,  -s, h, 0.01, -s, -h, 0.01,
        -s, -h, 0, -s, -h, 0.01,  s, -h, 0, s, -h, 0.01,  s, h, 0, s, h, 0.01,  -s, h, 0, -s, h, 0.01,
      ], 3));
      const mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xd4a857, transparent: true, opacity: 0.95 }));
      mesh.visible = false;
      this.group.add(mesh);
      this.casings.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Euler(), life: 0, mesh });
    }
    for (let i = 0; i < itemMax; i++) {
      const holder = new THREE.Object3D();
      holder.visible = false;
      this.group.add(holder);
      this.items.push({ alive: false, life: 0, maxLife: 1, obj: holder });
    }
  }

  get object(): THREE.Group { return this.group; }

  /* ---------- 弹壳 ---------- */
  spawnCasing(pos: THREE.Vector3, dir: THREE.Vector3) {
    const c = this.casings.find((x) => !x.alive);
    if (!c) return;
    c.alive = true;
    c.pos.copy(pos);
    c.vel.copy(dir).multiplyScalar(2.4 + rng.next() * 1.6);
    c.vel.y = 2.2 + rng.next() * 1.4;
    c.spin.set(rng.range(-18, 18), rng.range(-14, 14), rng.range(-18, 18));
    c.rot.set(rng.next() * 6, rng.next() * 6, rng.next() * 6);
    c.life = 3.5;
    c.mesh.visible = true;
  }

  /* ---------- 枪口橙碎片(步枪2 / 霰弹12) ---------- */
  spawnMuzzleShards(pos: THREE.Vector3, dir: THREE.Vector3, count: number) {
    for (let i = 0; i < count; i++) {
      const it = this.acquireItem(0.09, (o) => {
        o.clear();
        const len = 0.05 + rng.next() * 0.07;
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, len),
        ]);
        o.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd7a049, transparent: true, opacity: 0.95 })));
      });
      if (!it) return;
      it.obj.position.copy(pos);
      it.obj.lookAt(pos.clone().add(dir));
      it.obj.rotateZ(rng.next() * Math.PI);
      it.obj.scale.setScalar(0.6 + rng.next() * 0.8);
    }
  }

  /* ---------- 纸白烟涂鸦(2 缕) ---------- */
  spawnSmoke(pos: THREE.Vector3, dir: THREE.Vector3) {
    for (let i = 0; i < 2; i++) {
      const it = this.acquireItem(0.5 + i * 0.15, (o) => {
        o.clear();
        const pts: THREE.Vector3[] = [];
        let p = new THREE.Vector3();
        for (let k = 0; k < 5; k++) {
          p = p.clone().add(new THREE.Vector3(rng.signed() * 0.03, 0.02 + rng.next() * 0.03, rng.signed() * 0.03));
          pts.push(p);
        }
        o.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: PAL.paperWhite, transparent: true, opacity: 0.75 })));
      });
      if (!it) return;
      it.obj.position.copy(pos).addScaledVector(dir, 0.06 + i * 0.1);
      it.vel = dir.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.4, 0));
    }
  }

  /* ---------- 武士刀蓝墨弧(接触处,断续) ---------- */
  spawnSlashArc(origin: THREE.Vector3, facing: THREE.Vector3, reverse: boolean) {
    const it = this.acquireItem(0.22, (o) => {
      o.clear();
      const pts: THREE.Vector3[] = [];
      const swing = reverse ? 1 : -1;
      for (let k = 0; k <= 7; k++) {
        const a = (-0.9 + (k / 7) * 1.8) * swing;
        const r = 1.15 + Math.sin((k / 7) * Math.PI) * 0.25;
        const local = new THREE.Vector3(Math.sin(a) * r, 0.15 + Math.cos(a) * 0.55, -Math.cos(a) * r * 0.5);
        pts.push(local);
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      o.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.85 })));
    });
    if (!it) return;
    it.obj.position.copy(origin);
    it.obj.lookAt(origin.clone().add(facing));
  }

  /* ---------- 抓钩蓝线 ---------- */
  spawnGrappleLine(from: THREE.Vector3, to: THREE.Vector3, holdTime = 0.25) {
    const it = this.acquireItem(holdTime, (o) => {
      o.clear();
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), to.clone().sub(from),
      ]);
      o.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.8 })));
    });
    if (!it) return;
    it.obj.position.copy(from);
  }

  private acquireItem(maxLife: number, build: (o: THREE.Object3D) => void): FxItem | null {
    const it = this.items.find((x) => !x.alive);
    if (!it) return null;
    it.alive = true;
    it.life = it.maxLife = maxLife;
    it.vel = undefined;
    build(it.obj);
    it.obj.visible = true;
    return it;
  }

  update(dt: number, groundAt: (x: number, z: number) => number) {
    for (const c of this.casings) {
      if (!c.alive) continue;
      c.life -= dt;
      if (c.life <= 0) { c.alive = false; c.mesh.visible = false; continue; }
      c.vel.y -= 12 * dt;
      c.pos.addScaledVector(c.vel, dt);
      const gy = groundAt(c.pos.x, c.pos.z);
      if (c.pos.y < gy + 0.008) {
        c.pos.y = gy + 0.008;
        if (Math.abs(c.vel.y) > 0.8) {
          c.vel.y = -c.vel.y * 0.35;         // 小弹跳
          c.vel.x *= 0.5; c.vel.z *= 0.5;
          c.spin.multiplyScalar(0.4);
        } else {
          c.vel.set(0, 0, 0); c.spin.set(0, 0, 0);
        }
      }
      c.rot.x += c.spin.x * dt; c.rot.y += c.spin.y * dt; c.rot.z += c.spin.z * dt;
      c.mesh.position.copy(c.pos);
      c.mesh.rotation.copy(c.rot);
    }
    for (const it of this.items) {
      if (!it.alive) continue;
      it.life -= dt;
      if (it.life <= 0) { it.alive = false; it.obj.visible = false; it.obj.clear?.(); continue; }
      if (it.vel) it.obj.position.addScaledVector(it.vel, dt);
    }
  }
}
