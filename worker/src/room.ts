// Ballpoint Breach - Multiplayer Room (Durable Object)
// Host-authoritative WebSocket server

interface Player {
  id: string;
  name: string;
  team: 'spectator' | 'red' | 'blue';
  ws: WebSocket | null;
  ready: boolean;
}

interface PlayerState {
  id: string;
  pos: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  team: 'red' | 'blue' | 'spectator';
}

export class GameRoom {
  state: DurableObjectState;
  env: any;
  
  players = new Map<string, Player>();
  hostId: string | null = null;
  matchRunning = false;
  roomCode: string = '';
  
  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    // WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // Get room code from URL
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    if (!code || code.length !== 6) {
      return new Response('Invalid room code', { status: 400 });
    }

    this.roomCode = code;

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept WebSocket
    server.accept();
    
    // Generate player ID
    const playerId = crypto.randomUUID();
    
    // Add player (pending hello)
    const player: Player = {
      id: playerId,
      name: 'Player',
      team: 'spectator',
      ws: server,
      ready: false,
    };
    this.players.set(playerId, player);

    // Set as host if first player
    if (!this.hostId) {
      this.hostId = playerId;
    }

    // Send player their ID
    this.send(server, {
      type: 'welcome',
      playerId,
      isHost: playerId === this.hostId,
      roomCode: this.roomCode,
    });

    // Handle messages
    server.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        this.handleMessage(playerId, msg);
      } catch (err) {
        console.error('Message parse error:', err);
      }
    });

    // Handle close
    server.addEventListener('close', () => {
      this.handleDisconnect(playerId);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private handleMessage(playerId: string, msg: any) {
    const player = this.players.get(playerId);
    if (!player) return;

    switch (msg.type) {
      case 'hello':
        player.name = msg.name || 'Player';
        player.ready = true;
        this.broadcastRoster();
        break;

      case 'team':
        if (msg.team === 'red' || msg.team === 'blue' || msg.team === 'spectator') {
          player.team = msg.team;
          this.broadcastRoster();
        }
        break;

      case 'start':
        if (playerId === this.hostId && !this.matchRunning) {
          // Check teams
          const teams = Array.from(this.players.values()).map(p => p.team);
          if (!teams.includes('red') || !teams.includes('blue')) {
            this.send(player.ws!, { type: 'error', message: 'Need red and blue teams' });
            return;
          }
          this.matchRunning = true;
          this.broadcast({ type: 'start' });
        }
        break;

      case 'input':
        // Forward input to host for processing
        if (playerId !== this.hostId && this.hostId) {
          const host = this.players.get(this.hostId);
          if (host?.ws) {
            this.send(host.ws, { type: 'clientInput', playerId, ...msg });
          }
        }
        break;

      case 'state':
        // Host broadcasting game state
        if (playerId === this.hostId) {
          this.broadcast(msg, playerId);
        }
        break;

      case 'shoot':
        // Forward to host
        if (playerId !== this.hostId && this.hostId) {
          const host = this.players.get(this.hostId);
          if (host?.ws) {
            this.send(host.ws, { type: 'clientShoot', playerId, ...msg });
          }
        }
        break;

      case 'event':
        // Host sending event (death, etc)
        if (playerId === this.hostId) {
          this.broadcast(msg, playerId);
        }
        break;

      case 'leave':
        this.handleDisconnect(playerId);
        break;
    }
  }

  private handleDisconnect(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Close WebSocket
    if (player.ws) {
      try {
        player.ws.close();
      } catch (e) {}
    }

    // Remove player
    this.players.delete(playerId);

    // If host left, assign new host
    if (playerId === this.hostId) {
      const remaining = Array.from(this.players.keys());
      this.hostId = remaining.length > 0 ? remaining[0] : null;
      
      if (this.hostId) {
        const newHost = this.players.get(this.hostId)!;
        this.send(newHost.ws!, { type: 'promoted', isHost: true });
      }
    }

    // Broadcast updated roster
    this.broadcastRoster();

    // If no players left, room will eventually be cleaned up
  }

  private broadcastRoster() {
    const roster = Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      team: p.team,
      ready: p.ready,
    }));

    this.broadcast({
      type: 'roster',
      players: roster,
      hostId: this.hostId,
    });
  }

  private broadcast(msg: any, excludeId?: string) {
    const data = JSON.stringify(msg);
    for (const [id, player] of this.players) {
      if (id !== excludeId && player.ws) {
        try {
          player.ws.send(data);
        } catch (e) {
          console.error('Send failed:', e);
        }
      }
    }
  }

  private send(ws: WebSocket, msg: any) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      console.error('Send failed:', e);
    }
  }
}
