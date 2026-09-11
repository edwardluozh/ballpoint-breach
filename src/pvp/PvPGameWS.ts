// PvP Game - WebSocket + PlayerController + WeaponSystem integration
// Uses existing PlayerController for local player movement/look
// Uses WeaponSystem for shooting (same as single-player)

import * as THREE from 'three';
import type { MultiplayerClient } from '../net/ws-client';
import type { Input } from '../core/input';
import type { Game } from '../game';
import { PlayerController } from '../player/controller';
import { WeaponSystem } from '../weapons/system';
import { PAL } from '../render/palette';
import { buildNpcModel, animateNpc, type NpcModelParts } from '../enemies/npcModel';

interface RemotePlayer {
  id: string;
  name: string;
  team: 'red' | 'blue';
  model: NpcModelParts;
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  gait: number;
}

export class PvPGameWS {
  net: MultiplayerClient;
  game: Game;
  myTeam: 'red' | 'blue' | 'spectator' = 'spectator';
  
  // Use real PlayerController for local player
  localController: PlayerController | null = null;
  
  // Use WeaponSystem for shooting (same as single-player)
  weapons: WeaponSystem | null = null;
  
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
    
    // Use NPC-style model for remote players
    const variantSeed = parseInt(id.slice(0, 8), 16) || Math.random() * 1000;
    const model = buildNpcModel(variantSeed, 'grunt'); // All use grunt model
    
    // Tint based on team
    const teamColor = team === 'red' ? PAL.red : 0x4a90d7;
    model.group.traverse((obj: any) => {
      if (obj.material) {
        if (obj.material.color) {
          obj.material = obj.material.clone();
          obj.material.color.set(teamColor);
        }
      }
    });
    
    const rp: RemotePlayer = {
      id,
      name,
      team,
      model,
      pos: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      hp: 100,
      alive: false,
      gait: 0,
    };
    
    this.remotePlayers.set(id, rp);
    this.game.scene.add(model.group);
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
    const spawnYaw = this.myTeam === 'red' ? 0 : Math.PI;
    this.localController = new PlayerController(this.game.arena.colliders, this.game.input);
    this.localController.state.pos.copy(spawnPos);
    this.localController.state.yaw = spawnYaw;
    
    // Create WeaponSystem for shooting
    this.weapons = new WeaponSystem({
      camera: this.game.camera,
      input: this.game.input,
      colliders: this.game.arena.colliders,
      enemies: [], // No NPCs in PvP
      em: this.game.em,
      fx: this.game.fx,
      barricades: [],
      playerPos: this.localController.state.pos,
      grappleAnchors: [],
      boss: null,
      audio: this.game.audio,
    });
    this.game.scene.add(this.weapons.object);
    
    // Set all remote players alive
    for (const rp of this.remotePlayers.values()) {
      rp.alive = true;
      rp.model.group.visible = true;
    }
  }

  update(dt: number) {
    if (!this.matchRunning) return;

    // Update local player with PlayerController
    if (this.localController && this.myAlive) {
      this.localController.update(dt);
      
      // Update weapon system
      if (this.weapons) {
        // Update playerPos reference for weapon system
        this.weapons.update(dt, this.localController.state.gaitPhase, this.localController.state.sprinting);
        
        // Check for local player shooting (send to server)
        if (this.game.input.state.firePressed || this.game.input.state.fire) {
          this.sendShoot();
        }
      }
      
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
      if (rp.alive && rp.model) {
        rp.model.group.position.copy(rp.pos);
        rp.model.group.rotation.y = rp.yaw;
        rp.model.group.visible = true;
        
        // Animate remote player (simple walking)
        const speed = 0.3; // Approximate speed
        animateNpc(rp.model, rp.gait, speed, 0, 0);
        rp.gait += dt * 2;
      } else {
        rp.model.group.visible = false;
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
  
  private sendShoot() {
    if (!this.localController || !this.weapons) return;
    
    // Send shoot event with aim direction
    const eyePos = this.localController.eyePos();
    const lookDir = this.localController.lookDir();
    
    const shootData = {
      origin: { x: eyePos.x, y: eyePos.y, z: eyePos.z },
      dir: { x: lookDir.x, y: lookDir.y, z: lookDir.z },
      weaponId: this.weapons.current,
      damage: this.weapons.def.damage,
    };
    
    // If host, process hit detection locally (host-authoritative)
    if (this.net.isHost) {
      this.processHostShoot(shootData.origin, shootData.dir, shootData.damage);
    }
    
    // Send to server for broadcast/forwarding
    this.net.send({
      type: 'shoot',
      ...shootData,
    });
  }
  
  // Host-authoritative hit detection for local host shots
  private processHostShoot(originData: any, dirData: any, damage: number) {
    const origin = new THREE.Vector3(originData.x, originData.y, originData.z);
    const dir = new THREE.Vector3(dirData.x, dirData.y, dirData.z).normalize();
    
    // Check all remote players (host cannot damage self)
    for (const [id, rp] of this.remotePlayers) {
      if (!rp.alive) continue;
      const dist = this.raycastPlayer(origin, dir, rp.pos);
      if (dist !== null && dist < 100) {
        rp.hp -= damage;
        if (rp.hp <= 0) {
          rp.alive = false;
          this.kills++; // Host got a kill
          // Broadcast kill to all clients
          this.net.send({ type: 'kill', victim: id, killer: this.net.myId });
        }
        break; // Only hit first player in ray path
      }
    }
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
        // Host processing client shoot (hitscan check)
        if (this.net.isHost) {
          const shooter = this.remotePlayers.get(msg.playerId);
          if (!shooter || !shooter.alive) break;
          
          // Check if ray hits any player
          const origin = new THREE.Vector3(msg.origin.x, msg.origin.y, msg.origin.z);
          const dir = new THREE.Vector3(msg.dir.x, msg.dir.y, msg.dir.z).normalize();
          
          // Check local player (host) hit by remote shooter
          if (this.myAlive && this.localController) {
            const dist = this.raycastPlayer(origin, dir, this.localController.state.pos);
            if (dist !== null && dist < 100) {
              this.myHp -= msg.damage || 10;
              if (this.myHp <= 0) {
                this.myAlive = false;
                this.respawnTimer = 5;
                this.deaths++;
                // Notify shooter of kill
                this.net.send({ type: 'kill', victim: this.net.myId, killer: msg.playerId });
              }
              break; // Hit, stop checking
            }
          }
          
          // Check other remote players hit by remote shooter
          for (const [id, rp] of this.remotePlayers) {
            if (id === msg.playerId || !rp.alive) continue;
            const dist = this.raycastPlayer(origin, dir, rp.pos);
            if (dist !== null && dist < 100) {
              rp.hp -= msg.damage || 10;
              if (rp.hp <= 0) {
                rp.alive = false;
                // Notify of kill
                this.net.send({ type: 'kill', victim: id, killer: msg.playerId });
              }
              break; // Hit, stop checking
            }
          }
        }
        break;
        
      case 'kill':
        // Someone got killed
        if (msg.killer === this.net.myId) {
          this.kills++;
        }
        if (msg.victim === this.net.myId) {
          this.myAlive = false;
          this.respawnTimer = 5;
          this.deaths++;
        }
        break;
    }
  }

  
  // Simple raycast to check if ray hits player capsule
  private raycastPlayer(origin: THREE.Vector3, dir: THREE.Vector3, playerPos: THREE.Vector3): number | null {
    // Simple cylinder check: player is ~0.4 radius, 1.75 tall
    const radius = 0.4;
    const height = 1.75;
    
    // Check ray-capsule intersection (simplified)
    const toPlayer = new THREE.Vector3().subVectors(playerPos, origin);
    const along = toPlayer.dot(dir);
    if (along < 0) return null; // Behind
    
    const closest = origin.clone().addScaledVector(dir, along);
    const playerCenter = playerPos.clone().add(new THREE.Vector3(0, height / 2, 0));
    const distToAxis = closest.distanceTo(playerCenter);
    
    if (distToAxis < radius && along < 100) {
      return along;
    }
    return null;
  }

  private createRemotePlayerMesh(team: 'red' | 'blue'): THREE.Group {
    // Deprecated - now using buildNpcModel
    const g = new THREE.Group();
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
      this.game.scene.remove(rp.model.group);
    }
    this.remotePlayers.clear();
    this.localController = null;
    if (this.weapons) {
      this.game.scene.remove(this.weapons.object);
      this.weapons = null;
    }
  }
}
