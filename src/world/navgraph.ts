import * as THREE from 'three';
import type { ColliderWorld } from './colliders';

/**
 * 导航图:地面网格 + 显式高架层节点/连接(楼梯、桥、catwalk)。
 * A* 代价对层变化加大惩罚 → 地面敌人天然先走同层节点。
 */

export interface NavNode {
  id: number;
  pos: THREE.Vector3;
  floor: number;          // 离散层号(0 地面,1=3m,2=5m,3=6m,4=9m,5=12m...)
  links: { to: number; cost: number }[];
}

export class NavGraph {
  nodes: NavNode[] = [];

  addNode(pos: THREE.Vector3, floor: number): number {
    const id = this.nodes.length;
    this.nodes.push({ id, pos: pos.clone(), floor, links: [] });
    return id;
  }

  link(a: number, b: number, cost?: number) {
    const na = this.nodes[a], nb = this.nodes[b];
    const c = cost ?? na.pos.distanceTo(nb.pos);
    na.links.push({ to: b, cost: c });
    nb.links.push({ to: a, cost: c });
  }

  /** 与某点最近的可用节点(可选层偏好) */
  nearest(pos: THREE.Vector3, preferFloor?: number): number {
    let best = -1, bestScore = Infinity;
    for (const n of this.nodes) {
      let s = n.pos.distanceTo(pos);
      if (preferFloor !== undefined) {
        if (n.floor !== preferFloor) s += 6;      // 同层优先(水平更近的高层节点让位)
        if (Math.abs(n.pos.y - pos.y) > 1.2) s += 40;
      }
      if (s < bestScore) { bestScore = s; best = n.id; }
    }
    return best;
  }

  /** A*:返回节点 id 路径(不含起点)。 */
  findPath(startId: number, goalId: number): number[] {
    if (startId === goalId) return [];
    const N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity);
    const f = new Float64Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const open: number[] = [startId];
    const inOpen = new Uint8Array(N);
    const closed = new Uint8Array(N);
    const h = (id: number) => this.nodes[id].pos.distanceTo(this.nodes[goalId].pos);
    g[startId] = 0; f[startId] = h(startId); inOpen[startId] = 1;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      inOpen[cur] = 0;
      if (cur === goalId) break;
      closed[cur] = 1;
      for (const l of this.nodes[cur].links) {
        if (closed[l.to]) continue;
        // 层变化惩罚:同层优先
        const floorPenalty = this.nodes[l.to].floor !== this.nodes[cur].floor ? 3.5 : 0;
        const ng = g[cur] + l.cost + floorPenalty;
        if (ng < g[l.to]) {
          g[l.to] = ng; f[l.to] = ng + h(l.to); from[l.to] = cur;
          if (!inOpen[l.to]) { open.push(l.to); inOpen[l.to] = 1; }
        }
      }
    }
    if (from[goalId] === -1 && goalId !== startId) return [];
    const path: number[] = [];
    let c = goalId;
    while (c !== startId && c !== -1) { path.push(c); c = from[c]; }
    return path.reverse();
  }
}

/** 生成竞技场导航图(与 arena.ts 布局对应)。 */
export function buildNavGraph(colliders: ColliderWorld): NavGraph {
  const g = new NavGraph();

  // 地面网格(x -32..32 step 4;z -44..28 step 4;均对齐 0 mod 4),剔除被实体占据的点
  const groundIds = new Map<string, number>();
  for (let x = -32; x <= 32; x += 4) {
    for (let z = -44; z <= 28; z += 4) {
      // 任何高于 0.6 的支撑面下方不算可站(被柱/箱占据)
      let blocked = false;
      for (const b of colliders.boxes) {
        if (b.tag === 'rail') continue;
        if (x > b.min.x - 0.5 && x < b.max.x + 0.5 && z > b.min.z - 0.5 && z < b.max.z + 0.5 && b.max.y > 0.7 && b.min.y < 0.7) {
          blocked = true; break;
        }
      }
      if (blocked) continue;
      const id = g.addNode(new THREE.Vector3(x, 0, z), 0);
      groundIds.set(`${x},${z}`, id);
    }
  }
  // 地面 4 邻接
  for (const [key, id] of groundIds) {
    const [sx, sz] = key.split(',').map(Number);
    for (const [dx, dz] of [[4, 0], [0, 4], [-4, 0], [0, -4]] as const) {
      const n = groundIds.get(`${sx + dx},${sz + dz}`);
      if (n !== undefined) g.link(id, n);
    }
  }

  // ---- 高架层 ----
  // undercroft deck(z -45..-38, 顶5):x 每 4 一节点,floor 2
  const deckIds = new Map<number, number>();
  for (let x = -32; x <= 32; x += 4) {
    deckIds.set(x, g.addNode(new THREE.Vector3(x, 5.05, -41.5), 2));
  }
  for (let x = -28; x <= 28; x += 4) g.link(deckIds.get(x)!, deckIds.get(x + 4)!);
  // deck 西楼梯(-34, z -43.8..-38)落地
  const deckWestStairBottom = g.addNode(new THREE.Vector3(-34, 0.2, -37.5), 0);
  const gn = (x: number, z: number) => groundIds.get(`${x},${z}`);
  if (gn(-32, -36) !== undefined) g.link(deckWestStairBottom, gn(-32, -36)!, 3.5);
  g.link(deckWestStairBottom, deckIds.get(-32)!, 6.5);

  // catwalk(x=32, z -38..4, 顶5),floor 2,接 deck 东端
  const catIds = new Map<number, number>();
  for (let z = -36; z <= 2; z += 4) {
    catIds.set(z, g.addNode(new THREE.Vector3(32, 5.05, z), 2));
  }
  for (let z = -32; z <= -2; z += 4) g.link(catIds.get(z)!, catIds.get(z + 4)!);
  g.link(deckIds.get(32)!, catIds.get(-36)!, 5.5);
  // catwalk 南楼梯落地(z 3.3..7.7)
  const catStairBottom = g.addNode(new THREE.Vector3(32, 0.2, 8.6), 0);
  if (gn(32, 12) !== undefined) g.link(catStairBottom, gn(32, 12)!, 4);
  g.link(catStairBottom, catIds.get(0)!, 7);

  // 脚手架每层板(中心板 x -11..2 z -25.5..-16.5):每层 6 节点
  const scaffFloorOf = (level: number) => 3 + level; // floor 编号 3,4,5,6 对应 y 3,6,9,12
  const scaffIds: number[][] = [];
  const scaffPts = [[-9, -24], [-4, -24], [1, -24], [-9, -21], [-4, -21], [1, -21], [-9, -18], [-4, -18], [1, -18]] as const;
  for (let li = 0; li < 4; li++) {
    const y = 3 + li * 3 + 0.05;
    const ids = scaffPts.map(([px, pz]) => g.addNode(new THREE.Vector3(px, y, pz), scaffFloorOf(li)));
    scaffIds.push(ids);
    // 层内 4 邻
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      if (c < 2) g.link(ids[idx], ids[idx + 1]);
      if (r < 2) g.link(ids[idx], ids[idx + 3]);
    }
  }
  // 东外挂楼梯(11.5, z -14.5..-19.5):5 个楼梯顶(0,3,6,9,12)+ 层板衔接
  const stairTops = [0, 1, 2, 3, 4].map((i) =>
    g.addNode(new THREE.Vector3(11.5, i * 3 + 0.1, -19.6), i === 0 ? 0 : scaffFloorOf(i - 1)));
  for (let li = 0; li < 4; li++) g.link(stairTops[li], stairTops[li + 1], 7.5);
  for (let i = 0; i < 5; i++) {
    const eastNode = g.addNode(
      new THREE.Vector3(8.5, i * 3 + 0.1, -19.6),
      i === 0 ? 0 : scaffFloorOf(i - 1),
    );
    g.link(eastNode, stairTops[i], 3.4);
    if (i === 0) {
      if (gn(12, -20) !== undefined) g.link(eastNode, gn(12, -20)!, 4);
    } else {
      g.link(eastNode, scaffIds[i - 1][5], 3.8);
    }
  }

  // 西楼:一层(y3.2)、屋顶(y6.4)
  const f1 = [[-30, -3], [-26, -3], [-30, 1], [-26, 1]] as const;
  const f1Ids = f1.map(([px, pz]) => g.addNode(new THREE.Vector3(px, 3.3, pz), 1));
  g.link(f1Ids[0], f1Ids[1]); g.link(f1Ids[2], f1Ids[3]); g.link(f1Ids[0], f1Ids[2]); g.link(f1Ids[1], f1Ids[3]);
  // 一层楼梯?楼内无楼梯:一层由外楼梯直达屋顶;一层通过东门/北门进出(地面)
  if (gn(-28, -8) !== undefined) g.link(gn(-28, -8)!, g.addNode(new THREE.Vector3(-27.5, 0.1, -4.5), 1), 4);
  // 屋顶
  const roof = [[-30, -3], [-26, -3], [-30, 1], [-26, 1]] as const;
  const roofIds = roof.map(([px, pz]) => g.addNode(new THREE.Vector3(px, 6.45, pz), 3));
  for (let i = 0; i < 4; i++) g.link(roofIds[i], f1Ids[i], 5.2); // 视为可跳落(单向?)——A* 无向,加高代价
  g.link(roofIds[0], roofIds[1]); g.link(roofIds[2], roofIds[3]); g.link(roofIds[0], roofIds[2]); g.link(roofIds[1], roofIds[3]);
  // 外楼梯顶(-21.2, z 1.4)
  const extStairTop = g.addNode(new THREE.Vector3(-21.4, 6.5, 1.0), 3);
  g.link(extStairTop, roofIds[3], 3.5);
  const extStairBottom = g.addNode(new THREE.Vector3(-21.4, 0.1, -1.5), 0);
  g.link(extStairBottom, extStairTop, 9);
  if (gn(-20, 0) !== undefined) g.link(extStairBottom, gn(-20, 0)!, 2.5);
  // 桥:屋顶→脚手架二层
  const bridgeW = g.addNode(new THREE.Vector3(-20, 6.45, -8), 3);
  const bridgeE = g.addNode(new THREE.Vector3(-15, 6.45, -8), 3);
  g.link(bridgeW, bridgeE, 5);
  g.link(bridgeW, roofIds[2], 4.2);
  const scaff2W = g.addNode(new THREE.Vector3(-12.6, 6.1, -8), 4);
  g.link(bridgeE, scaff2W, 2.4);
  // 脚手架二层西缘 z -13.3/-28.7 之间:连到二层节点
  const scaff2edge = g.addNode(new THREE.Vector3(-11.5, 6.1, -12), 4);
  g.link(scaff2W, scaff2edge, 4);
  const scaff2Near = scaffIds[1][6]; // (-9,-18)
  g.link(scaff2edge, scaff2Near, 7);

  return g;
}
