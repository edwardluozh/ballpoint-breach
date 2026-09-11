import { Rng } from '../core/rng';

/**
 * 程序化 Web Audio 系统:噪声缓冲 + 增益/压缩器,首次用户手势后恢复。
 * 全部音效由代码生成(无音频文件)。
 */

export type SfxType = 
  | 'pistol' | 'rifle' | 'shotgun' | 'sniper' | 'katana'
  | 'reload' | 'hit' | 'hurt' | 'death' | 'jump' | 'land' | 'step';

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
      case 'hurt': this.playHurt(now, gain); break;
      case 'death': this.playDeath(now, gain); break;
      case 'jump': this.playJump(now, gain); break;
      case 'land': this.playLand(now, gain); break;
      case 'step': this.playStep(now, gain); break;
    }
  }

  private playPistol(t: number, g: number, p: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 800 * p;
    filt.Q.value = 1.2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.22 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.08);
  }

  private playRifle(t: number, g: number, p: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 950 * p;
    filt.Q.value = 2.5;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.24 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.09);
  }

  private playShotgun(t: number, g: number, p: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 380 * p;
    filt.Q.value = 0.8;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.36 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.22);
  }

  private playSniper(t: number, g: number, p: number) {
    if (!this.ctx || !this.comp || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 720 * p;
    filt.Q.value = 3.2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.32 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.18);
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
    filt.frequency.value = 1800 * p;
    filt.Q.value = 4;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.18 * g, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.06);
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
    filt.type = 'highpass';
    filt.frequency.value = 800;
    filt.Q.value = 0.4;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.05 * g, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.04);
    noise.connect(filt).connect(gain).connect(this.comp);
    noise.start(t);
    noise.stop(t + 0.04);
  }
}
