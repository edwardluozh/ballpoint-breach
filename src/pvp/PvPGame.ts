import * as THREE from 'three';
import { NetworkManager, type Team, type PlayerState, type NetMessage } from '../net/network';
import { Input } from '../core/input';
import type { Arena } from '../world/arena';
import type { AudioSystem } from '../audio/audio';

export class PvPGame {
  net: NetworkManager;
  myTeam: Team = 'spectator';
  myName: string;
  players = new Map<string, PlayerState>();
  isHost: boolean;
  
  // 游戏状态
  matchRunning = false;
  matchTime = 0;
  redScore = 0;
  blueScore = 0;

  constructor(
    net: NetworkManager,
    playerName: string,
    private arena: Arena,
    private audio: AudioSystem,
    private input: Input,
  ) {
    this.net = net;
    this.myName = playerName;
    this.isHost = net.isHost;

    // 设置网络消息回调
    this.net.onMessage = (msg) => this.handleMessage(msg);
  }

  changeTeam(team: Team) {
    this.myTeam = team;
    // 通知其他玩家
    this.net.send({ type: 'team', id: this.net.myId, team });
  }

  startMatch() {
    if (!this.isHost) return;
    
    this.matchRunning = true;
    this.matchTime = 0;
    this.redScore = 0;
    this.blueScore = 0;

    // 初始化所有玩家状态
    this.players.clear();
    
    // 通知所有客户端开始
    this.net.send({ type: 'start' });
  }

  update(dt: number, camera: THREE.Camera, playerPos: THREE.Vector3) {
    if (!this.matchRunning) return;

    this.matchTime += dt;

    // 如果是主机,更新游戏状态并广播
    if (this.isHost) {
      this.updateHost(dt);
    } else {
      this.updateClient(dt);
    }
  }

  private updateHost(dt: number) {
    // 主机权威:收集所有玩家输入,计算状态,广播
    // MVP: 简化版,只同步位置和射击
    
    // 广播状态 (30Hz)
    if (Math.random() < dt * 30) {
      const state = {
        type: 'state',
        tick: Math.floor(this.matchTime * 60),
        players: Array.from(this.players.entries()).map(([id, p]) => ({
          id,
          pos: p.pos,
          yaw: p.yaw,
          pitch: p.pitch,
          weapon: p.weapon,
          hp: p.hp,
          alive: p.alive,
          kills: p.kills,
          deaths: p.deaths,
        })),
        redScore: this.redScore,
        blueScore: this.blueScore,
      };
      this.net.send(state as NetMessage);
    }
  }

  private updateClient(dt: number) {
    // 客户端:发送输入,接收状态
    // MVP: 简化版
  }

  private handleMessage(msg: NetMessage) {
    switch (msg.type) {
      case 'team':
        // 玩家更换队伍
        if (this.isHost) {
          // 转发给其他客户端
          this.net.send(msg);
        }
        break;

      case 'start':
        this.matchRunning = true;
        this.matchTime = 0;
        break;

      case 'state':
        // 接收状态更新
        if (!this.isHost) {
          // 应用状态
          // MVP: 简化处理
        }
        break;

      case 'shoot':
        // 射击事件
        break;

      case 'hit':
        // 命中事件
        if (this.isHost) {
          // 处理伤害
        }
        break;
    }
  }

  getSpawnPoint(team: Team): THREE.Vector3 {
    // 团队出生点
    if (team === 'red') {
      // 南侧
      return new THREE.Vector3(0, 0, 28);
    } else {
      // 北侧
      return new THREE.Vector3(0, 5, -44);
    }
  }

  cleanup() {
    this.matchRunning = false;
    this.players.clear();
  }
}
