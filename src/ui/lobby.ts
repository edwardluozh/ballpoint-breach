import type { Team } from '../net/network';

export interface LobbyPlayer {
  id: string;
  name: string;
  team: Team;
  ready: boolean;
}

export type LobbyCallback = (action: 'team' | 'ready' | 'start' | 'leave', data?: Team) => void;

export class LobbyUI {
  private container: HTMLDivElement;
  private callback: LobbyCallback | null = null;
  private isHost = false;
  private myId = '';

  constructor(roomCode: string, isHost: boolean, myId: string) {
    this.isHost = isHost;
    this.myId = myId;
    this.container = document.createElement('div');
    this.container.id = 'lobby';
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      background: #e8dcc4;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px;
      font-family: 'Comic Sans MS', cursive, sans-serif;
      color: #29277f;
      z-index: 999;
      overflow-y: auto;
    `;

    this.container.innerHTML = `
      <h2 style="font-size: 36px; margin-bottom: 10px;">对战大厅</h2>
      <div style="font-size: 24px; margin-bottom: 30px; background: white; padding: 10px 20px; border: 3px solid #29277f;">
        房间码: <strong>${roomCode}</strong>
      </div>
      
      <div style="display: flex; gap: 15px; margin-bottom: 30px;">
        <button id="btn-red" style="
          padding: 15px 40px;
          font-size: 20px;
          background: #d7304a;
          color: white;
          border: 3px solid #29277f;
          cursor: pointer;
          font-family: inherit;
        ">加入红队</button>
        <button id="btn-blue" style="
          padding: 15px 40px;
          font-size: 20px;
          background: #4a90d7;
          color: white;
          border: 3px solid #29277f;
          cursor: pointer;
          font-family: inherit;
        ">加入蓝队</button>
      </div>

      <div style="display: flex; gap: 40px; width: 100%; max-width: 800px; margin-bottom: 30px;">
        <div style="flex: 1; background: rgba(215,48,74,0.2); padding: 20px; border: 3px solid #d7304a;">
          <h3 style="margin: 0 0 15px 0; font-size: 24px;">红队</h3>
          <div id="red-roster" style="font-size: 18px;"></div>
        </div>
        <div style="flex: 1; background: rgba(74,144,215,0.2); padding: 20px; border: 3px solid #4a90d7;">
          <h3 style="margin: 0 0 15px 0; font-size: 24px;">蓝队</h3>
          <div id="blue-roster" style="font-size: 18px;"></div>
        </div>
      </div>

      <div style="display: flex; gap: 15px;">
        ${isHost ? `
          <button id="btn-start" style="
            padding: 15px 40px;
            font-size: 22px;
            background: #77c990;
            color: #29277f;
            border: 3px solid #29277f;
            cursor: pointer;
            font-family: inherit;
          ">开始对战</button>
        ` : ''}
        <button id="btn-leave" style="
          padding: 15px 40px;
          font-size: 22px;
          background: transparent;
          color: #29277f;
          border: 3px solid #29277f;
          cursor: pointer;
          font-family: inherit;
        ">离开房间</button>
      </div>

      <div id="lobby-status" style="margin-top: 20px; font-size: 16px; color: #d7304a;"></div>
    `;

    document.body.appendChild(this.container);

    // 事件监听
    document.getElementById('btn-red')!.addEventListener('click', () => this.onAction('team', 'red'));
    document.getElementById('btn-blue')!.addEventListener('click', () => this.onAction('team', 'blue'));
    document.getElementById('btn-leave')!.addEventListener('click', () => this.onAction('leave'));
    if (isHost) {
      document.getElementById('btn-start')!.addEventListener('click', () => this.onAction('start'));
    }
  }

  updateRoster(players: Map<string, LobbyPlayer>) {
    const redDiv = document.getElementById('red-roster')!;
    const blueDiv = document.getElementById('blue-roster')!;
    
    redDiv.innerHTML = '';
    blueDiv.innerHTML = '';

    for (const [id, p] of players) {
      const item = document.createElement('div');
      item.style.cssText = 'margin: 5px 0; padding: 5px;';
      const isMe = id === this.myId;
      item.textContent = `${p.name}${isMe ? ' (我)' : ''}`;
      
      if (p.team === 'red') {
        redDiv.appendChild(item);
      } else if (p.team === 'blue') {
        blueDiv.appendChild(item);
      }
    }

    if (redDiv.innerHTML === '') redDiv.innerHTML = '<div style="opacity:0.5;">无队员</div>';
    if (blueDiv.innerHTML === '') blueDiv.innerHTML = '<div style="opacity:0.5;">无队员</div>';
  }

  showStatus(text: string) {
    document.getElementById('lobby-status')!.textContent = text;
  }

  private onAction(action: 'team' | 'ready' | 'start' | 'leave', data?: Team) {
    if (this.callback) {
      this.callback(action, data);
    }
  }

  onLobbyAction(cb: LobbyCallback) {
    this.callback = cb;
  }

  hide() {
    this.container.style.display = 'none';
  }

  destroy() {
    this.container.remove();
  }
}
