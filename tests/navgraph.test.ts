import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildArena } from '../src/world/arena';
import { buildNavGraph } from '../src/world/navgraph';

describe('navigation graph (LAYOUT_CONTRACT §H)', () => {
  const arena = buildArena();
  const nav = buildNavGraph(arena.colliders);

  it('生成足量节点(地面网格+高架层)', () => {
    expect(nav.nodes.length).toBeGreaterThan(200);
  });

  it('地面西→东路线贯通', () => {
    const s = nav.nearest(new THREE.Vector3(-32, 0, 0), 0);
    const g = nav.nearest(new THREE.Vector3(32, 0, 0), 0);
    const path = nav.findPath(s, g);
    expect(path.length).toBeGreaterThan(4);
    // 路径前段应保持地面层
    expect(nav.nodes[path[0]].floor).toBe(0);
    expect(nav.nodes[path[Math.min(2, path.length - 1)]].floor).toBe(0);
  });

  it('地面南→北(undercroft 下)贯通', () => {
    const s = nav.nearest(new THREE.Vector3(0, 0, 24), 0);
    const g = nav.nearest(new THREE.Vector3(0, 0, -43), 0);
    const path = nav.findPath(s, g);
    expect(path.length).toBeGreaterThan(4);
  });

  it('deck(高5)↔ 地面贯通(西楼梯)', () => {
    const s = nav.nearest(new THREE.Vector3(-30, 5, -41.5));
    const g = nav.nearest(new THREE.Vector3(0, 0, -32), 0);
    const path = nav.findPath(s, g);
    expect(path.length).toBeGreaterThan(3);
    // 起点 deck 高 y≈5,路径必须下降到 y<1 的地面节点(经楼梯)
    expect(nav.nodes[s].pos.y).toBeGreaterThan(4.5);
    const ys = path.map((id) => nav.nodes[id].pos.y);
    expect(ys.some((y) => y < 1)).toBe(true);
  });

  it('高架路线:西楼屋顶→桥→脚手架二层贯通', () => {
    const s = nav.nearest(new THREE.Vector3(-30, 6.45, 0));
    const g = nav.nearest(new THREE.Vector3(-4, 6.1, -21));
    const path = nav.findPath(s, g);
    expect(path.length).toBeGreaterThan(3);
  });

  it('脚手架顶层可达(外挂楼梯)', () => {
    const s = nav.nearest(new THREE.Vector3(12, 0, -14), 0);
    const g = nav.nearest(new THREE.Vector3(-4, 12.1, -21));
    const path = nav.findPath(s, g);
    expect(path.length).toBeGreaterThan(3);
  });
});

describe('colliders', () => {
  const arena = buildArena();

  it('出生点下方地面高度为 0', () => {
    expect(arena.colliders.groundHeight(2, 26, 2, 0.6)).toBe(0);
  });
  it('deck 顶面高度为 5', () => {
    expect(arena.colliders.groundHeight(0, -41.5, 6, 0.6)).toBeCloseTo(5.0, 1);
  });
  it('射线命中脚手架柱', () => {
    const hit = arena.colliders.raycast(
      new THREE.Vector3(0, 1.5, -18), new THREE.Vector3(-1, 0, 0), 10);
    expect(hit).not.toBeNull();
  });
});
