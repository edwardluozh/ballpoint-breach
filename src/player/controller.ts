import * as THREE from 'three';
import type { Input } from '../core/input';
import type { ColliderWorld } from '../world/colliders';

/**
 * 玩家控制器:WASD/冲刺/跳跃/重力/步阶/空中控制/坠落重置。
 * 眼高 1.58;共享距离驱动步态相位(供相机与 viewmodel 使用)。
 */

export interface PlayerState {
  pos: THREE.Vector3;      // 脚底
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  sprinting: boolean;
  speed: number;           // 当前水平速率
  gaitPhase: number;       // 距离驱动
  landImpact: number;      // 0..1 落地响应(衰减)
}

const WALK = 5.2;
const SPRINT = 8.2;
const AIR_CTRL = 2.6;
const GRAVITY = 22;
const JUMP_V = 7.4;
const RADIUS = 0.38;
const HEIGHT = 1.75;
const STEP_TOL = 0.45;

export class PlayerController {
  state: PlayerState = {
    pos: new THREE.Vector3(2, 0, 26),
    vel: new THREE.Vector3(),
    yaw: 0,                // 面向 -z
    pitch: 0,
    grounded: true,
    sprinting: false,
    speed: 0,
    gaitPhase: 0,
    landImpact: 0,
  };
  /** 相机附加微晃(克制) */
  camBob = { x: 0, y: 0 };

  constructor(private colliders: ColliderWorld, private input: Input) {}

  update(dt: number) {
    const s = this.state;
    const inp = this.input.state;

    s.yaw -= inp.look.dx;
    s.pitch = THREE.MathUtils.clamp(s.pitch - inp.look.dy, -1.45, 1.45);

    // 期望水平速度(相机相对)
    const fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const right = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    const want = new THREE.Vector3()
      .addScaledVector(fwd, inp.move.z)
      .addScaledVector(right, inp.move.x);
    const moving = want.lengthSq() > 1e-4;
    s.sprinting = inp.sprint && moving && inp.move.z > 0.3;
    const targetSpeed = s.sprinting ? SPRINT : WALK;
    if (moving) want.normalize().multiplyScalar(targetSpeed);

    // 平滑加速
    const accel = s.grounded ? 26 : AIR_CTRL;
    const hv = new THREE.Vector3(s.vel.x, 0, s.vel.z);
    hv.lerp(moving ? want : new THREE.Vector3(), Math.min(1, accel * dt * (s.grounded ? 1 : 0.4)));
    s.vel.x = hv.x; s.vel.z = hv.z;

    if (inp.jumpQueued && s.grounded) {
      s.vel.y = JUMP_V;
      s.grounded = false;
    }
    s.vel.y -= GRAVITY * dt;

    // 水平移动 + 逐轴解算
    const desired = new THREE.Vector3(s.vel.x * dt, 0, s.vel.z * dt);
    const before = s.pos.clone();
    const applied = this.colliders.resolveHorizontal(s.pos, desired, RADIUS, HEIGHT);
    // 实际水平速率(用于步态与被墙挡时归零)
    const actualDisp = new THREE.Vector3().subVectors(s.pos, before);
    s.speed = actualDisp.length() / Math.max(dt, 1e-4);

    // 垂直:地面/楼板支撑
    const groundY = this.colliders.groundHeight(s.pos.x, s.pos.z, s.pos.y, STEP_TOL + 0.1);
    s.pos.y += s.vel.y * dt;
    if (s.pos.y <= groundY + 0.001 && s.vel.y <= 0) {
      if (!s.grounded && s.vel.y < -6) s.landImpact = Math.min(1, -s.vel.y / 14);
      s.pos.y = groundY;
      s.vel.y = 0;
      s.grounded = true;
    } else if (s.pos.y > groundY + 0.02) {
      s.grounded = false;
    }
    // 步阶:贴地时若前方支撑面更高且 < STEP_TOL,直接抬上去
    if (s.grounded) {
      const gh = this.colliders.groundHeight(s.pos.x, s.pos.z, s.pos.y + 0.3, STEP_TOL);
      if (gh > s.pos.y && gh - s.pos.y <= STEP_TOL) s.pos.y = gh;
    }

    // 坠落重置
    if (s.pos.y < -30) {
      s.pos.set(2, 6, 26); s.vel.set(0, 0, 0);
    }

    // 场内硬约束(周墙内)
    s.pos.x = THREE.MathUtils.clamp(s.pos.x, -35.4, 35.4);
    s.pos.z = THREE.MathUtils.clamp(s.pos.z, -45.4, 31.4);

    // 步态相位:距离驱动(1.68Hz @ 跑速 → 每米约 0.32 周期)
    s.gaitPhase += actualDisp.length() * 1.62;
    s.landImpact = Math.max(0, s.landImpact - dt * 3.2);

    // 相机克制微晃(振幅远小于武器摆动)
    const bobAmp = Math.min(1, s.speed / WALK);
    this.camBob.x = Math.sin(s.gaitPhase) * 0.012 * bobAmp;
    this.camBob.y = Math.abs(Math.cos(s.gaitPhase)) * 0.010 * bobAmp;
  }

  applyToCamera(cam: THREE.PerspectiveCamera) {
    const s = this.state;
    cam.position.set(s.pos.x + this.camBob.x, s.pos.y + 1.58 + this.camBob.y - s.landImpact * 0.16, s.pos.z);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(s.yaw);
    cam.rotateX(s.pitch);
  }

  /** 眼位(射击/视线用) */
  eyePos(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.state.pos.x, this.state.pos.y + 1.58, this.state.pos.z);
  }
  /** 视线方向 */
  lookDir(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(
      -Math.sin(this.state.yaw) * Math.cos(this.state.pitch),
      Math.sin(this.state.pitch),
      -Math.cos(this.state.yaw) * Math.cos(this.state.pitch),
    );
  }
}
