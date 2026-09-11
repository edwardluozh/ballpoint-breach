import * as THREE from 'three';
import { PAL } from '../render/palette';

export type PickupType = 'ammo' | 'health';

export interface Pickup {
  type: PickupType;
  pos: THREE.Vector3;
  mesh: THREE.Group;
  life: number;
  collected: boolean;
}

const ammoMat = new THREE.LineBasicMaterial({ color: PAL.ochre, linewidth: 2 });
const healthMat = new THREE.LineBasicMaterial({ color: PAL.mint, linewidth: 2 });

export class PickupPool {
  pickups: Pickup[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawn(type: PickupType, pos: THREE.Vector3) {
    // 重用已收集的
    let p = this.pickups.find((p) => p.collected);
    if (!p) {
      const mesh = this.createMesh(type);
      this.scene.add(mesh);
      p = { type, pos: new THREE.Vector3(), mesh, life: 0, collected: false };
      this.pickups.push(p);
    }
    p.type = type;
    p.pos.copy(pos);
    p.life = 20; // 20秒
    p.collected = false;
    p.mesh.visible = true;
    p.mesh.position.copy(pos);
    this.updateMesh(p);
  }

  update(dt: number, playerPos: THREE.Vector3, onCollect: (type: PickupType) => void) {
    for (const p of this.pickups) {
      if (p.collected) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.collected = true;
        p.mesh.visible = false;
        continue;
      }
      // 浮动动画
      p.mesh.position.y = p.pos.y + Math.sin(Date.now() * 0.003) * 0.12;
      p.mesh.rotation.y += dt * 1.2;

      // 收集判定(球形,半径 1.2)
      if (p.pos.distanceTo(playerPos) < 1.2) {
        p.collected = true;
        p.mesh.visible = false;
        onCollect(p.type);
      }
    }
  }

  private createMesh(type: PickupType): THREE.Group {
    const g = new THREE.Group();
    if (type === 'ammo') {
      // 弹药盒:立方体轮廓 + 中心十字
      const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.35, 0.35, 0.35));
      const box = new THREE.LineSegments(geo, ammoMat);
      g.add(box);
      const cross = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.22, 0, 0), new THREE.Vector3(0.22, 0, 0),
        new THREE.Vector3(0, -0.22, 0), new THREE.Vector3(0, 0.22, 0),
        new THREE.Vector3(0, 0, -0.22), new THREE.Vector3(0, 0, 0.22),
      ]);
      g.add(new THREE.LineSegments(cross, ammoMat));
    } else {
      // 生命包:十字架
      const size = 0.38;
      const thick = 0.12;
      const verts = [
        new THREE.Vector3(-size, thick, 0), new THREE.Vector3(size, thick, 0),
        new THREE.Vector3(size, thick, 0), new THREE.Vector3(size, -thick, 0),
        new THREE.Vector3(size, -thick, 0), new THREE.Vector3(-size, -thick, 0),
        new THREE.Vector3(-size, -thick, 0), new THREE.Vector3(-size, thick, 0),
        new THREE.Vector3(-thick, size, 0), new THREE.Vector3(thick, size, 0),
        new THREE.Vector3(thick, size, 0), new THREE.Vector3(thick, -size, 0),
        new THREE.Vector3(thick, -size, 0), new THREE.Vector3(-thick, -size, 0),
        new THREE.Vector3(-thick, -size, 0), new THREE.Vector3(-thick, size, 0),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(verts);
      g.add(new THREE.LineSegments(geo, healthMat));
    }
    return g;
  }

  private updateMesh(p: Pickup) {
    // 切换材质颜色
    const mat = p.type === 'ammo' ? ammoMat : healthMat;
    p.mesh.traverse((obj) => {
      if (obj instanceof THREE.LineSegments) {
        obj.material = mat;
      }
    });
  }
}
