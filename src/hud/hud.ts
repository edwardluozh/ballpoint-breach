import { PAL_CSS } from '../render/palette';
import { WEAPONS, SLOT_ORDER, type WeaponId } from '../weapons/defs';

/**
 * 手写风 HUD(canvas 2d,1920×952 基准,按比例缩放)。
 * 准星规格:虚线环 Ø34-36 + 4px 红点 + 4 红 tick(12-13×3-4),
 * tick 内缘 22(静)→38(动)→77(冲刺)。
 */

export interface HudState {
  score: number;
  combo: number;
  wave: number;
  enemiesLeft: number;
  intermission: number;
  hp: number; hpMax: number;
  ammo: { inMag: number; reserve: number };
  current: WeaponId;
  ammoAll: Record<WeaponId, { inMag: number; reserve: number }>;
  reloading: boolean;
  hint: string;
  banner: { text: string; sub: string; t: number } | null;
  killFeed: { text: string; t: number }[];
  hurt: number;                 // 0..1
  hurtDirAngle: number;         // 相对玩家朝向(屏幕坐标,0=正前)
  blocking: boolean;
  stamina: number;
  ads: boolean;
  boss: { name: string; hp: number; hpMax: number } | null;
  gameOver: boolean;
  victory: boolean;
  katanaPhase: string;
  reticleSpread: 'idle' | 'moving' | 'sprint';
}

const HAND = '"KaiTi", "楷体", "STKaiti", "Comic Sans MS", cursive';

export class Hud {
  private ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private s = 1; // s: 相对 952 高度的缩放
  private lastDrawTime = 0;
  private drawInterval = 1000 / 60; // 60Hz 上限

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    this.w = innerWidth; this.h = innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.s = this.h / 952;
  }

  draw(st: HudState) {
    const now = performance.now();
    if (now - this.lastDrawTime < this.drawInterval) return;
    this.lastDrawTime = now;
    
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    const s = this.s;

    if (st.gameOver) return this.endScreen(st, false);
    if (st.victory) return this.endScreen(st, true);

    /* ---------- 准星 ---------- */
    if (!st.ads) this.reticle(st);

    /* ---------- 左上:得分 + 连击 ---------- */
    c.font = `${Math.round(30 * s)}px ${HAND}`;
    c.fillStyle = PAL_CSS.ink;
    c.save();
    c.translate(30 * s, 52 * s);
    c.rotate(-0.015);
    c.fillText(`得分 ${st.score}`, 0, 0);
    c.restore();
    if (st.combo > 1) {
      c.font = `${Math.round(22 * s)}px ${HAND}`;
      c.fillStyle = PAL_CSS.red;
      c.fillText(`连击 x${st.combo}`, 34 * s, 84 * s);
    }

    /* ---------- 右上:波次 / 剩敌 / 倒计时 / 播报 ---------- */
    c.textAlign = 'right';
    c.font = `${Math.round(26 * s)}px ${HAND}`;
    c.fillStyle = PAL_CSS.ink;
    c.fillText(`第 ${st.wave} 波`, this.w - 30 * s, 48 * s);
    c.font = `${Math.round(20 * s)}px ${HAND}`;
    c.fillText(`剩余敌人 ${st.enemiesLeft}`, this.w - 30 * s, 78 * s);
    if (st.intermission > 0 && st.wave > 0) {
      c.fillStyle = PAL_CSS.red;
      c.fillText(`下一波 ${Math.ceil(st.intermission)} 秒后到`, this.w - 30 * s, 108 * s);
    }
    c.font = `${Math.round(19 * s)}px ${HAND}`;
    st.killFeed.slice(-4).forEach((k, i) => {
      c.fillStyle = k.text.startsWith('+') || k.text.includes('+') ? 'rgba(41,39,127,0.9)' : 'rgba(201,47,79,0.95)';
      c.fillText(k.text, this.w - 30 * s, (138 + i * 26) * s);
    });
    c.textAlign = 'left';

    /* ---------- 左下:HP + 弹药 ---------- */
    const hpW = 190 * s, hpH = 13 * s;
    const hpX = 30 * s, hpY = this.h - 58 * s;
    c.font = `${Math.round(18 * s)}px ${HAND}`;
    c.fillStyle = PAL_CSS.ink;
    c.fillText('生命', hpX, hpY - 6 * s);
    c.strokeStyle = PAL_CSS.ink;
    c.lineWidth = 2 * s;
    c.strokeRect(hpX + 34 * s, hpY - hpH, hpW, hpH);
    const frac = Math.max(0, st.hp / st.hpMax);
    c.fillStyle = frac < 0.3 ? PAL_CSS.red : PAL_CSS.ink;
    // 斜线纹填充
    c.save();
    c.beginPath();
    c.rect(hpX + 34 * s, hpY - hpH, hpW * frac, hpH);
    c.clip();
    c.lineWidth = 1.4 * s;
    for (let x = 0; x < hpW; x += 6 * s) {
      c.beginPath();
      c.moveTo(hpX + 34 * s + x, hpY);
      c.lineTo(hpX + 34 * s + x + hpH, hpY - hpH);
      c.stroke();
    }
    c.restore();
    c.font = `${Math.round(20 * s)}px ${HAND}`;
    c.fillText(`${Math.ceil(st.hp)}`, hpX + 34 * s + hpW + 12 * s, hpY - 2 * s);
    // 弹药
    const am = st.ammo;
    const ammoText = Number.isFinite(am.inMag) ? `${am.inMag} / ${am.reserve}` : '∞';
    c.font = `${Math.round(24 * s)}px ${HAND}`;
    c.fillStyle = PAL_CSS.ink;
    c.fillText(ammoText, hpX + 34 * s, hpY + 30 * s);
    if (st.reloading) {
      c.fillStyle = PAL_CSS.red;
      c.font = `${Math.round(18 * s)}px ${HAND}`;
      c.fillText('装填中…', hpX + 150 * s, hpY + 30 * s);
    }

    /* ---------- 右下:武器列表 + 当前武器名 ---------- */
    c.textAlign = 'right';
    let wy = this.h - 34 * s;
    for (let i = SLOT_ORDER.length - 1; i >= 0; i--) {
      const id = SLOT_ORDER[i];
      const d = WEAPONS[id];
      const a = st.ammoAll[id];
      const cur = id === st.current;
      c.font = `${Math.round((cur ? 21 : 17) * s)}px ${HAND}`;
      c.fillStyle = cur ? PAL_CSS.ink : 'rgba(41,39,127,0.55)';
      const ammoStr = Number.isFinite(d.magSize) ? `${a.inMag}/${a.reserve}` : '∞';
      c.fillText(`[${d.slot}] ${d.label}  ${ammoStr}`, this.w - 30 * s, wy);
      wy -= 26 * s;
    }
    const cur = WEAPONS[st.current];
    c.font = `${Math.round(30 * s)}px ${HAND}`;
    c.fillStyle = PAL_CSS.ink;
    c.fillText(cur.label, this.w - 30 * s, wy - 6 * s);
    c.font = `${Math.round(16 * s)}px ${HAND}`;
    c.fillStyle = 'rgba(41,39,127,0.75)';
    c.fillText(cur.note, this.w - 30 * s, wy + 18 * s);
    c.textAlign = 'left';

    /* ---------- 中下:情境提示 ---------- */
    if (st.hint) {
      c.font = `${Math.round(19 * s)}px ${HAND}`;
      c.fillStyle = 'rgba(41,39,127,0.85)';
      c.textAlign = 'center';
      c.fillText(st.hint, this.w / 2, this.h - 42 * s);
      c.textAlign = 'left';
    }

    /* ---------- 左中:KATANA 体力槽(持刀时) ---------- */
    if (st.current === 'katana') {
      const bx = 30 * s, by = this.h / 2 - 70 * s, bw = 12 * s, bh = 140 * s;
      c.strokeStyle = PAL_CSS.ink;
      c.lineWidth = 2 * s;
      c.strokeRect(bx, by, bw, bh);
      const sf = st.stamina / 100;
      c.fillStyle = st.blocking ? PAL_CSS.red : PAL_CSS.ink;
      c.fillRect(bx + 2 * s, by + bh * (1 - sf) + 2 * s, bw - 4 * s, bh * sf - 4 * s);
      c.save();
      c.translate(bx + 24 * s, by + bh / 2);
      c.rotate(-Math.PI / 2);
      c.font = `${Math.round(14 * s)}px ${HAND}`;
      c.fillStyle = 'rgba(41,39,127,0.8)';
      c.textAlign = 'center';
      c.fillText('格挡', 0, 0);
      c.restore();
    }

    /* ---------- 格挡闪光提示 ---------- */
    void st.blocking;

    /* ---------- 受击:方向双箭头 + 红墨晕 ---------- */
    if (st.hurt > 0.01) this.hurtOverlay(st);

    /* ---------- Boss 血条 ---------- */
    if (st.boss) {
      const bw = 420 * s, bx = (this.w - bw) / 2, by = 26 * s;
      c.font = `${Math.round(20 * s)}px ${HAND}`;
      c.fillStyle = PAL_CSS.ink;
      c.textAlign = 'center';
      c.fillText(st.boss.name, this.w / 2, by - 6 * s);
      c.strokeStyle = PAL_CSS.ink;
      c.lineWidth = 2 * s;
      c.strokeRect(bx, by, bw, 14 * s);
      const bf = Math.max(0, st.boss.hp / st.boss.hpMax);
      c.fillStyle = PAL_CSS.red;
      c.save();
      c.beginPath(); c.rect(bx, by, bw * bf, 14 * s); c.clip();
      c.lineWidth = 1.2 * s;
      for (let x = 0; x < bw; x += 7 * s) {
        c.beginPath(); c.moveTo(bx + x, by + 14 * s); c.lineTo(bx + x + 14 * s, by); c.stroke();
      }
      c.restore();
      c.textAlign = 'left';
    }

    /* ---------- 大字公告 ---------- */
    if (st.banner && st.banner.t > 0) {
      const a = Math.min(1, st.banner.t);
      c.save();
      c.globalAlpha = a;
      c.textAlign = 'center';
      c.font = `${Math.round(54 * s)}px ${HAND}`;
      c.fillStyle = PAL_CSS.ink;
      c.translate(this.w / 2, this.h * 0.36);
      c.rotate(-0.02);
      c.fillText(st.banner.text, 0, 0);
      if (st.banner.sub) {
        c.font = `${Math.round(22 * s)}px ${HAND}`;
        c.fillStyle = PAL_CSS.red;
        c.fillText(st.banner.sub, 0, 40 * s);
      }
      c.restore();
      c.textAlign = 'left';
    }

    /* ---------- 狙击镜 ---------- */
    if (st.ads) this.scope(st);
  }

  /* ---------- 准星 ---------- */
  private reticle(st: HudState) {
    const c = this.ctx, s = this.s;
    const cx = this.w / 2, cy = this.h / 2;
    const r = 17.5 * s;                       // 虚线环 Ø34-36
    c.strokeStyle = PAL_CSS.ink;
    c.lineWidth = 1.6 * s;
    c.setLineDash([4.5 * s, 3.5 * s]);
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    // 4px 红心点
    c.fillStyle = PAL_CSS.red;
    c.beginPath();
    c.arc(cx, cy, 2 * s, 0, Math.PI * 2);
    c.fill();
    // 4 红 tick:内缘距 22(静)→38(动)→77(冲)
    const distMap = { idle: 22, moving: 38, sprint: 77 } as const;
    const dist = distMap[st.reticleSpread] * s;
    const len = 12.5 * s;
    const drawTick = (ang: number) => {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      c.strokeStyle = PAL_CSS.red;
      c.lineWidth = 3.5 * s;
      c.beginPath();
      c.moveTo(cx + dx * dist, cy + dy * dist);
      c.lineTo(cx + dx * (dist + len), cy + dy * (dist + len));
      c.stroke();
    };
    drawTick(0); drawTick(Math.PI); drawTick(Math.PI / 2); drawTick(-Math.PI / 2);
  }

  /* ---------- 受击红墨 ---------- */
  private hurtOverlay(st: HudState) {
    const c = this.ctx, s = this.s;
    const strength = Math.min(1, st.hurt);
    const cx = this.w / 2, cy = this.h / 2;
    // 径向:中心 ~300px(即 150*s 半径)干净 → 350-400 起 → 边缘(700-800px)峰值
    const g = c.createRadialGradient(cx, cy, 150 * s, cx, cy, 800 * s);
    const col = (a: number) => `rgba(201,47,79,${a})`;
    g.addColorStop(0, col(0));
    g.addColorStop(0.18, col(0));
    g.addColorStop(0.42, col(0.28 * strength));
    g.addColorStop(0.75, col(0.55 * strength));
    g.addColorStop(1, col(0.72 * strength));
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);
    // 方向双箭头(chevron ×2)
    const ang = st.hurtDirAngle;   // 屏幕角度
    const rr = 110 * s;
    c.save();
    c.translate(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
    c.rotate(ang);
    c.strokeStyle = PAL_CSS.red;
    c.lineWidth = 4 * s;
    c.globalAlpha = strength;
    for (const off of [-8, 8]) {
      c.beginPath();
      c.moveTo(-10 * s, off * s - 8 * s);
      c.lineTo(2 * s, off * s);
      c.lineTo(-10 * s, off * s + 8 * s);
      c.stroke();
    }
    c.restore();
    c.globalAlpha = 1;
  }

  /* ---------- 狙击镜 ---------- */
  private scope(st: HudState) {
    const c = this.ctx, s = this.s;
    const cx = this.w / 2, cy = this.h / 2;
    const r = Math.min(this.w, this.h) * 0.42;
    c.fillStyle = 'rgba(236,235,221,0.08)';
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = PAL_CSS.ink;
    c.lineWidth = 3 * s;
    c.setLineDash([7 * s, 5 * s]);
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    // 十字
    c.lineWidth = 1.6 * s;
    c.beginPath();
    c.moveTo(cx - r, cy); c.lineTo(cx - 14 * s, cy);
    c.moveTo(cx + 14 * s, cy); c.lineTo(cx + r, cy);
    c.moveTo(cx, cy - r); c.lineTo(cx, cy - 14 * s);
    c.moveTo(cx, cy + 14 * s); c.lineTo(cx, cy + r);
    c.stroke();
    // 镜外遮罩
    c.fillStyle = 'rgba(242,236,219,0.55)';
    c.beginPath();
    c.rect(0, 0, this.w, this.h);
    c.arc(cx, cy, r, 0, Math.PI * 2, true);
    c.fill();
    void st;
  }

  /* ---------- 结束画面 ---------- */
  private endScreen(st: HudState, victory: boolean) {
    const c = this.ctx, s = this.s;
    c.fillStyle = 'rgba(242,236,219,0.82)';
    c.fillRect(0, 0, this.w, this.h);
    c.textAlign = 'center';
    c.fillStyle = victory ? PAL_CSS.ink : PAL_CSS.red;
    c.font = `${Math.round(72 * s)}px ${HAND}`;
    c.save();
    c.translate(this.w / 2, this.h * 0.42);
    c.rotate(-0.02);
    c.fillText(victory ? '这一页是你的了' : '你被擦除了', 0, 0);
    c.restore();
    c.fillStyle = PAL_CSS.ink;
    c.font = `${Math.round(26 * s)}px ${HAND}`;
    c.fillText(`最终得分 ${st.score}`, this.w / 2, this.h * 0.52);
    c.font = `${Math.round(22 * s)}px ${HAND}`;
    c.fillText('按 R 或点击 重新开始', this.w / 2, this.h * 0.62);
    c.textAlign = 'left';
  }
}
