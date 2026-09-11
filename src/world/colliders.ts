import * as THREE from 'three';

/** 简单确定性碰撞世界:AABB 列表 + 地面/楼板高度查询 + 射线。 */

export interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** 可选:只有顶面实心(踏步/低障碍),侧面仍推动 */
  tag?: 'solid' | 'step' | 'barricade' | 'rail';
}

/** 均匀网格空间哈希(broadphase) */
interface SpatialGrid {
  cellSize: number;
  cells: Map<string, Box[]>;
}

export class ColliderWorld {
  boxes: Box[] = [];
  private barricades: Box[] = [];
  private grid: SpatialGrid = { cellSize: 8, cells: new Map() };
  private gridDirty = false;

  addBox(center: THREE.Vector3, size: THREE.Vector3, tag: Box['tag'] = 'solid'): Box {
    const b: Box = {
      min: center.clone().sub(size.clone().multiplyScalar(0.5)),
      max: center.clone().add(size.clone().multiplyScalar(0.5)),
      tag,
    };
    this.boxes.push(b);
    this.gridDirty = true;
    return b;
  }

  addBarricade(b: Box) { this.barricades.push(b); this.boxes.push(b); this.gridDirty = true; }
  removeBarricade(b: Box) {
    const i = this.barricades.indexOf(b);
    if (i >= 0) this.barricades.splice(i, 1);
    const j = this.boxes.indexOf(b);
    if (j >= 0) this.boxes.splice(j, 1);
    this.gridDirty = true;
  }

  private rebuildGrid() {
    this.grid.cells.clear();
    for (const b of this.boxes) {
      const minCx = Math.floor(b.min.x / this.grid.cellSize);
      const maxCx = Math.floor(b.max.x / this.grid.cellSize);
      const minCz = Math.floor(b.min.z / this.grid.cellSize);
      const maxCz = Math.floor(b.max.z / this.grid.cellSize);
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = `${cx},${cz}`;
          let cell = this.grid.cells.get(key);
          if (!cell) { cell = []; this.grid.cells.set(key, cell); }
          cell.push(b);
        }
      }
    }
    this.gridDirty = false;
  }

  private queryGrid(minX: number, maxX: number, minZ: number, maxZ: number): Box[] {
    if (this.gridDirty) this.rebuildGrid();
    const result = new Set<Box>();
    const minCx = Math.floor(minX / this.grid.cellSize);
    const maxCx = Math.floor(maxX / this.grid.cellSize);
    const minCz = Math.floor(minZ / this.grid.cellSize);
    const maxCz = Math.floor(maxZ / this.grid.cellSize);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cell = this.grid.cells.get(`${cx},${cz}`);
        if (cell) cell.forEach((b) => result.add(b));
      }
    }
    return Array.from(result);
  }

  /** 点下方最近支撑面高度(含 y=0 地面);top 表面可站 */
  groundHeight(x: number, z: number, fromY: number, tolerance = 0.55): number {
    let best = 0;
    const candidates = this.queryGrid(x, x, z, z);
    for (const b of candidates) {
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
      const top = b.max.y;
      if (top <= fromY + tolerance && top > best) best = top;
    }
    return best;
  }

  /** 水平移动解算:对希望位移做逐轴 AABB 推出(胶囊近似为半径 r 的立方)。 */
  resolveHorizontal(
    pos: THREE.Vector3,          // 脚底位置,将被修改
    desired: THREE.Vector3,      // 希望的水平位移
    radius: number, height: number,
  ): THREE.Vector3 {
    const steps = Math.max(1, Math.ceil(desired.length() / 0.25));
    const inc = desired.clone().divideScalar(steps);
    const applied = new THREE.Vector3();
    for (let s = 0; s < steps; s++) {
      const before = pos.clone();
      pos.x += inc.x;
      this.pushOut(pos, radius, height, 0);
      pos.z += inc.z;
      this.pushOut(pos, radius, height, 2);
      applied.add(pos).sub(before);
    }
    return applied;
  }

  private pushOut(pos: THREE.Vector3, r: number, h: number, axis: 0 | 2) {
    const candidates = this.queryGrid(pos.x - r, pos.x + r, pos.z - r, pos.z + r);
    for (const b of candidates) {
      // 垂直重叠检查(实体或非 step 顶面承载由 groundHeight 处理)
      if (pos.y + h <= b.min.y + 0.02 || pos.y + 0.45 >= b.max.y) {
        // 站在顶面上时,侧面不推(允许走上 step)
        if (pos.y + 0.45 >= b.max.y && b.tag !== 'rail') continue;
        if (pos.y + h <= b.min.y + 0.02) continue;
      }
      const ox = pos.x > b.min.x - r && pos.x < b.max.x + r;
      const oz = pos.z > b.min.z - r && pos.z < b.max.z + r;
      if (!ox || !oz) continue;
      if (axis === 0) {
        const toMin = Math.abs(pos.x - (b.min.x - r));
        const toMax = Math.abs(b.max.x + r - pos.x);
        pos.x += (toMin < toMax ? -toMin : toMax);
      } else {
        const toMin = Math.abs(pos.z - (b.min.z - r));
        const toMax = Math.abs(b.max.z + r - pos.z);
        pos.z += (toMin < toMax ? -toMin : toMax);
      }
    }
  }

  /** 射线 vs AABB( slab 法),返回距离与法线;不含地面(地面由调用方处理)。 */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = Infinity):
    { dist: number; normal: THREE.Vector3; box: Box } | null {
    let best: { dist: number; normal: THREE.Vector3; box: Box } | null = null;
    const inv = new THREE.Vector3(1 / (dir.x || 1e-9), 1 / (dir.y || 1e-9), 1 / (dir.z || 1e-9));
    for (const b of this.boxes) {
      let tmin = 0, tmax = maxDist;
      let nAxis = -1, nSign = 1;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        const o = a === 0 ? origin.x : a === 1 ? origin.y : origin.z;
        const iv = a === 0 ? inv.x : a === 1 ? inv.y : inv.z;
        const mn = a === 0 ? b.min.x : a === 1 ? b.min.y : b.min.z;
        const mx = a === 0 ? b.max.x : a === 1 ? b.max.y : b.max.z;
        let t1 = (mn - o) * iv, t2 = (mx - o) * iv;
        let sgn = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sgn = 1; }
        if (t1 > tmin) { tmin = t1; nAxis = a; nSign = sgn; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
      if (ok && tmin >= 0 && (!best || tmin < best.dist)) {
        const normal = new THREE.Vector3(
          nAxis === 0 ? nSign : 0, nAxis === 1 ? nSign : 0, nAxis === 2 ? nSign : 0);
        best = { dist: tmin, normal, box: b };
      }
    }
    return best;
  }

  /** 视线检查(两点间无遮挡) */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3, ignoreRails = true): boolean {
    const dir = new THREE.Vector3().subVectors(b, a);
    const dist = dir.length();
    if (dist < 1e-4) return true;
    dir.divideScalar(dist);
    const hit = this.raycast(a, dir, dist);
    if (!hit) return true;
    if (ignoreRails && hit.box.tag === 'rail') return true;
    return hit.dist >= dist - 0.01;
  }
}
