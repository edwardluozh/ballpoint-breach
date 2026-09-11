import * as THREE from 'three';
import { sharedPenFill } from '../render/penFill';
import { makePenOutline } from '../render/penOutline';
import { PAL } from '../render/palette';

/** 天空:太阳、简笔云、32s 巡逻纸飞机(折叠纸面+靛蓝折线)。始终无光照语义。 */

export function buildSky(group: THREE.Group) {
  const inkMat = new THREE.LineBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.75 });

  // 太阳:圆 + 12 放射线(双圈手绘感)
  {
    const pts: THREE.Vector3[] = [];
    const c = new THREE.Vector3(60, 55, -90), r = 4.2;
    let first = true;
    for (let a = 0; a <= Math.PI * 2 + 0.02; a += Math.PI / 14) {
      const p = new THREE.Vector3(c.x + Math.cos(a) * r, c.y + Math.sin(a) * (r * 0.92), c.z);
      if (first) { pts.push(p); first = false; } else pts.push(p);
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), inkMat));
    const rays: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const d = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.92, 0);
      rays.push(c.clone().addScaledVector(d, r + 0.9), c.clone().addScaledVector(d, r + 2.1));
    }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rays), inkMat));
  }

  // 云:3 团简笔圆弧
  const cloudAt = (x: number, y: number, z: number, s: number) => {
    const lobes = 4;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < lobes; i++) {
      const lx = (i - (lobes - 1) / 2) * 1.5 * s;
      const lr = (1.1 + (i % 2) * 0.45) * s;
      let first = true;
      for (let a = 0; a <= Math.PI; a += Math.PI / 8) {
        const p = new THREE.Vector3(x + lx + Math.cos(a) * lr, y + Math.sin(a) * lr * 0.72, z);
        if (first && i > 0) pts.pop(); // 弧间小断口
        pts.push(p);
        first = false;
      }
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), inkMat);
    line.frustumCulled = false;
    group.add(line);
  };
  cloudAt(-70, 40, -80, 2.4);
  cloudAt(40, 45, -60, 3.0);
  cloudAt(0, 48, -110, 2.0);
}

/** 纸飞机:淡纸面 + 靛蓝轮廓/折线;椭圆巡逻 32s。返回 update(t)。 */
export function buildPaperPlane(group: THREE.Group): (t: number) => void {
  const plane = new THREE.Group();
  const paperMat = sharedPenFill(810, { density: 0.35, paper: 0xfaf6e7 });

  // 两片三角翼(折纸)
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 1.6,  -2.2, 0.06, -1.1,  0, 0.22, -0.5,
    0, 0, 1.6,  0, 0.22, -0.5,  2.2, 0.06, -1.1,
  ], 3));
  wingGeo.computeVertexNormals();
  plane.add(new THREE.Mesh(wingGeo, paperMat));
  plane.add(makePenOutline(wingGeo, { seed: 811, thresholdAngle: 5 }));
  // 中折线
  const fold = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 1.6), new THREE.Vector3(0, 0.22, -0.5)]),
    new THREE.LineBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.7 }),
  );
  plane.add(fold);
  plane.scale.setScalar(1.6);
  group.add(plane);

  const cx = 0, cz = -14, ax = 30, az = 22, cy = 26;
  return (t: number) => {
    const ph = (t / 32) * Math.PI * 2;
    const x = cx + Math.cos(ph) * ax;
    const z = cz + Math.sin(ph) * az;
    const dx = -Math.sin(ph) * ax, dz = Math.cos(ph) * az;
    plane.position.set(x, cy + Math.sin(ph * 3) * 0.8, z);
    plane.rotation.y = Math.atan2(dx, dz);
    plane.rotation.z = Math.sin(ph * 3) * 0.12;
  };
}
