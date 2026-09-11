import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAL } from '../render/palette';
import { sharedPenFill } from '../render/penFill';
import { makePenOutline, mergePenOutlines } from '../render/penOutline';
import { ColliderWorld } from './colliders';
import type { Box } from './colliders';

/**
 * 竞技场构建 —— 严格遵循 docs/LAYOUT_CONTRACT.md(修改布局先改契约)。
 * 全部轴对齐;带洞墙拆实心段;楼梯为 0.375 高踏步串。
 */

export interface ArenaPoints {
  enemySpawns: THREE.Vector3[];
  supplies: { pos: THREE.Vector3; kind: 'hp' | 'ammo' }[];
  grappleAnchors: THREE.Vector3[];
  barricades: { box: Box; mesh: THREE.Mesh }[];
}

export interface Arena {
  group: THREE.Group;
  colliders: ColliderWorld;
  points: ArenaPoints;
}

interface Opening { at: number; width: number; sill: number; top: number }

type Tag = Box['tag'];

export function buildArena(): Arena {
  const group = new THREE.Group();
  const colliders = new ColliderWorld();
  const points: ArenaPoints = { enemySpawns: [], supplies: [], grappleAnchors: [], barricades: [] };
  let seedCounter = 1;

  /* 合批:静态件按"材质键"分组共享材质,构建后合并 → 少数填充 mesh + 1 个轮廓 LineSegments */
  const FILL_BUCKETS = 12;
  const fillGroups = new Map<string, { mat: THREE.ShaderMaterial; geos: THREE.BufferGeometry[] }>();
  const outlineParts: THREE.LineSegments[] = [];

  function fillEntry(key: string, mk: () => THREE.ShaderMaterial) {
    let e = fillGroups.get(key);
    if (!e) { e = { mat: mk(), geos: [] }; fillGroups.set(key, e); }
    return e;
  }

  function collectStatic(geo: THREE.BufferGeometry, matKey: string, mkMat: () => THREE.ShaderMaterial,
    outline?: { seed: number; color?: number; threshold?: number }, dynamic = false) {
    if (dynamic) {
      group.add(new THREE.Mesh(geo, mkMat()));
      if (outline) group.add(makePenOutline(geo, outline));
    } else {
      fillEntry(matKey, mkMat).geos.push(geo);
      if (outline) outlineParts.push(makePenOutline(geo, outline));
    }
  }

  function box(
    w: number, h: number, d: number, x: number, yBottom: number, z: number,
    opts: { collide?: Tag | boolean; density?: number; ochre?: boolean; paper?: number; hatch?: number; noOutline?: boolean; seed?: number; dynamic?: boolean } = {},
  ) {
    const seed = opts.seed ?? ++seedCounter;
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(x, yBottom + h / 2, z);
    const matKey = `f${seed % FILL_BUCKETS}|${opts.density ?? 1}|${opts.paper ?? ''}|${opts.hatch ?? ''}|${opts.ochre ? 'o' : ''}`;
    collectStatic(geo, matKey,
      () => sharedPenFill(seed % FILL_BUCKETS, {
        density: opts.density ?? 1,
        ...(opts.paper ? { paper: opts.paper } : {}),
        ...(opts.hatch ? { hatch: opts.hatch } : {}),
        ...(opts.ochre ? { paper: 0xe8cf9e, hatch: 0xb07f2e } : {}),
      }),
      opts.noOutline ? undefined : { seed: seed * 1.37 + 0.11, ...(opts.ochre ? { color: 0x9a6d20 } : {}) },
      !!opts.dynamic,
    );
    const tag: Tag | undefined =
      opts.collide === false ? undefined
        : opts.collide === true || opts.collide === undefined ? 'solid'
          : opts.collide;
    if (tag) {
      colliders.addBox(
        new THREE.Vector3(x, yBottom + h / 2, z),
        new THREE.Vector3(w, h, d),
        tag,
      );
    }
    return null as unknown as THREE.Mesh;
  }

  /** 带窗/门洞的墙(轴对齐)。axis:'x'|'z' 表示墙延伸方向;cx,cz 为墙中心。 */
  function wallWithOpenings(
    len: number, h: number, t: number, axis: 'x' | 'z',
    cx: number, yBottom: number, cz: number,
    openings: Opening[], seedBase: number,
  ) {
    const sorted = [...openings].sort((a, b) => a.at - b.at);
    const segs: { from: number; to: number; bottom: number; top: number }[] = [];
    let cursor = -len / 2;
    for (const o of sorted) {
      const a = o.at - o.width / 2, b2 = o.at + o.width / 2;
      if (a > cursor) segs.push({ from: cursor, to: a, bottom: 0, top: h });
      if (o.sill > 0.01) segs.push({ from: a, to: b2, bottom: 0, top: o.sill });
      if (o.top < h - 0.01) segs.push({ from: a, to: b2, bottom: o.top, top: h });
      cursor = b2;
    }
    if (cursor < len / 2 - 1e-6) segs.push({ from: cursor, to: len / 2, bottom: 0, top: h });

    let i = 0;
    for (const s of segs) {
      const w = s.to - s.from, ph = s.top - s.bottom;
      if (w < 0.02 || ph < 0.02) continue;
      const mid = (s.from + s.to) / 2;
      const sx = axis === 'x' ? cx + mid : cx;
      const sz = axis === 'x' ? cz : cz + mid;
      const bw = axis === 'x' ? w : t;
      const bd = axis === 'x' ? t : w;
      box(bw, ph, bd, sx, yBottom + s.bottom, sz, { seed: seedBase + (i++ % 7) });
    }
  }

  /** 直跑楼梯(轴对齐):从 (x,z,y0) 沿 axis 正方向爬升到 y1。 */
  function stairRun(axis: 'x' | 'z', x: number, z: number, y0: number, y1: number, length: number, width: number, seedBase: number) {
    const rise = 0.375;
    const steps = Math.max(2, Math.round(Math.abs(y1 - y0) / rise));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sy = y0 + (y1 - y0) * t;
      const along = -length / 2 + length * t;
      const sx = axis === 'x' ? x + along : x;
      const sz = axis === 'x' ? z : z + along;
      const w = axis === 'x' ? length / steps + 0.06 : width;
      const d = axis === 'x' ? width : length / steps + 0.06;
      box(w, Math.max(sy, 0.2), d, sx, 0, sz, { collide: 'step', density: 0.75, seed: seedBase + (i % 5) });
    }
  }

  /** 护栏(细长盒,tag=rail) */
  function rail(x1: number, z1: number, x2: number, z2: number, yTopBottom: number, seedBase: number) {
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const len = Math.hypot(x2 - x1, z2 - z1);
    const horiz = Math.abs(x2 - x1) >= Math.abs(z2 - z1);
    box(horiz ? len : 0.09, 0.07, horiz ? 0.09 : len, cx, yTopBottom, cz,
      { collide: 'rail', density: 0.6, seed: seedBase });
  }

  /* ============ 地面 ============ */
  const groundGeo = new THREE.PlaneGeometry(72, 78);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(0, 0, -7);
  group.add(new THREE.Mesh(groundGeo, sharedPenFill(9001, { density: 0.5 })));

  /* ============ A. 四层脚手架 x[-14,10] z[-30,-12] ============ */
  for (const cx of [-14, -8, -2, 4, 10]) {
    for (const cz of [-30, -24, -18, -12]) {
      box(0.55, 12.4, 0.55, cx, 0, cz, { density: 0.95 });
    }
  }
  for (let li = 0; li < 4; li++) {
    const y = 3 + li * 3; // 可站面
    const frame = (w: number, d: number, x: number, z: number, sd: number) =>
      box(w, 0.32, d, x, y - 0.32, z, { density: 0.9, seed: sd });
    frame(24, 2.6, -2, -13.3, 200 + li);
    frame(24, 2.6, -2, -28.7, 210 + li);
    frame(2.6, 15.2, -12.7, -21, 220 + li);
    frame(2.6, 15.2, 8.7, -21, 230 + li);
    frame(13, 9, -4.5, -21, 240 + li);
    if (li < 3) {
      rail(-13.7, -13.2, 9.7, -13.2, y + 1.0, 250 + li);
      rail(-13.7, -28.8, 9.7, -28.8, y + 1.0, 260 + li);
    }
  }
  rail(-13.7, -13.2, 9.7, -13.2, 12.32, 270);
  rail(-13.7, -28.8, 9.7, -28.8, 12.32, 271);
  rail(-13.7, -13.2, -13.7, -28.8, 12.32, 272);
  rail(9.7, -13.2, 9.7, -28.8, 12.32, 273);
  // 东侧外挂楼梯(每层一段,自南向北爬)
  for (let li = 0; li < 4; li++) {
    stairRun('z', 11.5, -14.5, li * 3, (li + 1) * 3, 5.0, 1.4, 280 + li);
    // 层间小平台与楼板边衔接
    box(1.6, 0.28, 1.6, 11.5, (li + 1) * 3 - 0.28, -20.2, { density: 0.85, seed: 285 + li });
  }

  /* ============ B. undercroft x[-36,36] z[-45,-38] 顶 y=5 ============ */
  box(72, 0.4, 7, 0, 4.6, -41.5, { density: 1, seed: 300 });
  for (let i = -35; i <= 35; i += 5) {
    box(0.7, 4.6, 0.7, i, 0, -41.5, { density: 1, seed: 310 + i });
  }
  for (let seg = 0; seg < 12; seg++) {
    if (seg % 3 === 2) continue;
    const x0 = -36 + seg * 6;
    rail(x0, -38.1, x0 + 5.4, -38.1, 6.02, 330 + seg);
  }
  stairRun('z', -34, -41, 0, 5, 5.6, 1.5, 340);

  /* ============ C. 西楼 x[-34,-22] z[-6,6] 女儿墙顶 6.4 ============ */
  const winL = (at: number): Opening => ({ at, width: 1.1, sill: 1.1, top: 2.5 });
  const winU = (at: number): Opening => ({ at, width: 1.1, sill: 4.3, top: 5.7 });
  const door = (at: number): Opening => ({ at, width: 1.6, sill: 0, top: 2.25 });
  // 北墙(z=-6):门在西端
  wallWithOpenings(12, 6.4, 0.45, 'x', -28, 0, -6, [door(-4.8), winL(-1), winL(2.2), winU(4.6)], 400);
  // 南墙(z=6)
  wallWithOpenings(12, 6.4, 0.45, 'x', -28, 0, 6, [winL(-3.5), winL(0), winL(3.5), winU(0)], 401);
  // 西墙(x=-34)
  wallWithOpenings(12, 6.4, 0.45, 'z', -34, 0, 0, [winL(-3), winL(1), winU(-1)], 402);
  // 东墙(x=-22):门居中
  wallWithOpenings(12, 6.4, 0.45, 'z', -22, 0, 0, [door(0), winL(-3.4), winL(3.4)], 403);
  // 二层地板 y=3.2 / 屋顶 y=6.4
  box(11.1, 0.35, 11.1, -28, 2.85, 0, { density: 0.95, seed: 410 });
  box(11.1, 0.35, 11.1, -28, 6.05, 0, { density: 0.95, seed: 411 });
  // 屋顶女儿墙(矮墙替代 rail 更像参考)
  wallWithOpenings(12, 0.55, 0.28, 'x', -28, 6.4, -5.86, [], 412);
  wallWithOpenings(12, 0.55, 0.28, 'x', -28, 6.4, 5.86, [{ at: 0, width: 1.4, sill: 0, top: 0.55 }], 413);
  wallWithOpenings(12, 0.55, 0.28, 'z', -33.86, 6.4, 0, [], 414);
  wallWithOpenings(12, 0.55, 0.28, 'z', -22.14, 6.4, 0, [], 415);
  // 外楼梯(东面贴墙,顶步邻女儿墙缺口)
  stairRun('z', -21.2, -0.8, 0, 6.4, 4.4, 1.4, 425);
  // 桥 → 脚手架二层
  box(8, 0.28, 1.6, -18, 5.86, -8, { density: 0.9, seed: 430 });
  rail(-22, -8.9, -14, -8.9, 6.95, 432);
  rail(-22, -7.1, -14, -7.1, 6.95, 433);

  /* ============ D. 东 catwalk + 管道 + 箱区 ============ */
  box(1.8, 0.3, 42, 32, 4.7, -17, { density: 0.9, seed: 500 });
  for (let z = -38; z <= 2; z += 5) {
    box(0.4, 4.7, 0.4, 32, 0, z, { density: 1, seed: 505 + z });
  }
  rail(32.95, -37.9, 32.95, 2.9, 6.02, 520);
  stairRun('z', 32, 5.5, 5, 0, 4.4, 1.5, 525);
  // 管道(视觉,不碰撞,进合批)
  for (const [py, sd] of [[2.2, 540], [3.0, 541]] as const) {
    const g = new THREE.CylinderGeometry(0.22, 0.22, 50, 7, 1);
    g.rotateX(Math.PI / 2);
    g.translate(34.5, py, -5);
    collectStatic(g, `pipe${sd}`, () => sharedPenFill(sd, { density: 1.05 }),
      { seed: sd * 1.4, threshold: 40 });
  }
  for (let z = -30; z <= 20; z += 6) {
    box(0.14, 3.0, 0.14, 34.5, 0, z, { noOutline: true, collide: false, seed: 545 + z });
  }
  const crateSpots: [number, number, number][] = [
    [23, 8, 1.4], [24.6, 8.4, 1.1], [23.4, 9.8, 0.9], [27, 12, 1.7], [28.8, 11.4, 1.2],
    [25.5, 16, 1.4], [30.5, 18, 1.1], [23.8, 21, 1.6], [26.4, 22.5, 1.0], [31, 23.5, 1.3],
    [28.2, 25, 0.9], [33, 9, 1.2],
  ];
  crateSpots.forEach(([x, z, s], i) => box(s, s, s, x, 0, z, { density: 0.95, seed: 560 + i }));
  for (const [x, z, w] of [[-8, 16, 3.2], [10, 18, 2.6], [-18, 10, 2.8], [16, -4, 3.0]] as const) {
    box(w, 0.5, 0.5, x, 0, z, { density: 0.85, seed: 580 + x });
  }

  /* ============ E. 起重机 (26,0,20) ============ */
  {
    const tw = 0.9;
    for (const [ox, oz] of [[-tw / 2, -tw / 2], [tw / 2, -tw / 2], [-tw / 2, tw / 2], [tw / 2, tw / 2]] as const) {
      box(0.16, 16, 0.16, 26 + ox, 0, 20 + oz, { noOutline: true, seed: 600 });
    }
    colliders.addBox(new THREE.Vector3(26, 8, 20), new THREE.Vector3(1.0, 16, 1.0), 'solid');
    for (let y = 2; y < 16; y += 2.6) {
      box(1.0, 0.1, 0.1, 26, y, 20 - 0.45, { noOutline: true, collide: false, seed: 601 });
      box(1.0, 0.1, 0.1, 26, y, 20 + 0.45, { noOutline: true, collide: false, seed: 602 });
      box(0.1, 0.1, 1.0, 26 - 0.45, y, 20, { noOutline: true, collide: false, seed: 603 });
      box(0.1, 0.1, 1.0, 26 + 0.45, y, 20, { noOutline: true, collide: false, seed: 604 });
    }
    const boomLen = 18;
    const dir = new THREE.Vector3(-0.72, -0.2, -0.67).normalize();
    const start = new THREE.Vector3(26, 15.4, 20);
    const end = start.clone().addScaledVector(dir, boomLen);
    const boomGeo = new THREE.BoxGeometry(0.55, 0.55, boomLen);
    const mid = start.clone().lerp(end, 0.5);
    const boomMesh = new THREE.Mesh(boomGeo, sharedPenFill(610, { density: 1, paper: 0xe8cf9e, hatch: 0xb07f2e }));
    boomMesh.position.copy(mid);
    boomMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    group.add(boomMesh);
    const boomEdges = makePenOutline(new THREE.BoxGeometry(0.55, 0.55, boomLen), { seed: 611, color: 0x9a6d20 });
    boomEdges.position.copy(mid);
    boomEdges.quaternion.copy(boomMesh.quaternion);
    group.add(boomEdges);
    const braceGeo = new THREE.BoxGeometry(0.14, 0.14, 7.5);
    const braceMid = start.clone().addScaledVector(dir, 4.2).add(new THREE.Vector3(0, -1.7, 0));
    const brace = new THREE.Mesh(braceGeo, sharedPenFill(612, { density: 1, paper: 0xe8cf9e, hatch: 0xb07f2e }));
    brace.position.copy(braceMid);
    brace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-0.55, -0.62, -0.55).normalize());
    group.add(brace);
    const hookAt = start.clone().lerp(end, 0.55).setY(6.4);
    const cableGeo = new THREE.BufferGeometry().setFromPoints([start.clone().lerp(end, 0.55), hookAt.clone().setY(6.4)]);
    group.add(new THREE.Line(cableGeo, new THREE.LineBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.8 })));
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.09, 6, 10), sharedPenFill(615, { density: 1, paper: 0xe8cf9e, hatch: 0xb07f2e }));
    hook.position.copy(hookAt).setY(6.2);
    hook.rotation.x = Math.PI / 2;
    group.add(hook);
  }

  /* ============ F. 周墙/门/barricade/补给/锚点/出生点 ============ */
  wallWithOpenings(78, 6, 0.6, 'z', -36, 0, -7, [{ at: 7, width: 4, sill: 0, top: 3.4 }], 700);
  wallWithOpenings(78, 6, 0.6, 'z', 36, 0, -7, [{ at: 24, width: 4, sill: 0, top: 3.4 }], 701);
  wallWithOpenings(72, 6, 0.6, 'x', 0, 0, -46, [{ at: -20, width: 4, sill: 0, top: 3.4 }], 702);
  wallWithOpenings(72, 6, 0.6, 'x', 0, 0, 32, [{ at: 0, width: 4, sill: 0, top: 3.4 }], 703);

  const barricadeAt = (x: number, z: number, w: number, axis: 'x' | 'z') => {
    const bw = axis === 'x' ? w : 0.24;
    const bd = axis === 'x' ? 0.24 : w;
    // 动态件(可被破坏隐藏):独立 mesh
    const g = new THREE.BoxGeometry(bw, 1.8, bd);
    g.translate(x, 0.9, z);
    const m = new THREE.Mesh(g, sharedPenFill(710 + points.barricades.length, { density: 1.15, paper: 0xf0d9ae, hatch: 0xc98b31 }));
    group.add(m);
    group.add(makePenOutline(g, { seed: 713 + points.barricades.length, color: 0xa8711e }));
    const bx: Box = {
      min: new THREE.Vector3(x - bw / 2, 0, z - bd / 2),
      max: new THREE.Vector3(x + bw / 2, 1.8, z + bd / 2),
      tag: 'barricade',
    };
    points.barricades.push({ box: bx, mesh: m });
  };
  barricadeAt(0, 12, 4, 'x');
  barricadeAt(-22.6, 0, 3.6, 'z');
  barricadeAt(31.4, -12, 3.6, 'z');

  const supplyAt = (x: number, y: number, z: number, kind: 'hp' | 'ammo') => {
    // 动态件(拾取后隐藏)
    const g = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    g.translate(x, y + 0.27, z);
    const m = new THREE.Mesh(g, sharedPenFill(740 + points.supplies.length, { density: 0.9, paper: 0xd8f0de, hatch: 0x5a9a72 }));
    group.add(m);
    group.add(makePenOutline(g, { seed: 750 + points.supplies.length, color: 0x3f7a58 }));
    points.supplies.push({ pos: new THREE.Vector3(x, y, z), kind });
  };
  supplyAt(-30, 0, 20, 'hp'); supplyAt(12, 0, -6, 'hp'); supplyAt(30, 5, -44, 'hp');
  supplyAt(-32, 0, -30, 'ammo'); supplyAt(8, 0, -34, 'ammo'); supplyAt(28, 0, 18, 'ammo');

  const anchorAt = (x: number, y: number, z: number) => {
    const g = new THREE.TorusGeometry(0.42, 0.1, 6, 12);
    g.translate(x, y, z);
    const m = new THREE.Mesh(g, sharedPenFill(760 + points.grappleAnchors.length, { density: 1, paper: 0xe8cf9e, hatch: 0xb07f2e }));
    group.add(m);
    group.add(makePenOutline(g, { seed: 770 + points.grappleAnchors.length, color: 0x9a6d20, thresholdAngle: 40 }));
    points.grappleAnchors.push(new THREE.Vector3(x, y, z));
  };
  anchorAt(-10, 5.9, -38.3); anchorAt(15, 5.9, -38.3);
  anchorAt(26, 10, 20.8); anchorAt(-2, 13.0, -21);
  anchorAt(-32, 7.3, -4);

  points.enemySpawns.push(
    new THREE.Vector3(-30, 5.05, -44), new THREE.Vector3(30, 5.05, -44),
    new THREE.Vector3(-32, 0, -2), new THREE.Vector3(31.1, 5.05, -17),
    new THREE.Vector3(-20, 0, -44.5), new THREE.Vector3(20, 0, 28),
    new THREE.Vector3(-2, 12.35, -21),
  );

  /* ============ 合批落地:静态填充按材质合并;轮廓合并为单 LineSegments ============ */
  for (const [, entry] of fillGroups) {
    if (!entry.geos.length) continue;
    const merged = entry.geos.length === 1
      ? entry.geos[0]
      : mergeGeometries(entry.geos, false)!;
    group.add(new THREE.Mesh(merged, entry.mat));
  }
  if (outlineParts.length) {
    group.add(mergePenOutlines(outlineParts));
  }

  return { group, colliders, points };
}
