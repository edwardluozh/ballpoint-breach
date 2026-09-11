// WebSocket client for Cloudflare Worker + Durable Object multiplayer

export type Team = 'spectator' | 'red' | 'blue';

export interface WSMessage {
  type: string;
  [key: string]: any;
}

export type MessageCallback = (msg: WSMessage) => void;

export interface LobbyPlayer {
  id: string;
  name: string;
  team: Team;
  ready: boolean;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  
  myId: string = '';
  isHost: boolean = false;
  roomCode: string = '';
  onMessage: MessageCallback | null = null;
  
  private reconnectTimer: number | null = null;
  private messageQueue: WSMessage[] = [];

  constructor(wsUrl?: string) {
    // Default to local dev, can be overridden by env var
    this.wsUrl = wsUrl || import.meta.env.VITE_MP_WS_URL || 'ws://localhost:8787';
  }

  async createRoom(playerName: string): Promise<string> {
    // Get room code from worker
    const createUrl = this.wsUrl.replace(/^ws/, 'http') + '/create';
    const res = await fetch(createUrl);
    if (!res.ok) throw new Error('Failed to create room');
    
    const { code } = await res.json();
    
    // Connect to room
    await this.connect(code, playerName);
    
    return code;
  }

  async joinRoom(code: string, playerName: string): Promise<void> {
    await this.connect(code, playerName);
  }

  private async connect(code: string, playerName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.wsUrl}/room?code=${code}`;
      this.ws = new WebSocket(url);
      this.roomCode = code;

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        // Send hello
        this.send({ type: 'hello', name: playerName });
        
        // Flush queued messages
        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift()!;
          this.send(msg);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          // Handle welcome message
          if (msg.type === 'welcome') {
            this.myId = msg.playerId;
            this.isHost = msg.isHost;
            this.roomCode = msg.roomCode;
            resolve();
          }
          
          // Forward to callback
          if (this.onMessage) {
            this.onMessage(msg);
          }
        } catch (err) {
          console.error('Message parse error:', err);
        }
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        reject(err);
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.attemptReconnect();
      };
    });
  }

  private attemptReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = window.setTimeout(() => {
      console.log('Attempting reconnect...');
      this.reconnectTimer = null;
      // Note: Reconnect logic would need player name stored
    }, 3000);
  }

  send(msg: WSMessage, targetId?: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Queue message if not connected
      this.messageQueue.push(msg);
      return;
    }

    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error('Send failed:', err);
      this.messageQueue.push(msg);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.send({ type: 'leave' });
      this.ws.close();
      this.ws = null;
    }
  }
}
