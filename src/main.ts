import './style.css';
import * as THREE from 'three';
import { Game } from './game';
import { Input } from './core/input';
import { MainMenu } from './ui/menu';
import { LobbyUI, type LobbyPlayer } from './ui/lobby';
import { NetworkManager } from './net/network';
import { PvPGame } from './pvp/PvPGame';

/* ---------- QA 参数 ---------- */
function qaParams() {
  const q = new URLSearchParams(location.search);
  return {
    capture: q.has('capture'),
    stress: q.has('stress'),
    ink: q.has('ink'),
    auto: q.has('auto'),
    view: q.get('view') ?? undefined,
  };
}

/* ---------- 错误可视化 ---------- */
const errBox = document.getElementById('error-box')!;
function showError(msg: string) {
  errBox.hidden = false;
  errBox.textContent += (errBox.textContent ? '\n' : '') + msg;
}
window.addEventListener('error', (e) => showError(`${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => showError(`promise: ${e.reason}`));

/* ---------- 启动 ---------- */
const sceneCanvas = document.getElementById('scene') as HTMLCanvasElement;
const hudCanvas = document.getElementById('hud') as HTMLCanvasElement;
const stageText = document.getElementById('stage-text')!;
const enterScreen = document.getElementById('enter-screen')!;
const pauseScreen = document.getElementById('pause-screen')!;

const input = new Input(sceneCanvas);
const qa = qaParams();
let game: Game | null = null;
let pvpGame: PvPGame | null = null;
let running = false;
let paused = false;
let lastT = performance.now();
let mode: 'solo' | 'pvp' = 'solo';

// 网络和大厅
let net: NetworkManager | null = null;
let lobby: LobbyUI | null = null;
let lobbyPlayers = new Map<string, LobbyPlayer>();

function setStage(s: string) { stageText.textContent = s; }

/* ---------- 菜单系统 ---------- */
let menu: MainMenu | null = null;

function initMenu() {
  menu = new MainMenu();
  menu.onMenuAction(async (action, data) => {
    try {
      if (action === 'solo') {
        mode = 'solo';
        menu!.hide();
        startSoloMode();
      } else if (action === 'createRoom') {
        mode = 'pvp';
        menu!.showStatus('正在创建房间...');
        net = new NetworkManager();
        const code = await net.createRoom('Player');
        menu!.hide();
        showLobby(code, true);
      } else if (action === 'joinRoom') {
        mode = 'pvp';
        menu!.showStatus('正在加入房间...');
        net = new NetworkManager();
        await net.joinRoom(data!, 'Player');
        menu!.hide();
        showLobby(data!, false);
      }
    } catch (err) {
      showError('网络错误: ' + err);
      menu!.showStatus('连接失败,请重试');
    }
  });
}

function startSoloMode() {
  // 原有单人模式
  if (!game) {
    game = new Game(sceneCanvas, hudCanvas, input, { qa, onStage: setStage });
    game.resize();
  }
  enterScreen.hidden = false;
  enterScreen.addEventListener('click', enterSoloGame, { once: true });
}

async function enterSoloGame() {
  if (!game) return;
  await game.audio.resumeIfNeeded();
  enterScreen.hidden = true;
  const ok = await input.requestLock();
  if (!ok) setStage('自由瞄准模式(无指针锁定)');
  input.enabled = true;
  running = true;
  lastT = performance.now();
}

function showLobby(code: string, isHost: boolean) {
  lobby = new LobbyUI(code, isHost, net!.myId);
  
  // 初始化本地玩家
  lobbyPlayers.set(net!.myId, {
    id: net!.myId,
    name: 'Player',
    team: 'spectator',
    ready: false,
  });
  
  // 如果是主机,添加自己到远程连接用于测试
  if (isHost) {
    net!.onMessage = (msg) => handleLobbyMessage(msg);
  } else {
    // 客户端:发送ready
    net!.send({ type: 'ready', id: net!.myId, name: 'Player' });
    net!.onMessage = (msg) => handleLobbyMessage(msg);
  }
  
  lobby.updateRoster(lobbyPlayers);
  
  lobby.onLobbyAction((action, data) => {
    if (action === 'team') {
      const myPlayer = lobbyPlayers.get(net!.myId)!;
      myPlayer.team = data!;
      lobbyPlayers.set(net!.myId, myPlayer);
      lobby!.updateRoster(lobbyPlayers);
      
      // 通知其他玩家
      net!.send({ type: 'team', id: net!.myId, name: 'Player', team: data });
    } else if (action === 'start' && isHost) {
      // 检查队伍
      const teams = Array.from(lobbyPlayers.values()).map(p => p.team);
      const hasRed = teams.includes('red');
      const hasBlue = teams.includes('blue');
      if (!hasRed || !hasBlue) {
        lobby!.showStatus('需要至少两个队伍才能开始');
        return;
      }
      
      // 开始对战
      startPvPMatch();
    } else if (action === 'leave') {
      // 返回菜单
      lobby!.destroy();
      lobby = null;
      if (net) {
        net.disconnect();
        net = null;
      }
      lobbyPlayers.clear();
      if (menu) {
        menu.show();
      }
    }
  });
}

function handleLobbyMessage(msg: any) {
  if (msg.type === 'ready' && net!.isHost) {
    // 新玩家连接
    lobbyPlayers.set(msg.id, {
      id: msg.id,
      name: msg.name,
      team: 'spectator',
      ready: true,
    });
    if (lobby) {
      lobby.updateRoster(lobbyPlayers);
    }
    
    // 转发给其他客户端
    net!.send(msg);
  } else if (msg.type === 'team') {
    // 队伍变更
    if (lobbyPlayers.has(msg.id)) {
      const p = lobbyPlayers.get(msg.id)!;
      p.team = msg.team;
      lobbyPlayers.set(msg.id, p);
      if (lobby) {
        lobby.updateRoster(lobbyPlayers);
      }
    }
  } else if (msg.type === 'start') {
    // 对战开始
    startPvPMatch();
  }
}

function startPvPMatch() {
  if (lobby) {
    lobby.hide();
  }
  
  // 初始化Game对象(用于arena和colliders)
  if (!game) {
    game = new Game(sceneCanvas, hudCanvas, input, { qa, onStage: setStage });
    game.resize();
  }
  
  // 创建PvP游戏实例
  const myTeam = lobbyPlayers.get(net!.myId)!.team;
  pvpGame = new PvPGame(
    net!,
    'Player',
    game.scene,
    game.arena,
    game.arena.colliders,
    game.audio,
    input,
  );
  pvpGame.myTeam = myTeam;
  
  // 启动游戏
  enterScreen.hidden = true;
  input.enabled = true;
  running = true;
  lastT = performance.now();
  
  // 开始对战
  if (net!.isHost) {
    pvpGame.startMatch();
  }
  
  // 锁定指针
  (async () => {
    await game!.audio.resumeIfNeeded();
    const ok = await input.requestLock();
    if (!ok) setStage('自由瞄准模式(无指针锁定)');
  })();
}

/* ---------- capture API ---------- */
const snapshots: string[] = [];
declare global {
  interface Window {
    __bb: {
      start(): void;
      snapshot(name?: string): Promise<{ name: string; dataUrl: string; w: number; h: number }>;
      capturePass(names: string[]): Promise<unknown[]>;
      state(): unknown;
    };
  }
}
window.__bb = {
  start() { running = true; lastT = performance.now(); },
  async snapshot(name = `snap_${snapshots.length}`) {
    game!.update(0);
    const dataUrl = sceneCanvas.toDataURL('image/png');
    const w = sceneCanvas.width, h = sceneCanvas.height;
    snapshots.push(dataUrl);
    return { name, dataUrl, w, h };
  },
  async capturePass(names: string[]) {
    const out = [];
    for (const n of names) out.push(await window.__bb.snapshot(n));
    return out;
  },
  state() { return { running, paused, t: game?.t, snapshots: snapshots.length }; },
};

/* ---------- 暂停 ---------- */
pauseScreen.addEventListener('click', async () => {
  paused = false; pauseScreen.hidden = true;
  const ok = await input.requestLock();
  if (!ok) input.fallbackAim = true;
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && running && !paused && mode === 'solo') {
    paused = true; pauseScreen.hidden = false; input.releaseLock();
  }
  if (e.code === 'KeyR' && game && (game.gameOver || game.victory)) {
    location.reload();
  }
});
sceneCanvas.addEventListener('click', () => {
  if (game && (game.gameOver || game.victory)) location.reload();
});

/* ---------- 主循环 ---------- */
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  
  if (running && !paused) {
    input.sample();
    
    if (mode === 'solo' && game) {
      game.update(dt);
    } else if (mode === 'pvp' && pvpGame && game) {
      // 更新yaw/pitch从input
      pvpGame.yaw += input.state.look.dx;
      pvpGame.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pvpGame.pitch + input.state.look.dy));
      
      // 处理射击
      if (input.state.firePressed && pvpGame.alive) {
        const origin = pvpGame.pos.clone();
        origin.y += 1.6;
        const dir = new THREE.Vector3(0, 0, -1);
        dir.applyAxisAngle(new THREE.Vector3(1, 0, 0), pvpGame.pitch);
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), pvpGame.yaw);
        pvpGame.shoot(origin, dir);
      }
      
      // PvP模式:更新PvP逻辑 + 渲染arena
      pvpGame.update(dt, game.camera);
      
      // 简化渲染:只更新camera位置
      game.camera.position.copy(pvpGame.pos);
      game.camera.position.y += 1.6;
      game.camera.rotation.order = 'YXZ';
      game.camera.rotation.y = pvpGame.yaw;
      game.camera.rotation.x = pvpGame.pitch;
      
      // 渲染场景
      game.renderer.render(game.scene, game.camera);
      
      // 简化HUD:只显示分数
      const ctx = hudCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
      ctx.font = '24px "Comic Sans MS"';
      ctx.fillStyle = '#29277f';
      ctx.fillText(`红队: ${pvpGame.redScore}  蓝队: ${pvpGame.blueScore}`, 30, 50);
      ctx.fillText(`HP: ${Math.ceil(pvpGame.hp)}  击杀: ${pvpGame.kills}`, 30, 90);
      ctx.fillText(`队伍: ${pvpGame.myTeam === 'red' ? '红队' : '蓝队'}`, 30, 130);
      if (!pvpGame.alive) {
        ctx.font = '48px "Comic Sans MS"';
        ctx.fillStyle = '#d7304a';
        ctx.textAlign = 'center';
        ctx.fillText(`重生中... ${Math.ceil(pvpGame.respawnTimer)}`, hudCanvas.width / 2, hudCanvas.height / 2);
        ctx.textAlign = 'left';
      }
    }
    
    input.endFrame();
  } else if (game) {
    game.update(0);
  }
}

window.addEventListener('resize', () => game?.resize());

// 启动
if (qa.capture || qa.auto) {
  // QA模式:直接进入单人
  mode = 'solo';
  startSoloMode();
  if (qa.auto) {
    enterSoloGame();
  }
} else {
  // 正常模式:显示菜单
  initMenu();
}

requestAnimationFrame(frame);
