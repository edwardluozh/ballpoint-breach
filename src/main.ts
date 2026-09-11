import './style.css';
import * as THREE from 'three';
import { Game } from './game';
import { Input } from './core/input';
import { MainMenu } from './ui/menu';
import { LobbyUI, type LobbyPlayer } from './ui/lobby';
import { MultiplayerClient } from './net/ws-client';
import { PvPGameWS } from './pvp/PvPGameWS';

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
let pvpGame: PvPGameWS | null = null;
let running = false;
let paused = false;
let lastT = performance.now();
let mode: 'solo' | 'pvp' = 'solo';

// 网络和大厅
let net: MultiplayerClient | null = null;
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
        net = new MultiplayerClient();
        const code = await net.createRoom('Player');
        menu!.hide();
        showLobby(code, net.isHost);
      } else if (action === 'joinRoom') {
        mode = 'pvp';
        menu!.showStatus('正在加入房间...');
        net = new MultiplayerClient();
        await net.joinRoom(data!, 'Player');
        menu!.hide();
        showLobby(data!, net.isHost);
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

function setupLobbyActions() {
  if (!lobby) return;
  
  lobby.onLobbyAction((action, data) => {
    if (action === 'team') {
      // 通知服务器队伍变更
      net!.send({ type: 'team', team: data });
    } else if (action === 'start' && net!.isHost) {
      // 检查队伍
      const teams = Array.from(lobbyPlayers.values()).map(p => p.team);
      const hasRed = teams.includes('red');
      const hasBlue = teams.includes('blue');
      if (!hasRed || !hasBlue) {
        lobby!.showStatus('需要至少两个队伍才能开始');
        return;
      }
      
      // 通知服务器开始对战
      net!.send({ type: 'start' });
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

function showLobby(code: string, isHost: boolean) {
  lobby = new LobbyUI(code, isHost, net!.myId);
  
  // 设置消息处理
  net!.onMessage = (msg) => handleLobbyMessage(msg);
  
  // 等待服务器的roster消息
  lobby.updateRoster(lobbyPlayers);
  
  setupLobbyActions();
}

function handleLobbyMessage(msg: any) {
  if (msg.type === 'roster') {
    // 服务器发送的完整名单
    lobbyPlayers.clear();
    const players = msg.players as Array<{ id: string; name: string; team: any; ready: boolean }>;
    for (const p of players) {
      lobbyPlayers.set(p.id, p);
    }
    if (lobby) {
      lobby.updateRoster(lobbyPlayers);
    }
  } else if (msg.type === 'start') {
    // 对战开始
    startPvPMatch();
  } else if (msg.type === 'promoted') {
    // 被提升为host
    if (lobby) {
      lobby.destroy();
      lobby = new LobbyUI(net!.roomCode, true, net!.myId);
      lobby.updateRoster(lobbyPlayers);
      // 重新绑定lobby actions
      setupLobbyActions();
    }
  } else if (msg.type === 'error') {
    if (lobby) {
      lobby.showStatus(msg.message || '错误');
    }
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
  pvpGame = new PvPGameWS(net!, game, myTeam as 'red' | 'blue' | 'spectator');
  
  // 初始化远程玩家(从lobby名单)
  for (const [id, player] of lobbyPlayers) {
    if (id !== net!.myId && (player.team === 'red' || player.team === 'blue')) {
      pvpGame.addRemotePlayer(id, player.name, player.team);
    }
  }
  
  // 启动游戏
  enterScreen.hidden = true;
  input.enabled = true;
  running = true;
  lastT = performance.now();
  
  // 开始对战
  pvpGame.startMatch();
  
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
      // PvP uses PlayerController - just update and render
      pvpGame.update(dt);
      
      // Use camera from PlayerController
      const camera = pvpGame.getCamera();
      game.renderer.render(game.scene, camera);
      
      // Use real HUD with crosshair
      const hudState = {
        score: 0,
        combo: 0,
        wave: 0,
        enemiesLeft: 0,
        intermission: 0,
        hp: pvpGame.myHp,
        hpMax: pvpGame.myMaxHp,
        ammo: pvpGame.weapons ? pvpGame.weapons.hudAmmo : { inMag: 0, reserve: 0 },
        current: pvpGame.weapons ? pvpGame.weapons.current : 'rifle' as any,
        ammoAll: pvpGame.weapons ? {
          rifle: pvpGame.weapons.ammoFor('rifle'),
          pistol: pvpGame.weapons.ammoFor('pistol'),
          shotgun: pvpGame.weapons.ammoFor('shotgun'),
          sniper: pvpGame.weapons.ammoFor('sniper'),
          katana: pvpGame.weapons.ammoFor('katana'),
        } : {} as any,
        reloading: pvpGame.weapons ? pvpGame.weapons.reloading : false,
        hint: '',
        banner: null,
        killFeed: [],
        hurt: 0,
        hurtDirAngle: 0,
        blocking: false,
        stamina: pvpGame.weapons ? pvpGame.weapons.stamina : 100,
        ads: pvpGame.weapons ? pvpGame.weapons.isADS : false,
        boss: null,
        gameOver: false,
        victory: false,
        katanaPhase: 'idle',
        reticleSpread: 'idle' as any,
      };
      game.hud.draw(hudState);
      
      // Additional PvP info overlay
      const ctx = hudCanvas.getContext('2d')!;
      ctx.font = '24px "Comic Sans MS"';
      ctx.fillStyle = '#29277f';
      ctx.fillText(`红队: ${pvpGame.redScore}  蓝队: ${pvpGame.blueScore}`, 30, hudCanvas.height - 120);
      ctx.fillText(`击杀: ${pvpGame.kills}  死亡: ${pvpGame.deaths}`, 30, hudCanvas.height - 90);
      
      if (!pvpGame.myAlive && pvpGame.respawnTimer > 0) {
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
