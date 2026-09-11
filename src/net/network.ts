import Peer, { type DataConnection } from 'peerjs';

export type Team = 'red' | 'blue' | 'spectator';

export interface PlayerState {
  id: string;
  name: string;
  team: Team;
  pos: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  weapon: string;
  hp: number;
  maxHp: number;
  alive: boolean;
  kills: number;
  deaths: number;
}

export interface NetMessage {
  type: 'ready' | 'lobby' | 'team' | 'start' | 'state' | 'input' | 'shoot' | 'hit' | 'death' | 'end';
  [key: string]: unknown;
}

export interface LobbyState {
  players: Map<string, { name: string; team: Team; ready: boolean }>;
  hostId: string;
}

export interface GameState {
  tick: number;
  players: Map<string, PlayerState>;
  matchTime: number;
  redScore: number;
  blueScore: number;
}

export type NetworkCallback = (msg: NetMessage) => void;

export class NetworkManager {
  peer: Peer | null = null;
  connections = new Map<string, DataConnection>();
  isHost = false;
  hostId = '';
  myId = '';
  roomCode = '';
  onMessage: NetworkCallback | null = null;

  async createRoom(playerName: string): Promise<string> {
    // 生成6位房间码
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.roomCode = code;
    this.peer = new Peer(`bp-${code}`, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });

    return new Promise((resolve, reject) => {
      this.peer!.on('open', (id) => {
        this.myId = id;
        this.hostId = id;
        this.isHost = true;
        console.log('[NET] Room created:', code, 'peer:', id);
        resolve(code);
      });

      this.peer!.on('connection', (conn) => {
        this.handleConnection(conn);
      });

      this.peer!.on('error', (err) => {
        console.error('[NET] Peer error:', err);
        reject(err);
      });
    });
  }

  async joinRoom(code: string, playerName: string): Promise<void> {
    this.roomCode = code;
    this.peer = new Peer({
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });

    return new Promise((resolve, reject) => {
      this.peer!.on('open', (id) => {
        this.myId = id;
        this.hostId = `bp-${code}`;
        this.isHost = false;
        console.log('[NET] Joining room:', code, 'my peer:', id);

        const conn = this.peer!.connect(this.hostId);
        this.handleConnection(conn);

        conn.on('open', () => {
          console.log('[NET] Connected to host');
          conn.send({ type: 'ready', name: playerName });
          resolve();
        });

        setTimeout(() => reject(new Error('连接超时')), 10000);
      });

      this.peer!.on('error', (err) => {
        console.error('[NET] Peer error:', err);
        reject(err);
      });
    });
  }

  private handleConnection(conn: DataConnection) {
    conn.on('open', () => {
      console.log('[NET] Connection opened:', conn.peer);
      this.connections.set(conn.peer, conn);
    });

    conn.on('data', (data) => {
      if (this.onMessage) {
        this.onMessage(data as NetMessage);
      }
    });

    conn.on('close', () => {
      console.log('[NET] Connection closed:', conn.peer);
      this.connections.delete(conn.peer);
    });

    conn.on('error', (err) => {
      console.error('[NET] Connection error:', err);
      this.connections.delete(conn.peer);
    });
  }

  send(msg: NetMessage, target?: string) {
    if (target) {
      const conn = this.connections.get(target);
      if (conn && conn.open) {
        conn.send(msg);
      }
    } else {
      // 广播给所有连接
      for (const conn of this.connections.values()) {
        if (conn.open) {
          conn.send(msg);
        }
      }
    }
  }

  disconnect() {
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
