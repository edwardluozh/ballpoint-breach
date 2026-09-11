import * as THREE from 'three';
import { Rng } from '../core/rng';
import { PAL } from './palette';

/**
 * 手绘轮廓线:深靛蓝"committed"主线 + 断续、位移的淡副线,合并在同一 LineSegments
 * (同一次 draw call)。长边细分为短段并加 seeded 侧向弯曲/压力变化,
 * 端点偶尔过冲(overshoot)。全部确定性。
 */

export interface PenOutlineOptions {
  seed?: number;
  thresholdAngle?: number;   // EdgesGeometry 阈值
  displace?: number;         // 主线弯曲幅度(世界单位)
  ghost?: boolean;           // 是否加副线
  color?: THREE.ColorRepresentation;
  segmentsPerUnit?: number;
}

interface SegAcc {
  positions: number[];
  colors: number[];   // RGBA per vertex
}

function pushSeg(acc: SegAcc, a: THREE.Vector3, b: THREE.Vector3, r: number, g: number, bl: number, al: number) {
  acc.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  acc.colors.push(r, g, bl, al, r, g, bl, al);
}

function jitterPolyline(
  acc: SegAcc,
  a: THREE.Vector3,
  b: THREE.Vector3,
  rng: Rng,
  opts: Required<Pick<PenOutlineOptions, 'displace' | 'segmentsPerUnit'>>,
  mainColor: THREE.Color,
  ghostColor: THREE.Color,
) {
  const len = a.distanceTo(b);
  const nSeg = Math.max(1, Math.ceil(len * opts.segmentsPerUnit));
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  // 与边垂直的稳定侧向
  const side = new THREE.Vector3(0, 1, 0).cross(dir);
  if (side.lengthSq() < 0.01) side.set(1, 0, 0).cross(dir);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(dir, side);

  // 主线:细分 + 弯曲 + 每段 alpha 抖动
  const mainAlphaBase = 0.9;
  let prev = a.clone();
  for (let i = 1; i <= nSeg; i++) {
    const t = i / nSeg;
    const p = a.clone().lerp(b, t);
    const bend = Math.sin(t * Math.PI) * opts.displace;
    const isMid = i < nSeg; // 端点不弯
    if (isMid) {
      const s = rng.signed() * 0.6, u = rng.signed() * 0.6;
      p.addScaledVector(side, bend * s).addScaledVector(up, bend * u);
    }
    const al = mainAlphaBase * (0.72 + 0.28 * rng.next());
    pushSeg(acc, prev, p, mainColor.r, mainColor.g, mainColor.b, al);
    prev = p;
  }

  // 副线:整体位移 + 断续(约 55% 段保留)+ 偶尔过冲
  if (nSeg >= 1) {
    const off = side.clone().multiplyScalar(0.028 + rng.next() * 0.03)
      .addScaledVector(up, 0.02 + rng.next() * 0.025);
    const overA = rng.chance(0.3) ? dir.clone().multiplyScalar(0.03 + rng.next() * 0.05) : new THREE.Vector3();
    const overB = rng.chance(0.3) ? dir.clone().multiplyScalar(-(0.03 + rng.next() * 0.05)) : new THREE.Vector3();
    const ga = a.clone().add(off).sub(overA);
    const gb = b.clone().add(off).sub(overB);
    let gprev = null as THREE.Vector3 | null;
    let gcur = ga.clone();
    for (let i = 1; i <= nSeg; i++) {
      const t = i / nSeg;
      const p = ga.clone().lerp(gb, t);
      if (t < 1) {
        const bend = Math.sin(t * Math.PI) * opts.displace * 1.6;
        p.addScaledVector(side, bend * rng.signed() * 0.7).addScaledVector(up, bend * rng.signed() * 0.7);
      }
      if (gprev && rng.chance(0.55)) {
        const al = 0.22 + rng.next() * 0.14;
        pushSeg(acc, gprev, gcur, ghostColor.r, ghostColor.g, ghostColor.b, al);
      }
      gprev = gcur; gcur = p;
    }
  }
}

export function makePenOutline(
  geometry: THREE.BufferGeometry,
  options: PenOutlineOptions = {},
): THREE.LineSegments {
  const seed = options.seed ?? 1;
  const threshold = options.thresholdAngle ?? 24;
  const displace = options.displace ?? 0.012;
  const segPerUnit = options.segmentsPerUnit ?? 1.6;
  const color = new THREE.Color(options.color ?? PAL.ink);
  const ghostColor = new THREE.Color(PAL.ink).lerp(new THREE.Color(0xffffff), 0.35);

  const edges = new THREE.EdgesGeometry(geometry, threshold);
  const pos = edges.getAttribute('position') as THREE.BufferAttribute;
  const rng = new Rng(Math.floor(seed * 65537) + 17);

  const acc: SegAcc = { positions: [], colors: [] };
  const va = new THREE.Vector3(), vb = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 2) {
    va.fromBufferAttribute(pos, i);
    vb.fromBufferAttribute(pos, i + 1);
    jitterPolyline(acc, va, vb, rng, { displace, segmentsPerUnit: segPerUnit }, color, ghostColor);
  }
  edges.dispose();

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(acc.colors, 4));
  const m = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const lines = new THREE.LineSegments(g, m);
  lines.frustumCulled = true;
  return lines;
}

/** 合并多组轮廓到单个 LineSegments(静态建筑批处理用) */
export function mergePenOutlines(groups: THREE.LineSegments[]): THREE.LineSegments {
  const acc: SegAcc = { positions: [], colors: [] };
  for (const grp of groups) {
    const p = grp.geometry.getAttribute('position') as THREE.BufferAttribute;
    const c = grp.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 2) {
      for (let v = 0; v < 2; v++) {
        acc.positions.push(p.getX(i + v), p.getY(i + v), p.getZ(i + v));
        acc.colors.push(c.getX(i + v), c.getY(i + v), c.getZ(i + v), c.getW(i + v));
      }
    }
    grp.geometry.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(acc.colors, 4));
  const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  return new THREE.LineSegments(g, m);
}
