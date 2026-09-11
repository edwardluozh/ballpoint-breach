import { Rng } from '../core/rng';

/**
 * 程序化 Web Audio 系统:噪声缓冲 + 增益/压缩器,首次用户手势后恢复。
 * 全部音效由代码生成(无音频文件)。
 */

export type SfxType = 
  | 'pistol' | 'rifle' | 'shotgun' | 'sniper' | 'katana'
  | 'reload' | 'hit' | 'headshot' | 'hurt' | 'death' | 'jump' | 'land' | 'step'
  | 'enemyShoot' | 'enemyMelee';

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private resumed = false;
  private volume = 0.7;
  private muted = false;

  constructor() {
    if (typeof AudioContext === 'undefined' && typeof (window as any).webkitAudioContext === 'undefined') {
      console.warn('Web Audio API not supported');
      return;
    }
    this.ctx = new (AudioContext || (window as any).webkitAudioContext)();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -24;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 12;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.15;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volume;
    this.comp.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    this.noiseBuffer = this.createNoiseBuffer();
  }

  async resumeIfNeeded() {
    if (!this.ctx || this.resumed) return;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.resumed = true;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : this.volume;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.masterGain) this.masterGain.gain.value = m ? 0 : this.volume;
  }

  private createNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  play(type: SfxType, opts: { gain?: number; pitch?: number } = {}) {
    if (!this.ctx || !this.comp || this.muted) return;
    const now = this.ctx.currentTime;
    const gain = opts.gain ?? 1;
    const pitch = opts.pitch ?? 1;

    switch (type) {
      case 'pistol': this.playPistol(now, gain, pitch); break;
      case 'rifle': this.playRifle(now, gain, pitch); break;
      case 'shotgun': this.playShotgun(now, gain, pitch); break;
      case 'sniper': this.playSniper(now, gain, pitch); break;
      case 'katana': this.playKatana(now, gain, pitch); break;
      case 'reload': this.playReload(now, gain); break;
      case 'hit': this.playHit(now, gain, pitch); break;
      case 'headshot': this.playHeadshot(now, gain); break;
      case 'hurt': this.playHurt(now, gain); break;
      case 'death': this.playDeath(now, gain); break;
      case 'jump': this.playJump(now, gain); break;
      case 'land': this.playLand(now, gain); break;
      case 'step': this.playStep(now, gain); break;
      case 'enemyShoot': this.playEnemyShoot(now, gain); break;
      case 'enemyMelee': this.playEnemyMelee(now, gain); break;
    }
  }

  private playPistol(t: number, g: number, p: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 900 * p;
    filt.Q.value = 1.4;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.38 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.10);
  }

  private playRifle(t: number, g: number, p: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 1050 * p;
    filt.Q.value = 3.0;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.42 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.11);
  }

  private playShotgun(t: number, g: number, p: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 420 * p;
    filt.Q.value = 1.0;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.54 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.26);
  }

  private playSniper(t: number, g: number, p: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 820 * p;
    filt.Q.value = 3.8;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.48 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.22);
  }

  private playKatana(t: number, g: number, p: number) {
    if (!this.ctx || !this.comp) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280 * p, t);
    osc.frequency.exponentialRampToValueAtTime(120 * p, t + 0.12);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain).connect(this.comp);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  private playReload(t: number, g: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 1200;
    filt.Q.value = 0.6;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.08 * g, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.15);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.15);
  }

  private playHit(t: number, g: number, p: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 2200 * p;
    filt.Q.value = 4.5;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.24 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.07);
  }

  private playHeadshot(t: number, g: number) {
    if (!this.ctx || !this.comp) return;
    // 高频三角波脉冲
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(3200, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 2400;
    filt.Q.value = 2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.28 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(filt).connect(gain).connect(this.comp);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  private playHurt(t: number, g: number) {
    if (!this.ctx || !this.comp) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.15);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.16 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain).connect(this.comp);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  private playDeath(t: number, g: number) {
    if (!this.ctx || !this.comp) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.4);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.18 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(gain).connect(this.comp);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  private playJump(t: number, g: number) {
    if (!this.ctx || !this.comp) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(380, t + 0.08);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.1 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain).connect(this.comp);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  private playLand(t: number, g: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 280;
    filt.Q.value = 0.5;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.14 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.12);
  }

  private playStep(t: number, g: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 650;
    filt.Q.value = 0.8;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.18 * g, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.06);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.06);
  }

  private playEnemyShoot(t: number, g: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 720;
    filt.Q.value = 2.2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.22 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.08);
  }

  private playEnemyMelee(t: number, g: number) {
    if (!this.ctx || !this.comp) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.10);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.16 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    osc.connect(gain).connect(this.comp);
    osc.start(t);
    osc.stop(t + 0.10);
  }
}
