/** 键鼠输入:Pointer Lock 优先,拒绝时进入可用 unlocked fallback。 */
export type InputState = {
  move: { x: number; z: number };       // WASD(归一)
  sprint: boolean;
  jumpQueued: boolean;
  fire: boolean;                         // LMB 按住
  firePressed: boolean;                  // 本帧按下
  block: boolean;                        // RMB 按住
  look: { dx: number; dy: number };      // 本帧鼠标增量(rad)
  weaponSlot: number | null;             // 1..5
  reloadQueued: boolean;
  grappleQueued: boolean;
};

export class Input {
  readonly state: InputState = {
    move: { x: 0, z: 0 }, sprint: false, jumpQueued: false,
    fire: false, firePressed: false, block: false,
    look: { dx: 0, dy: 0 }, weaponSlot: null, reloadQueued: false, grappleQueued: false,
  };
  pointerLocked = false;
  /** fallback 模式:无锁,鼠标在画布内移动直接转视角(灵敏度较低) */
  fallbackAim = false;
  enabled = false;  // 进入游戏后才开始采样移动

  private keys = new Set<string>();
  private el: HTMLElement;
  private onMouseMoveBound = this.onMouseMove.bind(this);

  constructor(el: HTMLElement) { this.el = el; this.bind(); }

  private bind() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.state.jumpQueued = true;
      if (e.code === 'KeyR') this.state.reloadQueued = true;
      if (e.code === 'KeyQ') this.state.grappleQueued = true;
      const digit = /^Digit([1-5])$/.exec(e.code);
      if (digit) this.state.weaponSlot = Number(digit[1]);
      if (['Space', 'KeyR', 'KeyQ'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.el;
    });
    document.addEventListener('mousemove', this.onMouseMoveBound);
    this.el.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) { this.state.fire = true; this.state.firePressed = true; }
      if (e.button === 2) this.state.block = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.state.fire = false;
      if (e.button === 2) this.state.block = false;
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.enabled) return;
    const active = this.pointerLocked || this.fallbackAim;
    if (!active) return;
    const sens = this.pointerLocked ? 0.0021 : 0.0016;
    this.state.look.dx += e.movementX * sens;
    this.state.look.dy += e.movementY * sens;
  }

  async requestLock(): Promise<boolean> {
    try {
      await this.el.requestPointerLock();
      return true;
    } catch {
      this.fallbackAim = true;
      return false;
    }
  }

  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** 每帧末调用:清一次性事件 */
  endFrame() {
    this.state.firePressed = false;
    this.state.jumpQueued = false;
    this.state.weaponSlot = null;
    this.state.reloadQueued = false;
    this.state.grappleQueued = false;
    this.state.look.dx = 0;
    this.state.look.dy = 0;
  }

  /** 由 loop 在每帧开头调用,刷新持续按键 */
  sample() {
    const k = this.keys;
    const x = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const z = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const len = Math.hypot(x, z) || 1;
    this.state.move.x = x / len;
    this.state.move.z = z / len;
    this.state.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
  }
}
