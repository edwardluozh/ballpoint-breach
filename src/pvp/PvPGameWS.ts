// PvP Game - WebSocket + PlayerController integration
// Thin glue layer: uses existing PlayerController for local player

import * as THREE from 'three';
import type { MultiplayerClient } from '../net/ws-client';
import type { Input } from '../core/input';
import type { Game } from '../game';
import { PlayerController } from '../player/controller';
import { PAL } from '../render/palette';

interface RemotePlayer {
  id: string;
  name: string;
  team: 'red' | 'blue';
  mesh: THREE.Group;
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
}

export class PvPGameWS {
  net: MultiplayerClient;
  game: Game;
  myTeam: 'red' | 'blue' | 'spectator' = 'spectator';
  
  // Use real PlayerController for local player
  localController: PlayerController | null = null;
  
  // Local player state (HP/death tracked separately)
  myHp = 100;
  myMaxHp = 100;
  myAlive = true;
  
  // Remote players
  remotePlayers = new Map<string, RemotePlayer>();
  
  // Match state
  matchRunning = false;
  redScore = 0;
  blueScore = 0;
  kills = 0;
  deaths = 0;
  respawnTimer = 0;
  
  // Network timing
  private lastInputTime = 0;
  private lastStateTime = 0;

  constructor(
    net: MultiplayerClient,
    game: Game,
    myTeam: 'red' | 'blue' | 'spectator',
  ) {
    this.net = net;
    this.game = game;
    this.myTeam = myTeam;
    
    // Setup message handler
    this.net.onMessage = (msg) => this.handleMessage(msg);
  }

  addRemotePlayer(id: string, name: string, team: 'red' | 'blue') {
    if (this.remotePlayers.has(id)) return;
    
    const mesh = this.createRemotePlayerMesh(team);
    const rp: RemotePlayer = {
      id,
      name,
      team,
      mesh,
      pos: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      hp: 100,
      alive: false,
    };
    
    this.remotePlayers.set(id, rp);
    this.game.scene.add(mesh);
  }

  startMatch() {
    this.matchRunning = true;
    this.redScore = 0;
    this.blueScore = 0;
    this.kills = 0;
    this.deaths = 0;
    this.myHp = this.myMaxHp;
    this.myAlive = true;
    
    // Create local PlayerController
    const spawnPos = this.getSpawnPoint(this.myTeam);
    const spawnYaw = this.myTeam === 'red' ? 0 : Math.PI; // red faces north, blue faces south
    this.localController = new PlayerController(this.game.arena.colliders, this.game.input);
    this.localController.state.pos.copy(spawnPos);
    this.localController.state.yaw = spawnYaw;
    
    // Set all remote players alive
    for (const rp of this.remotePlayers.values()) {
      rp.alive = true;
      rp.mesh.visible = true;
    }
  }

  update(dt: number) {
    if (!this.matchRunning) return;

    // Update local player with PlayerController
    if (this.localController && this.myAlive) {
      this.localController.update(dt);
      
      // Send input to server (if not host) or broadcast state (if host)
      if (this.net.isHost) {
        this.updateHost(dt);
      } else {
        this.updateClient(dt);
      }
    }
    
    // Handle respawn
    if (!this.myAlive && this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.respawn();
      }
    }
    
    // Update remote player visuals
    for (const rp of this.remotePlayers.values()) {
      if (rp.alive && rp.mesh) {
        rp.mesh.position.copy(rp.pos);
        rp.mesh.rotation.y = rp.yaw;
        rp.mesh.visible = true;
      } else {
        rp.mesh.visible = false;
      }
    }
  }
  
  private respawn() {
    this.myHp = this.myMaxHp;
    this.myAlive = true;
    this.respawnTimer = 0;
    
    if (this.localController) {
      const spawnPos = this.getSpawnPoint(this.myTeam);
      this.localController.state.pos.copy(spawnPos);
      this.localController.state.vel.set(0, 0, 0);
    }
  }

  private updateHost(dt: number) {
    // Host: broadcast state to clients (20Hz)
    const now = performance.now();
    if (now - this.lastStateTime > 50) {
      this.lastStateTime = now;
      this.broadcastState();
    }
  }

  private updateClient(dt: number) {
    // Client: send input to host (30Hz)
    const now = performance.now();
    if (now - this.lastInputTime > 33) {
      this.lastInputTime = now;
      this.sendInput();
    }
  }

  private sendInput() {
    if (!this.localController) return;
    
    const s = this.localController.state;
    this.net.send({
      type: 'input',
      pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z },
      vel: { x: s.vel.x, y: s.vel.y, z: s.vel.z },
      yaw: s.yaw,
      pitch: s.pitch,
      hp: this.myHp,
      alive: this.myAlive,
    });
  }

  private broadcastState() {
    if (!this.localController) return;
    
    const s = this.localController.state;
    const players = [
      {
        id: this.net.myId,
        pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z },
        yaw: s.yaw,
        pitch: s.pitch,
        hp: this.myHp,
        alive: this.myAlive,
        team: this.myTeam,
      },
      ...Array.from(this.remotePlayers.values()).map(rp => ({
        id: rp.id,
        pos: { x: rp.pos.x, y: rp.pos.y, z: rp.pos.z },
        yaw: rp.yaw,
        pitch: rp.pitch,
        hp: rp.hp,
        alive: rp.alive,
        team: rp.team,
      })),
    ];
    
    this.net.send({
      type: 'state',
      players,
      redScore: this.redScore,
      blueScore: this.blueScore,
    });
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'state':
        // Receive state from host
        if (!this.net.isHost) {
          const players = msg.players as any[];
          for (const p of players) {
            if (p.id === this.net.myId) {
              // Server reconciliation for local player
              if (this.localController && Math.abs(p.pos.x - this.localController.state.pos.x) > 2) {
                this.localController.state.pos.set(p.pos.x, p.pos.y, p.pos.z);
              }
            } else {
              // Update remote player
              const rp = this.remotePlayers.get(p.id);
              if (rp) {
                rp.pos.set(p.pos.x, p.pos.y, p.pos.z);
                rp.yaw = p.yaw;
                rp.pitch = p.pitch;
                rp.hp = p.hp;
                rp.alive = p.alive;
              }
            }
          }
          this.redScore = msg.redScore;
          this.blueScore = msg.blueScore;
        }
        break;
        
      case 'clientInput':
        // Host receiving client input
        if (this.net.isHost) {
          const rp = this.remotePlayers.get(msg.playerId);
          if (rp) {
            rp.pos.set(msg.pos.x, msg.pos.y, msg.pos.z);
            rp.yaw = msg.yaw;
            rp.pitch = msg.pitch;
            rp.hp = msg.hp;
            rp.alive = msg.alive;
          }
        }
        break;
        
      case 'clientShoot':
        // Host processing client shoot
        if (this.net.isHost) {
          // TODO: Process hitscan, damage, etc.
        }
        break;
    }
  }

  private createRemotePlayerMesh(team: 'red' | 'blue'): THREE.Group {
    const g = new THREE.Group();
    
    // Simple snowman: head + body
    const headGeo = new THREE.SphereGeometry(0.3, 8, 6);
    const bodyGeo = new THREE.CylinderGeometry(0.35, 0.4, 1.2, 8);
    
    const color = team === 'red' ? PAL.red : 0x4a90d7; // blue
    const mat = new THREE.MeshBasicMaterial({ color, wireframe: true });
    
    const head = new THREE.Mesh(headGeo, mat);
    head.position.y = 1.5;
    g.add(head);
    
    const body = new THREE.Mesh(bodyGeo, mat);
    body.position.y = 0.7;
    g.add(body);
    
    return g;
  }

  private getSpawnPoint(team: 'red' | 'blue' | 'spectator'): THREE.Vector3 {
    if (team === 'red') {
      return new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        0,
        25 + Math.random() * 3
      );
    } else if (team === 'blue') {
      return new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        5,
        -42 + Math.random() * 3
      );
    }
    return new THREE.Vector3(0, 0, 0);
  }

  getCamera(): THREE.Camera {
    if (this.localController) {
      // Update game camera to match PlayerController
      const s = this.localController.state;
      this.game.camera.position.set(s.pos.x, s.pos.y + 1.58, s.pos.z);
      this.game.camera.rotation.order = 'YXZ';
      this.game.camera.rotation.y = s.yaw;
      this.game.camera.rotation.x = s.pitch;
    }
    return this.game.camera;
  }

  cleanup() {
    this.matchRunning = false;
    for (const rp of this.remotePlayers.values()) {
      this.game.scene.remove(rp.mesh);
    }
    this.remotePlayers.clear();
    this.localController = null;
  }
}
