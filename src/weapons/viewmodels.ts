import * as THREE from 'three';
import { PAL } from '../render/palette';

/**
 * 第一人称程序化武器模型(挂 camera 子级,位于右下)。
 * 细线+纸白填充语言;步枪无手(参考证据);武士刀有圆手与纸白袖。
 */

const matInk = new THREE.LineBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.95 });
const matInkSoft = new THREE.LineBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.45 });
const matRed = new THREE.LineBasicMaterial({ color: PAL.red, transparent: true, opacity: 0.95 });
const matPaper = new THREE.MeshBasicMaterial({ color: PAL.paperWhite, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const matGraphiteFill = new THREE.MeshBasicMaterial({ color: 0xcfcbe8, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

function box(w: number, h: number, d: number, x: number, y: number, z: number, fill = matPaper): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, fill);
  m.position.set(x, y, z);
  g.add(m);
  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(edges, matInk);
  line.position.set(x, y, z);
  g.add(line);
  return g;
}

/** 简易圆柱部件 */
function cyl(r: number, len: number, x: number, y: number, z: number, alongZ = true, fill = matPaper): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(r, r, len, 8, 1);
  const m = new THREE.Mesh(geo, fill);
  if (alongZ) m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
  const eg = new THREE.EdgesGeometry(geo, 30);
  const line = new THREE.LineSegments(eg, matInkSoft);
  line.rotation.copy(m.rotation);
  line.position.set(x, y, z);
  g.add(line);
  return g;
}

export interface ViewModel {
  group: THREE.Group;        // 挂 camera
  muzzle: THREE.Object3D;    // 枪口/刀尖参考点
  ejector: THREE.Object3D;   // 抛壳点
  pump?: THREE.Object3D;     // 霰弹泵(动画用)
  bolt?: THREE.Object3D;     // 狙击栓
  scopeDot?: THREE.Object3D; // 步枪全息红点
}

/* ---------- 步枪:细长棱角 + 方框全息镜 ---------- */
function rifleVM(): ViewModel {
  const g = new THREE.Group();
  // 机匣(紧凑)
  g.add(box(0.055, 0.075, 0.20, 0, 0, 0.02));
  // 窄护木 + 枪管
  g.add(box(0.045, 0.05, 0.24, 0, 0.004, -0.20));
  g.add(cyl(0.011, 0.30, 0, 0.018, -0.44));
  // 弹匣(可读,略前倾)
  const mag = box(0.04, 0.13, 0.07, 0, -0.09, -0.06);
  mag.rotation.x = 0.12;
  g.add(mag);
  // 握把
  const grip = box(0.04, 0.09, 0.05, 0, -0.075, 0.10);
  grip.rotation.x = -0.35;
  g.add(grip);
  // 枪托(简化短托)
  g.add(box(0.04, 0.06, 0.12, 0, -0.012, 0.17));
  // 方形全息镜 + 红心点
  const sight = box(0.05, 0.05, 0.05, 0, 0.065, -0.05);
  g.add(sight);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.006, 8), new THREE.MeshBasicMaterial({ color: PAL.red }));
  dot.position.set(0, 0.065, -0.076);
  g.add(dot);
  // 前准星小柱
  g.add(box(0.008, 0.03, 0.008, 0, 0.035, -0.36));

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.018, -0.60); g.add(muzzle);
  const ejector = new THREE.Object3D(); ejector.position.set(0.04, 0.03, 0.0); g.add(ejector);
  const scopeDot = dot;
  return { group: g, muzzle, ejector, scopeDot };
}

/* ---------- 霰弹:粗管 + 泵 ---------- */
function shotgunVM(): ViewModel {
  const g = new THREE.Group();
  g.add(box(0.06, 0.085, 0.18, 0, 0, 0.04));
  g.add(cyl(0.017, 0.42, 0, 0.02, -0.26));
  g.add(cyl(0.015, 0.40, 0, -0.012, -0.26));
  const pump = box(0.05, 0.045, 0.14, 0, -0.012, -0.20);
  g.add(pump);
  const grip = box(0.042, 0.09, 0.05, 0, -0.08, 0.11);
  grip.rotation.x = -0.4;
  g.add(grip);
  g.add(box(0.045, 0.07, 0.14, 0, -0.01, 0.20));
  g.add(box(0.01, 0.02, 0.01, 0, 0.045, -0.44));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.48); g.add(muzzle);
  const ejector = new THREE.Object3D(); ejector.position.set(0.04, 0.02, -0.1); g.add(ejector);
  return { group: g, muzzle, ejector, pump };
}

/* ---------- 左轮:短管 + 弹巢 ---------- */
function revolverVM(): ViewModel {
  const g = new THREE.Group();
  g.add(box(0.05, 0.06, 0.10, 0, 0.01, 0.05));
  // 弹巢(圆鼓,六孔感用短柱)
  const cylinder = cyl(0.032, 0.05, 0, 0.012, -0.01, false);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cylinder.add(box(0.008, 0.008, 0.052, Math.cos(a) * 0.02, 0.012 + Math.sin(a) * 0.02, -0.01, matGraphiteFill));
  }
  g.add(cylinder);
  g.add(cyl(0.013, 0.16, 0, 0.02, -0.12));
  const grip = box(0.042, 0.10, 0.055, 0, -0.07, 0.09);
  grip.rotation.x = -0.5;
  g.add(grip);
  g.add(box(0.008, 0.02, 0.008, 0, 0.042, -0.19));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.21); g.add(muzzle);
  const ejector = new THREE.Object3D(); ejector.position.set(0, 0, 0); g.add(ejector);
  return { group: g, muzzle, ejector };
}

/* ---------- 狙击:长管 + 圆镜 ---------- */
function sniperVM(): ViewModel {
  const g = new THREE.Group();
  g.add(box(0.05, 0.07, 0.24, 0, 0, 0.05));
  g.add(cyl(0.013, 0.55, 0, 0.018, -0.36));
  g.add(box(0.045, 0.05, 0.20, 0, 0.002, -0.22));
  // 圆镜
  const scope = cyl(0.024, 0.16, 0, 0.075, -0.08, false);
  g.add(scope);
  g.add(box(0.01, 0.03, 0.02, 0, 0.05, -0.05));
  g.add(box(0.01, 0.03, 0.02, 0, 0.05, -0.12));
  const bolt = box(0.045, 0.018, 0.05, 0.045, 0.02, 0.08);
  g.add(bolt);
  const grip = box(0.04, 0.09, 0.05, 0, -0.075, 0.14);
  grip.rotation.x = -0.38;
  g.add(grip);
  g.add(box(0.042, 0.065, 0.16, 0, -0.008, 0.24));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.018, -0.64); g.add(muzzle);
  const ejector = new THREE.Object3D(); ejector.position.set(0.05, 0.02, 0.05); g.add(ejector);
  return { group: g, muzzle, ejector, bolt };
}

/* ---------- 武士刀:细纸刃 + 窄红刃线 + 小护手 + 缠柄 + 圆手 + 纸袖 ---------- */
function katanaVM(): ViewModel {
  const g = new THREE.Group();
  const blade = new THREE.Group();
  // 刃:细长纸白双面片(轻微弧)
  const bladePts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    bladePts.push(new THREE.Vector3(0, Math.sin(t * 0.9) * 0.012 - t * 0.008, -t * 0.72));
  }
  const bladeShape = new THREE.BufferGeometry();
  const verts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = bladePts[i], b = bladePts[i + 1];
    verts.push(a.x - 0.006, a.y, a.z, a.x + 0.006, a.y, a.z, b.x - 0.006, b.y, b.z);
    verts.push(a.x + 0.006, a.y, a.z, b.x + 0.006, b.y, b.z, b.x - 0.006, b.y, b.z);
  }
  bladeShape.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  bladeShape.computeVertexNormals();
  blade.add(new THREE.Mesh(bladeShape, matPaper));
  // 轮廓线
  blade.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(bladePts.map((p) => p.clone().add(new THREE.Vector3(-0.006, 0, 0)))), matInk));
  blade.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(bladePts.map((p) => p.clone().add(new THREE.Vector3(0.006, 0, 0)))), matInk));
  // 窄红刃线(刃口一侧,断续感用两段)
  const edgePts = bladePts.filter((_, i) => i % 3 !== 1);
  blade.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edgePts.map((p) => p.clone().add(new THREE.Vector3(0.006, 0.002, 0)))), matRed));
  g.add(blade);
  // 小方护手
  g.add(box(0.055, 0.012, 0.05, 0, 0, 0.01, matGraphiteFill));
  // 缠绳握把(斜纹短线)
  const grip = box(0.026, 0.03, 0.16, 0, -0.005, 0.10, matGraphiteFill);
  for (let i = 0; i < 6; i++) {
    const zz = 0.035 + i * 0.024;
    grip.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.014, -0.012, zz), new THREE.Vector3(0.014, 0.012, zz + 0.012),
    ]), matInk));
  }
  g.add(grip);
  // 圆手(握把上)+ 纸白袖(向右下延伸的宽片)
  const hand = new THREE.Mesh(new THREE.CircleGeometry(0.028, 10), matPaper);
  hand.position.set(0, -0.01, 0.10);
  hand.rotation.y = Math.PI / 2;
  g.add(hand);
  const handEdge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return new THREE.Vector3(0.001, -0.01 + Math.cos(a) * 0.028, 0.10 + Math.sin(a) * 0.028);
    })), matInk);
  g.add(handEdge);
  const sleevePts = [
    new THREE.Vector3(0.001, 0.005, 0.13), new THREE.Vector3(0.001, 0.01, 0.16),
    new THREE.Vector3(0.05, -0.09, 0.30), new THREE.Vector3(0.085, -0.10, 0.28),
    new THREE.Vector3(0.05, -0.06, 0.22),
  ];
  const sleeveGeo = new THREE.BufferGeometry();
  const sv: number[] = [];
  for (let i = 1; i < sleevePts.length - 1; i++) {
    sv.push(
      sleevePts[0].x, sleevePts[0].y, sleevePts[0].z,
      sleevePts[i].x, sleevePts[i].y, sleevePts[i].z,
      sleevePts[i + 1].x, sleevePts[i + 1].y, sleevePts[i + 1].z,
    );
  }
  sleeveGeo.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
  sleeveGeo.computeVertexNormals();
  g.add(new THREE.Mesh(sleeveGeo, matPaper));
  g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(sleevePts), matInk));

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.008, -0.72); g.add(muzzle);
  const ejector = new THREE.Object3D(); ejector.position.set(0, 0, 0); g.add(ejector);
  return { group: g, muzzle, ejector };
}

export function buildViewModel(id: 'rifle' | 'shotgun' | 'revolver' | 'sniper' | 'katana'): ViewModel {
  const vm = id === 'rifle' ? rifleVM()
    : id === 'shotgun' ? shotgunVM()
      : id === 'revolver' ? revolverVM()
        : id === 'sniper' ? sniperVM()
          : katanaVM();
  // 挂载位:右下
  vm.group.position.set(0.28, -0.24, -0.5);
  vm.group.rotation.y = 0.06;
  return vm;
}
