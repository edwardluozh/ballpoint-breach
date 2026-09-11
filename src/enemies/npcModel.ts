import * as THREE from 'three';
import { Rng } from '../core/rng';
import { PAL } from '../render/palette';

/**
 * 普通 NPC:纸白红轮廓"雪人"。
 * 尺寸红线(契约 §I):总高 2.17 = 3.4×头径 0.64;肚宽 0.74-0.78;腿段 ~0.90。
 * ≥8 个确定性外观变体;职业共享同一视觉语言。
 *
 * 性能:静态笔画合并为 1 LineSegments + 1 Mesh;两腿各 1+1;武器 1+1
 * → 每具 ~8 个渲染对象(合批前 ~45),20 敌压力场景 draw call 大幅下降。
 */

export type NpcClass = 'grunt' | 'rusher' | 'heavy' | 'marksman';

export interface NpcModelParts {
  group: THREE.Group;
  root: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  weapon: THREE.Group;
  headCenter: THREE.Vector3;
  headRadius: number;
  bellyCenter: THREE.Vector3;
}

/* ---------- 共享材质(顶点色承担红/墨/石墨差异) ---------- */
const matLines = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
const matPaper = new THREE.MeshBasicMaterial({ color: PAL.paperWhite, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

const C_RED = new THREE.Color(PAL.red);
const C_INK = new THREE.Color(PAL.ink);
const C_GRAPHITE = new THREE.Color(PAL.graphite);
const C_RED_FILL = new THREE.Color(0xd05a72);

/** 线段/三角收集器 */
class Batch {
  private linePos: number[] = [];
  private lineCol: number[] = [];
  private triPos: number[] = [];

  seg(a: THREE.Vector3, b: THREE.Vector3, col: THREE.Color, alpha = 0.95) {
    this.linePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    this.lineCol.push(col.r, col.g, col.b, alpha, col.r, col.g, col.b, alpha);
  }
  loop(pts: THREE.Vector3[], col: THREE.Color, alpha = 0.95) {
    for (let i = 0; i < pts.length; i++) this.seg(pts[i], pts[(i + 1) % pts.length], col, alpha);
  }
  poly(pts: THREE.Vector3[], col: THREE.Color, alpha = 0.95) {
    for (let i = 0; i < pts.length - 1; i++) this.seg(pts[i], pts[i + 1], col, alpha);
  }
  fan(center: THREE.Vector3, pts: THREE.Vector3[]) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      this.triPos.push(center.x, center.y, center.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  buildLines(): THREE.LineSegments {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.linePos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.lineCol, 4));
    return new THREE.LineSegments(g, matLines);
  }
  buildFill(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.triPos, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, matPaper);
  }
}

/** 不规则圆折线 */
function wobblyCircle(cx: number, cy: number, r: number, squashY: number, rng: Rng, n = 18): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + rng.signed() * 0.075);
    pts.push(new THREE.Vector3(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * squashY, 0));
  }
  return pts;
}

/** 断续红填充笔触(横跨 P1P2,side 取 xy 面内垂直向) */
function brokenStrokes(batch: Batch, p1: THREE.Vector3, p2: THREE.Vector3, rng: Rng, count = 3, halfW = 0.016) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length(); dir.normalize();
  const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1));
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  for (let i = 0; i < count; i++) {
    const t = (i + 0.2 + rng.next() * 0.25) / count;
    const l = len * (0.10 + rng.next() * 0.14);
    const c = p1.clone().lerp(p2, Math.min(t, 0.9));
    const a = c.clone().addScaledVector(side, -(halfW + rng.next() * 0.008));
    const b = c.clone().addScaledVector(side, halfW + rng.next() * 0.008).addScaledVector(dir, l);
    batch.seg(a, b, C_RED_FILL, 0.55);
  }
}

export function buildNpcModel(variantSeed: number, cls: NpcClass = 'grunt'): NpcModelParts {
  const rng = new Rng(1000 + variantSeed * 97);
  const group = new THREE.Group();
  const root = new THREE.Group();
  group.add(root);

  // ---- 变体参数 ----
  const headR = 0.32 * rng.range(0.97, 1.03);
  const headCx = rng.signed() * 0.02;
  const bellyRx = rng.range(0.37, 0.39) * (cls === 'heavy' ? 1.06 : 1);
  const bellyRy = bellyRx * rng.range(1.02, 1.14);
  const legLen = rng.range(0.86, 0.94);
  const legSpread = rng.range(0.10, 0.16);
  const browTilt = rng.signed() * 0.35;
  const mouthOpen = rng.chance(0.4);
  const armElbowR = new THREE.Vector3(rng.range(0.46, 0.58), rng.range(1.50, 1.66), 0);
  const handR = new THREE.Vector3(rng.range(0.08, 0.2), rng.range(1.82, 1.95), 0.02);
  const armElbowL = new THREE.Vector3(-rng.range(0.44, 0.56), rng.range(1.10, 1.26), 0);
  const handL = new THREE.Vector3(-rng.range(0.36, 0.48), rng.range(0.92, 1.04), 0.02);
  const wTilt = rng.signed() * 0.14;
  const wOffX = rng.range(0.04, 0.16);
  const headCY = 2.17 - headR - 0.02;
  const bellyCY = headCY - headR - bellyRy + rng.range(0.10, 0.16);

  /* ============ 躯干静态批(头/肚/脸/臂/手套) ============ */
  const body = new Batch();
  const headPts = wobblyCircle(headCx, headCY, headR, 1, rng);
  body.loop(headPts, C_RED);
  body.fan(new THREE.Vector3(headCx, headCY, -0.001), headPts);
  const bellyPts = wobblyCircle(0, bellyCY, bellyRx, bellyRy / bellyRx, rng);
  body.loop(bellyPts, C_RED);
  body.fan(new THREE.Vector3(0, bellyCY, -0.002), bellyPts);

  // 脸(石墨 + 细红眼线)
  const eyeY = headCY + 0.05, eyeDX = headR * 0.42;
  const browLen = headR * 0.34;
  for (const s of [-1, 1] as const) {
    const ex = headCx + s * eyeDX;
    const bt = browTilt * s;
    for (const dy of [0.10, 0.085]) {
      body.seg(
        new THREE.Vector3(ex - browLen / 2, eyeY + dy - bt * 0.5, 0.01),
        new THREE.Vector3(ex + browLen / 2, eyeY + dy + bt * 0.5, 0.01),
        C_GRAPHITE,
      );
    }
    for (const dy of [-0.045, -0.055]) {
      body.seg(
        new THREE.Vector3(ex - 0.022, eyeY + dy, 0.01),
        new THREE.Vector3(ex + 0.022, eyeY + dy + 0.015, 0.01),
        C_GRAPHITE,
      );
    }
  }
  body.seg(
    new THREE.Vector3(headCx, eyeY - 0.10, 0.01),
    new THREE.Vector3(headCx + rng.signed() * 0.02, eyeY - 0.17, 0.01),
    C_GRAPHITE,
  );
  const mouthY = headCY - headR * 0.42;
  if (mouthOpen) {
    body.poly([
      new THREE.Vector3(headCx - 0.05, mouthY + 0.03, 0.01),
      new THREE.Vector3(headCx - 0.02, mouthY - 0.045, 0.01),
      new THREE.Vector3(headCx + 0.04, mouthY - 0.03, 0.01),
    ], C_GRAPHITE);
  } else {
    body.seg(
      new THREE.Vector3(headCx - 0.07 + rng.signed() * 0.01, mouthY, 0.01),
      new THREE.Vector3(headCx + 0.07, mouthY + rng.signed() * 0.012, 0.01),
      C_GRAPHITE,
    );
  }
  body.seg(
    new THREE.Vector3(headCx - eyeDX - 0.07, eyeY - 0.02 + rng.signed() * 0.01, 0.012),
    new THREE.Vector3(headCx + eyeDX + 0.07, eyeY - 0.02 + rng.signed() * 0.01, 0.012),
    C_RED,
  );

  // 手臂
  const shoulderR = new THREE.Vector3(bellyRx * 0.82, bellyCY + bellyRy * 0.42, 0);
  const shoulderL = new THREE.Vector3(-bellyRx * 0.82, bellyCY + bellyRy * 0.42, 0);
  body.seg(shoulderR, armElbowR, C_RED);
  body.seg(armElbowR, handR, C_RED);
  body.seg(shoulderL, armElbowL, C_RED);
  body.seg(armElbowL, handL, C_RED);
  const mitten = (c: THREE.Vector3, r: number) => {
    const pts = wobblyCircle(c.x, c.y, r, 1, rng, 9);
    body.loop(pts, C_INK);
    body.fan(new THREE.Vector3(c.x, c.y, -0.001), pts);
  };
  mitten(handR, 0.062);
  mitten(handL, 0.058);

  root.add(body.buildLines());
  root.add(body.buildFill());

  /* ============ 腿(各一组:线+鞋填充) ============ */
  const hipY = bellyCY - bellyRy + 0.10;
  const mkLeg = (side: 1 | -1): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(side * legSpread, hipY, 0);
    const ankle = new THREE.Vector3(side * rng.range(0.02, 0.09), -legLen, 0);
    const knee = new THREE.Vector3(side * rng.range(0.0, 0.05), -legLen * rng.range(0.45, 0.55), rng.signed() * 0.02);
    const batch = new Batch();
    // 双轮廓
    const legOutline = (p1: THREE.Vector3, p2: THREE.Vector3) => {
      const d = new THREE.Vector3().subVectors(p2, p1).normalize();
      const off = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 0, 1)).normalize().multiplyScalar(0.024);
      batch.seg(p1.clone().add(off), p2.clone().add(off), C_RED);
      batch.seg(p1.clone().sub(off), p2.clone().sub(off), C_RED);
    };
    legOutline(new THREE.Vector3(0, 0, 0), knee);
    legOutline(knee, ankle);
    brokenStrokes(batch, new THREE.Vector3(0, 0, 0), knee, rng, 3, 0.016);
    brokenStrokes(batch, knee, ankle, rng, 3, 0.016);
    // 鞋(纸白角状多边形,左右不同形)
    const shoeN = 4 + (side === 1 ? 0 : 1);
    const shoePts: THREE.Vector3[] = [];
    for (let i = 0; i < shoeN; i++) {
      const a = (i / shoeN) * Math.PI - Math.PI / 2;
      const rr = 0.10 + rng.next() * 0.06;
      shoePts.push(new THREE.Vector3(ankle.x + Math.cos(a) * rr * 1.7 * side, ankle.y - Math.abs(Math.sin(a)) * rr * 0.8, ankle.z));
    }
    const shoeLoop = [
      ankle.clone().add(new THREE.Vector3(-0.05 * side, 0.02, 0)),
      ...shoePts,
      ankle.clone().add(new THREE.Vector3(0.16 * side, -0.01, 0)),
    ];
    batch.loop(shoeLoop, C_INK);
    batch.fan(ankle.clone().add(new THREE.Vector3(0.04 * side, -0.03, -0.001)), shoeLoop);
    g.add(batch.buildLines());
    g.add(batch.buildFill());
    root.add(g);
    return g;
  };
  const legL = mkLeg(1);
  const legR = mkLeg(-1);

  /* ============ 武器(独立组:攻击后坐动画) ============ */
  const weapon = new THREE.Group();
  const wLen = cls === 'marksman' ? 1.05 : cls === 'heavy' ? 0.8 : 0.85;
  const wW = cls === 'heavy' ? 0.11 : 0.07;
  const wCy = 1.55;
  weapon.position.set(wOffX, wCy, 0.06);
  weapon.rotation.z = wTilt;
  const half = wLen / 2;
  const wq = [
    new THREE.Vector3(-wW / 2, -half), new THREE.Vector3(-wW / 2, half),
    new THREE.Vector3(wW / 2, half), new THREE.Vector3(wW / 2, -half),
  ];
  const wb = new Batch();
  wb.loop(wq, C_INK);
  wb.fan(new THREE.Vector3(0, 0, -0.002), wq);
  const fillCol = cls === 'marksman' ? C_RED_FILL : C_GRAPHITE;
  for (let i = 0; i < 6; i++) {
    const y = -half + (i + 0.5) * (wLen / 6);
    wb.seg(new THREE.Vector3(-wW / 2 * 0.7, y, 0), new THREE.Vector3(wW / 2 * 0.7, y + 0.02, 0), fillCol, cls === 'marksman' ? 0.55 : 0.5);
  }
  if (cls === 'marksman') {
    wb.seg(new THREE.Vector3(0, half - 0.02, 0.01), new THREE.Vector3(0, half + 0.08, 0.01), C_RED);
  }
  weapon.add(wb.buildLines());
  weapon.add(wb.buildFill());
  root.add(weapon);

  if (cls === 'rusher') root.rotation.x = 0.10;

  return {
    group, root, legL, legR, weapon,
    headCenter: new THREE.Vector3(headCx, headCY, 0),
    headRadius: headR,
    bellyCenter: new THREE.Vector3(0, bellyCY, 0),
  };
}

/** 更新走路动画(距离驱动相位) */
export function animateNpc(p: NpcModelParts, gaitPhase: number, speed01: number, attackT: number, stagger: number) {
  const swing = Math.sin(gaitPhase) * 0.55 * speed01;
  p.legL.rotation.x = swing;
  p.legR.rotation.x = -swing;
  p.root.position.y = Math.abs(Math.cos(gaitPhase)) * 0.035 * speed01;
  p.root.rotation.z = Math.sin(gaitPhase) * 0.02 * speed01 + stagger * Math.sin(stagger * 60) * 0.12;
  p.weapon.position.z = 0.06 + attackT * 0.08;
  p.weapon.rotation.x = -attackT * 0.18;
}
