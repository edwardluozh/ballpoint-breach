import * as THREE from 'three';
import { NetworkManager, type Team, type NetMessage } from '../net/network';
import { Input } from '../core/input';
import type { Arena } from '../world/arena';
import type { AudioSystem } from '../audio/audio';
import type { ColliderWorld } from '../world/colliders';
import { PAL } from '../render/palette';

interface RemotePlayer {
  id: string;
  name: string;
  team: Team;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  mesh: THREE.Group | null;
  weapon: string;
}

export class PvPGame {
  net: NetworkManager;
  myTeam: Team = 'spectator';
  myName: string;
  remotePlayers = new Map<string, RemotePlayer>();
  isHost: boolean;
  
  // 本地玩家物理状态(复用PlayerController逻辑)
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  hp = 100;
  maxHp = 100;
  alive = true;
  kills = 0;
  deaths = 0;
  respawnTimer = 0;
  currentWeapon = 'rifle';
  
  // 游戏状态
  matchRunning = false;
  matchTime = 0;
  redScore = 0;
  blueScore = 0;
  
  // 网络
  private lastStateTime = 0;
  private lastInputTime = 0;

  constructor(
    net: NetworkManager,
    playerName: string,
    private scene: THREE.Scene,
    private arena: Arena,
    private colliders: ColliderWorld,
    private audio: AudioSystem,
    private input: Input,
  ) {
    this.net = net;
    this.myName = playerName;
    this.isHost = net.isHost;
    this.net.onMessage = (msg) => this.handleMessage(msg);
  }

  changeTeam(team: Team) {
    this.myTeam = team;
    this.net.send({ type: 'team', id: this.net.myId, name: this.myName, team });
  }

  startMatch() {
    if (!this.isHost) return;
    
    this.matchRunning = true;
    this.matchTime = 0;
    this.redScore = 0;
    this.blueScore = 0;
    
    // 初始化本地玩家
    this.spawnPlayer();
    
    // 通知所有客户端
    this.net.send({ type: 'start' });
  }

  spawnPlayer() {
    const spawnPos = this.getSpawnPoint(this.myTeam);
    this.pos.copy(spawnPos);
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp;
    this.alive = true;
    this.respawnTimer = 0;
    
    // 面向对方
    if (this.myTeam === 'red') {
      this.yaw = 0; // 面向北
    } else {
      this.yaw = Math.PI; // 面向南
    }
  }

  update(dt: number, camera: THREE.Camera) {
    if (!this.matchRunning) return;

    this.matchTime += dt;

    // 重生倒计时
    if (!this.alive && this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.spawnPlayer();
      }
    }

    if (this.isHost) {
      this.updateHost(dt, camera);
    } else {
      this.updateClient(dt, camera);
    }

    // 更新远程玩家插值
    for (const [, rp] of this.remotePlayers) {
      if (rp.mesh && rp.alive) {
        // 简单插值
        rp.mesh.position.lerp(rp.pos, dt * 10);
        rp.mesh.rotation.y = THREE.MathUtils.lerp(rp.mesh.rotation.y, rp.yaw, dt * 10);
      }
    }
  }

  private updateHost(dt: number, camera: THREE.Camera) {
    // 主机:运行物理,处理射击,广播状态
    
    if (this.alive) {
      // 简化物理:WASD移动
      const speed = 5;
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      
      const mx = this.input.state.move.x;
      const mz = this.input.state.move.z;
      
      if (mx !== 0 || mz !== 0) {
        const move = new THREE.Vector3();
        move.add(forward.clone().multiplyScalar(-mz));
        move.add(right.clone().multiplyScalar(mx));
        move.normalize().multiplyScalar(speed * dt);
        this.pos.add(move);
        
        // 简化碰撞:保持在arena内
        const gh = this.colliders.groundHeight(this.pos.x, this.pos.z, 4, 0.5);
        this.pos.y = gh + 1.6;
        
        // 边界
        this.pos.x = THREE.MathUtils.clamp(this.pos.x, -35, 35);
        this.pos.z = THREE.MathUtils.clamp(this.pos.z, -45, 30);
      }
    }

    // 广播状态 (30Hz)
    const now = performance.now();
    if (now - this.lastStateTime > 33) {
      this.lastStateTime = now;
      this.broadcastState();
    }
  }

  private updateClient(dt: number, camera: THREE.Camera) {
    // 客户端:发送输入,接收状态
    
    if (this.alive) {
      // 本地预测移动(简化)
      const speed = 5;
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      
      const mx = this.input.state.move.x;
      const mz = this.input.state.move.z;
      
      if (mx !== 0 || mz !== 0) {
        const move = new THREE.Vector3();
        move.add(forward.clone().multiplyScalar(-mz));
        move.add(right.clone().multiplyScalar(mx));
        move.normalize().multiplyScalar(speed * dt);
        this.pos.add(move);
      }
    }

    // 发送输入 (60Hz)
    const now = performance.now();
    if (now - this.lastInputTime > 16) {
      this.lastInputTime = now;
      this.sendInput();
    }
  }

  private sendInput() {
    this.net.send({
      type: 'input',
      id: this.net.myId,
      pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
      yaw: this.yaw,
      pitch: this.pitch,
      moveX: this.input.state.move.x,
      moveZ: this.input.state.move.z,
      fire: this.input.state.fire,
    });
  }

  private broadcastState() {
    const players = [
      {
        id: this.net.myId,
        name: this.myName,
        team: this.myTeam,
        pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
        yaw: this.yaw,
        pitch: this.pitch,
        hp: this.hp,
        maxHp: this.maxHp,
        alive: this.alive,
        kills: this.kills,
        deaths: this.deaths,
        weapon: this.currentWeapon,
      },
      ...Array.from(this.remotePlayers.values()).map(rp => ({
        id: rp.id,
        name: rp.name,
        team: rp.team,
        pos: { x: rp.pos.x, y: rp.pos.y, z: rp.pos.z },
        yaw: rp.yaw,
        pitch: rp.pitch,
        hp: rp.hp,
        maxHp: rp.maxHp,
        alive: rp.alive,
        kills: 0, // MVP: 简化
        deaths: 0,
        weapon: rp.weapon,
      })),
    ];

    this.net.send({
      type: 'state',
      tick: Math.floor(this.matchTime * 60),
      players,
      redScore: this.redScore,
      blueScore: this.blueScore,
    });
  }

  shoot(origin: THREE.Vector3, dir: THREE.Vector3) {
    // 发送射击事件
    this.net.send({
      type: 'shoot',
      id: this.net.myId,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      dir: { x: dir.x, y: dir.y, z: dir.z },
    });

    // 主机处理命中
    if (this.isHost) {
      this.handleShoot(this.net.myId, origin, dir);
    }
  }

  private handleShoot(shooterId: string, origin: THREE.Vector3, dir: THREE.Vector3) {
    if (!this.isHost) return;

    // 简化射线检测:检查所有玩家
    for (const [id, rp] of this.remotePlayers) {
      if (!rp.alive || id === shooterId) continue;
      
      // 简单球形碰撞
      const dist = rp.pos.distanceTo(origin);
      if (dist < 20) {
        const toPlayer = new THREE.Vector3().subVectors(rp.pos, origin).normalize();
        const dot = toPlayer.dot(dir);
        if (dot > 0.98) { // ~11度
          // 命中!
          this.handleHit(id, 12); // 步枪伤害
          break;
        }
      }
    }
  }

  private handleHit(targetId: string, damage: number) {
    if (!this.isHost) return;

    const target = this.remotePlayers.get(targetId);
    if (!target || !target.alive) return;

    target.hp -= damage;
    if (target.hp <= 0) {
      target.alive = false;
      target.hp = 0;
      
      // 记录击杀
      this.kills++;
      if (this.myTeam === 'red') {
        this.redScore++;
      } else {
        this.blueScore++;
      }

      // 通知重生
      this.net.send({
        type: 'death',
        id: targetId,
      }, targetId);
    }
  }

  private handleMessage(msg: NetMessage) {
    switch (msg.type) {
      case 'ready':
        if (this.isHost) {
          // 客户端连接,添加到玩家列表
          const rp: RemotePlayer = {
            id: msg.id as string,
            name: msg.name as string,
            team: 'spectator',
            pos: new THREE.Vector3(),
            vel: new THREE.Vector3(),
            yaw: 0,
            pitch: 0,
            hp: 100,
            maxHp: 100,
            alive: false,
            mesh: this.createRemotePlayerMesh('spectator'),
            weapon: 'rifle',
          };
          this.remotePlayers.set(msg.id as string, rp);
          this.scene.add(rp.mesh!);
        }
        break;

      case 'team':
        const teamId = msg.id as string;
        const team = msg.team as Team;
        if (this.remotePlayers.has(teamId)) {
          const rp = this.remotePlayers.get(teamId)!;
          rp.team = team;
          // 更新颜色
          if (rp.mesh) {
            this.updatePlayerMeshColor(rp.mesh, team);
          }
        }
        break;

      case 'start':
        if (!this.isHost) {
          this.matchRunning = true;
          this.matchTime = 0;
          this.spawnPlayer();
        }
        break;

      case 'state':
        if (!this.isHost) {
          const players = msg.players as any[];
          for (const p of players) {
            if (p.id === this.net.myId) {
              // 服务器权威:更新本地位置
              this.pos.set(p.pos.x, p.pos.y, p.pos.z);
              this.yaw = p.yaw;
              this.pitch = p.pitch;
              this.hp = p.hp;
              this.alive = p.alive;
            } else {
              // 更新远程玩家
              let rp = this.remotePlayers.get(p.id);
              if (!rp) {
                rp = {
                  id: p.id,
                  name: p.name,
                  team: p.team,
                  pos: new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z),
                  vel: new THREE.Vector3(),
                  yaw: p.yaw,
                  pitch: p.pitch,
                  hp: p.hp,
                  maxHp: p.maxHp,
                  alive: p.alive,
                  mesh: this.createRemotePlayerMesh(p.team),
                  weapon: p.weapon,
                };
                this.remotePlayers.set(p.id, rp);
                this.scene.add(rp.mesh!);
              } else {
                rp.pos.set(p.pos.x, p.pos.y, p.pos.z);
                rp.yaw = p.yaw;
                rp.pitch = p.pitch;
                rp.hp = p.hp;
                rp.alive = p.alive;
                if (rp.mesh) {
                  rp.mesh.visible = rp.alive;
                }
              }
            }
          }
          this.redScore = msg.redScore as number;
          this.blueScore = msg.blueScore as number;
        }
        break;

      case 'input':
        if (this.isHost) {
          // 处理客户端输入
          const rp = this.remotePlayers.get(msg.id as string);
          if (rp && rp.alive) {
            // 简化:直接应用位置
            rp.pos.set((msg.pos as any).x, (msg.pos as any).y, (msg.pos as any).z);
            rp.yaw = msg.yaw as number;
            rp.pitch = msg.pitch as number;
          }
        }
        break;

      case 'shoot':
        if (this.isHost) {
          const origin = new THREE.Vector3((msg.origin as any).x, (msg.origin as any).y, (msg.origin as any).z);
          const dir = new THREE.Vector3((msg.dir as any).x, (msg.dir as any).y, (msg.dir as any).z);
          this.handleShoot(msg.id as string, origin, dir);
        }
        // 播放音效
        this.audio.play('rifle', { gain: 0.3 });
        break;

      case 'death':
        if (msg.id === this.net.myId) {
          this.alive = false;
          this.deaths++;
          this.respawnTimer = 5;
          this.audio.play('hurt', { gain: 0.8 });
        }
        break;
    }
  }

  private createRemotePlayerMesh(team: Team): THREE.Group {
    const g = new THREE.Group();
    
    // 简化雪人:头+身
    const headGeo = new THREE.SphereGeometry(0.3, 8, 6);
    const bodyGeo = new THREE.CylinderGeometry(0.35, 0.4, 1.2, 8);
    
    const color = team === 'red' ? PAL.red : team === 'blue' ? 0x4a90d7 : PAL.ink;
    const mat = new THREE.MeshBasicMaterial({ color, wireframe: true });
    
    const head = new THREE.Mesh(headGeo, mat);
    head.position.y = 1.5;
    g.add(head);
    
    const body = new THREE.Mesh(bodyGeo, mat);
    body.position.y = 0.7;
    g.add(body);
    
    return g;
  }

  private updatePlayerMeshColor(mesh: THREE.Group, team: Team) {
    const color = team === 'red' ? PAL.red : team === 'blue' ? 0x4a90d7 : PAL.ink;
    mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.MeshBasicMaterial).color.setHex(color);
      }
    });
  }

  getSpawnPoint(team: Team): THREE.Vector3 {
    if (team === 'red') {
      // 南侧
      return new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        0,
        25 + Math.random() * 3
      );
    } else {
      // 北侧 deck
      return new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        5,
        -42 + Math.random() * 3
      );
    }
  }

  cleanup() {
    this.matchRunning = false;
    for (const [, rp] of this.remotePlayers) {
      if (rp.mesh) {
        this.scene.remove(rp.mesh);
      }
    }
    this.remotePlayers.clear();
  }
}
