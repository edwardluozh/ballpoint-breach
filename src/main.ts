import './style.css';
import { Game } from './game';
import { Input } from './core/input';

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
let running = false;
let paused = false;
let lastT = performance.now();

function setStage(s: string) { stageText.textContent = s; }

game = new Game(sceneCanvas, hudCanvas, input, { qa, onStage: setStage });
game.resize();

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

/* ---------- 进入/暂停 ---------- */
async function enterGame() {
  if (!game) return;
  enterScreen.hidden = true;
  const ok = await input.requestLock();
  if (!ok) setStage('自由瞄准模式(无指针锁定)');
  input.enabled = true;
  running = true;
  lastT = performance.now();
}
enterScreen.addEventListener('click', enterGame);
pauseScreen.addEventListener('click', async () => {
  paused = false; pauseScreen.hidden = true;
  const ok = await input.requestLock();
  if (!ok) input.fallbackAim = true;
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && running && !paused) {
    paused = true; pauseScreen.hidden = false; input.releaseLock();
  }
  if (e.code === 'KeyR' && game && (game.gameOver || game.victory)) {
    location.reload();
  }
});
sceneCanvas.addEventListener('click', () => {
  if (game && (game.gameOver || game.victory)) location.reload();
});
document.addEventListener('pointerlockchange', () => {
  // 锁定意外丢失时不立即暂停(fallback 可玩);Esc 由上面的 keydown 处理
});

/* ---------- 主循环 ---------- */
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  if (game && running && !paused) {
    input.sample();
    game.update(dt);
    input.endFrame();
  } else {
    game?.update(0); // 保持渲染(进入屏背后场景可见)
  }
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => game?.resize());

if (qa.capture) {
  // capture 模式:直接可截图,无需点击
  enterScreen.hidden = true;
  input.enabled = true;
  running = true;
}
if (qa.auto) {
  // auto 模式:无人值守跑完整仿真(无 pointer lock,fallback 可玩路径)
  enterScreen.hidden = true;
  input.enabled = true;
  input.fallbackAim = true;
  running = true;
  lastT = performance.now();
}
