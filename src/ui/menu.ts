import { PAL } from '../render/palette';

export type MenuCallback = (action: 'solo' | 'createRoom' | 'joinRoom', data?: string) => void;

export class MainMenu {
  private container: HTMLDivElement;
  private callback: MenuCallback | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'main-menu';
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      background: #e8dcc4;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: 'Comic Sans MS', cursive, sans-serif;
      color: #29277f;
      z-index: 1000;
    `;

    this.container.innerHTML = `
      <h1 style="font-size: 48px; margin: 20px; text-align: center;">圆珠笔之战</h1>
      <div style="display: flex; gap: 20px; margin: 30px;">
        <button id="btn-solo" style="
          padding: 15px 30px;
          font-size: 20px;
          background: #29277f;
          color: #e8dcc4;
          border: 3px solid #29277f;
          cursor: pointer;
          font-family: inherit;
        ">单人波次</button>
        <button id="btn-pvp" style="
          padding: 15px 30px;
          font-size: 20px;
          background: #d7304a;
          color: #e8dcc4;
          border: 3px solid #d7304a;
          cursor: pointer;
          font-family: inherit;
        ">对战模式</button>
      </div>
      <div id="pvp-panel" style="display: none; flex-direction: column; gap: 15px; margin-top: 20px;">
        <button id="btn-create" style="
          padding: 12px 25px;
          font-size: 18px;
          background: #77c990;
          color: #29277f;
          border: 3px solid #29277f;
          cursor: pointer;
          font-family: inherit;
        ">创建房间</button>
        <div style="display: flex; gap: 10px; align-items: center;">
          <input id="input-code" type="text" placeholder="输入房间码" style="
            padding: 10px;
            font-size: 18px;
            border: 3px solid #29277f;
            background: white;
            font-family: inherit;
            text-transform: uppercase;
            width: 150px;
          " maxlength="6" />
          <button id="btn-join" style="
            padding: 10px 20px;
            font-size: 18px;
            background: #d7a049;
            color: #29277f;
            border: 3px solid #29277f;
            cursor: pointer;
            font-family: inherit;
          ">加入房间</button>
        </div>
        <button id="btn-back" style="
          padding: 8px 20px;
          font-size: 16px;
          background: transparent;
          color: #29277f;
          border: 2px solid #29277f;
          cursor: pointer;
          font-family: inherit;
        ">返回</button>
      </div>
      <div id="status-text" style="margin-top: 20px; font-size: 16px; color: #d7304a;"></div>
    `;

    document.body.appendChild(this.container);

    // 事件监听
    document.getElementById('btn-solo')!.addEventListener('click', () => this.onAction('solo'));
    document.getElementById('btn-pvp')!.addEventListener('click', () => this.showPvPPanel());
    document.getElementById('btn-create')!.addEventListener('click', () => this.onAction('createRoom'));
    document.getElementById('btn-join')!.addEventListener('click', () => {
      const code = (document.getElementById('input-code') as HTMLInputElement).value.trim().toUpperCase();
      if (code.length === 6) {
        this.onAction('joinRoom', code);
      } else {
        this.showStatus('请输入6位房间码');
      }
    });
    document.getElementById('btn-back')!.addEventListener('click', () => this.hidePvPPanel());
  }

  private showPvPPanel() {
    document.getElementById('pvp-panel')!.style.display = 'flex';
    (document.getElementById('btn-solo') as HTMLButtonElement).style.display = 'none';
    (document.getElementById('btn-pvp') as HTMLButtonElement).style.display = 'none';
  }

  private hidePvPPanel() {
    document.getElementById('pvp-panel')!.style.display = 'none';
    (document.getElementById('btn-solo') as HTMLButtonElement).style.display = 'inline-block';
    (document.getElementById('btn-pvp') as HTMLButtonElement).style.display = 'inline-block';
    this.showStatus('');
  }

  private onAction(action: 'solo' | 'createRoom' | 'joinRoom', data?: string) {
    if (this.callback) {
      this.callback(action, data);
    }
  }

  showStatus(text: string) {
    document.getElementById('status-text')!.textContent = text;
  }

  hide() {
    this.container.style.display = 'none';
  }

  show() {
    this.container.style.display = 'flex';
  }

  onMenuAction(cb: MenuCallback) {
    this.callback = cb;
  }

  destroy() {
    this.container.remove();
  }
}
