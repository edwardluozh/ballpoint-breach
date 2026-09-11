import * as THREE from 'three';
import { PAL } from './render/palette';
import { Input } from './core/input';
import { Emitter } from './core/events';
import { buildArena, type Arena } from './world/arena';
import { buildSky, buildPaperPlane } from './world/sky';
import { buildNavGraph, type NavGraph } from './world/navgraph';
import { PlayerController } from './player/controller';
import { Npc, ProjectilePool, CLASS_STATS, type GameEvents } from './enemies/npc';
import { WaveManager } from './enemies/waves';
import type { NpcClass } from './enemies/npcModel';
import { WeaponSystem } from './weapons/system';
import { Boss } from './enemies/boss';
import { SLOT_ORDER, WEAPONS } from './weapons/defs';
import { FxPool } from './fx/pools';
import { DeathInkSystem } from './fx/deathInk';
import { Hud, type HudState } from './hud/hud';
import { AudioSystem } from './audio/audio';

export interface GameOpts {
  qa: { capture?: boolean; stress?: boolean; ink?: boolean; view?: string; auto?: boolean };
  onStage: (s: string) => void;
}

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  input: Input;
  arena: Arena;
  nav: NavGraph;
  player: PlayerController;
  em = new Emitter<GameEvents>();
  npcs: Npc[] = [];
  projectiles: ProjectilePool;
  waves: WaveManager;
  weapons: WeaponSystem;
  fx: FxPool;
  deathInk = new DeathInkSystem();
  hud: Hud;
  audio = new AudioSystem();
  banner: { text: string; sub: string; t: number } | null = null;
  hint = 'WASD 移动 · 按 1-5 切换武器';
  boss: Boss | null = null;
  /** 玩家状态 */
  hp = 150; hpMax = 150;
  score = 0;
  combo = 0; comboTimer = 0;
  gameOver = false; victory = false;
  hurt = 0; hurtDir = new THREE.Vector3();
  killFeed: { text: string; points: number; t: number }[] = [];
  t = 0;

  private planeUpdate: (t: number) => void;
  private bossActive = false;
  private frameCount = 0;

  private views: Record<string, { pos: THREE.Vector3; yaw: number; pitch: number }> = {
    spawn: { pos: new THREE.Vector3(2, 0, 26), yaw: 0, pitch: 0 },
    rear: { pos: new THREE.Vector3(0, 1.58, 10), yaw: 0, pitch: 0.02 },
    west: { pos: new THREE.Vector3(-33, 1.58, 12), yaw: -0.93, pitch: 0 },
    npc: { pos: new THREE.Vector3(0, 1.58, 11), yaw: 0, pitch: -0.04 },
    ink: { pos: new THREE.Vector3(0, 1.58, 18), yaw: 0, pitch: -0.55 },
    boss: { pos: new THREE.Vector3(0, 1.58, 7), yaw: 0, pitch: 0.06 },
  };

  constructor(canvas: HTMLCanvasElement, hudCanvas: HTMLCanvasElement, input: Input, public opts: GameOpts) {
    this.renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: false, 
      powerPreference: 'high-performance',
      stencil: false
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(PAL.paperCool, 1);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 400);
    this.input = input;

    this.arena = buildArena();
    this.scene.add(this.arena.group);
    buildSky(this.scene as unknown as THREE.Group);
    this.planeUpdate = buildPaperPlane(this.scene as unknown as THREE.Group);
    this.nav = buildNavGraph(this.arena.colliders);

    this.projectiles = new ProjectilePool(64);
    this.scene.add(this.projectiles.object);

    this.player = new PlayerController(this.arena.colliders, input);
    this.player.audio = this.audio;

    this.fx = new FxPool();
    this.scene.add(this.fx.object);
    this.scene.add(this.deathInk.object);
    this.weapons = new WeaponSystem({
      camera: this.camera,
      input,
      colliders: this.arena.colliders,
      enemies: this.npcs,
      em: this.em,
      fx: this.fx,
      barricades: this.arena.points.barricades.map((b) => ({ box: b.box, mesh: b.mesh, hp: 60 })),
      playerPos: this.player.state.pos,
      grappleAnchors: this.arena.points.grappleAnchors,
      boss: null,
      audio: this.audio,
    });
    this.camera.add(this.weapons.object);
    this.scene.add(this.camera);   // camera 子级(viewmodel)需要 camera 在场景内
    this.hud = new Hud(hudCanvas);

    // 波次
    this.waves = new WaveManager(
      this.arena.points.enemySpawns,
      this.em,
      (npc) => { this.scene.add(npc.model.group); this.npcs.push(npc); },
      () => this.spawnBoss(),
      () => { this.victory = true; },
    );

    // 事件接线
    this.em.on('enemyDied', ({ enemy, head, impactDir }) => {
      const st = CLASS_STATS[enemy.cls];
      this.combo += 1; this.comboTimer = 4;
      const pts = Math.round(st.score * (head ? 2 : 1) * (1 + (this.combo - 1) * 0.1));
      this.score += pts;
      this.killFeed.push({ text: `${head ? '爆头' : st.label} +${pts}`, points: pts, t: 3 });
      this.audio.play('death', { gain: 0.6, pitch: 0.9 + Math.random() * 0.3 });
      // 死亡墨水:剪影+碎片+地面/墙面沉积
      const hit = this.arena.colliders.raycast(
        new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1.2, enemy.pos.z), impactDir, 3.5);
      const wallNormal = hit && hit.box.tag !== 'rail' ? hit.normal.clone() : null;
      this.deathInk.trigger(
        enemy.pos.clone(), impactDir, enemy.variantSeed,
        (x, z) => this.arena.colliders.groundHeight(x, z, 8, 0.5),
        wallNormal,
      );
      this.scene.remove(enemy.model.group);
      const idx = this.npcs.indexOf(enemy);
      if (idx >= 0) this.npcs.splice(idx, 1);
    });
    this.em.on('enemyAttackProjectile', ({ from, to, dmg, enemy }) => {
      const dir = new THREE.Vector3().subVectors(to, from).normalize();
      // 预判一点提前量
      dir.addScaledVector(new THREE.Vector3().subVectors(this.player.state.pos, enemy.pos).setY(0).normalize(), 0.05).normalize();
      this.projectiles.spawn(from, dir, CLASS_STATS[enemy.cls].projSpeed, dmg);
    });
    this.em.on('playerHit', ({ dmg, fromDir }) => {
      if (this.gameOver || this.victory) return;
      this.hp -= dmg;
      this.hurt = Math.min(1, this.hurt + 0.38);
      this.hurtDir.copy(fromDir);
      this.audio.play('hurt', { gain: 0.7 });
      if (this.hp <= 0) { this.hp = 0; this.gameOver = true; }
    });
    this.em.on('killFeed', ({ text, points }) => {
      this.score += points;
      if (text) {
        this.killFeed.push({ text, points, t: 3 });
        if (text.includes('波已清除') || text.includes('涂鸦大王')) {
          const m = text.split(' · ');
          this.banner = { text: m[0], sub: m[1] ?? '', t: 2.8 };
        }
      }
    });

    if (opts.qa.capture || opts.qa.stress) this.setupCapture();
    this.opts.onStage(this.stageLabel());
  }

  private spawnBoss() {
    this.bossActive = true;
    const b = new Boss(this.em, this.arena.colliders);
    b.pos.set(0, 0, -40);
    this.scene.add(b.group);
    this.boss = b;
    this.weapons.setBoss(b);
  }

  private stageLabel(): string {
    const q = this.opts.qa;
    const tags = [q.capture && '审阅', q.stress && '压力', q.ink && '墨水', q.view && `视角=${q.view}`].filter(Boolean);
    return `阶段3 · 战斗${tags.length ? ' · ' + tags.join('·') : ''}`;
  }

  private setupCapture() {
    this.applyQaView();
    if (this.opts.qa.view === 'npc') {
      const clsList: NpcClass[] = ['grunt', 'grunt', 'rusher', 'heavy', 'marksman'];
      clsList.forEach((c, i) => {
        const npc = new Npc(c, i, new THREE.Vector3(-6 + i * 3, 0, 6));
        npc.yaw = 0;
        npc.model.group.position.copy(npc.pos);
        npc.model.group.rotation.y = npc.yaw;
        this.scene.add(npc.model.group);
        this.npcs.push(npc);
      });
    }
    if (this.opts.qa.ink || this.opts.qa.view === 'ink') {
      const gAt = (x: number, z: number) => this.arena.colliders.groundHeight(x, z, 8, 0.5);
      // 地面 4 组(不同变体与方向)+ 1 组墙背(南墙内侧)
      const cases: [THREE.Vector3, THREE.Vector3, number][] = [
        [new THREE.Vector3(-4.5, 0, 12), new THREE.Vector3(0.55, 0, 0.83), 1],
        [new THREE.Vector3(-1.2, 0, 13.6), new THREE.Vector3(-0.8, 0, 0.6), 3],
        [new THREE.Vector3(2.4, 0, 12.2), new THREE.Vector3(0.1, 0, -1), 5],
        [new THREE.Vector3(5.4, 0, 14.2), new THREE.Vector3(0.9, 0, 0.44), 7],
      ];
      for (const [p, d, s] of cases) {
        this.deathInk.trigger(p, d, s, gAt, null);
        this.deathInk.update(5, gAt); // 快进清掉瞬态碎片,保留沉积
      }
      this.deathInk.trigger(new THREE.Vector3(-6.5, 0, 10), new THREE.Vector3(0, 0, -1), 9, gAt, new THREE.Vector3(0, 0, 1));
      this.deathInk.update(5, gAt);
    }
    if (this.opts.qa.stress) {
      for (let i = 0; i < 20; i++) {
        const cls: NpcClass = (['grunt', 'rusher', 'heavy', 'marksman'] as const)[i % 4];
        const a = (i / 20) * Math.PI * 2;
        const sp = new THREE.Vector3(Math.cos(a) * 18, 0, -10 + Math.sin(a) * 14);
        const npc = new Npc(cls, i % 8, sp);
        npc.yaw = 0;
        this.scene.add(npc.model.group);
        this.npcs.push(npc);
      }
    }
    if (this.opts.qa.view === 'boss') {
      const b = new Boss(this.em, this.arena.colliders);
      b.pos.set(0, 0, -2);
      b.yaw = 0;
      b.update(0, {
        playerPos: new THREE.Vector3(0, 0, 7), playerEye: new THREE.Vector3(0, 1.58, 7),
        onProjectile: () => {}, onSummon: () => {},
      });
      this.scene.add(b.group);
      this.boss = b;
    }
  }

  private applyQaView() {
    const v = this.views[this.opts.qa.view ?? 'spawn'] ?? this.views.spawn;
    this.player.state.pos.copy(v.pos);
    this.player.state.yaw = v.yaw;
    this.player.state.pitch = v.pitch;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize();
  }

  update(dt: number) {
    this.t += dt;
    this.planeUpdate(this.t);

    if (this.opts.qa.capture) {
      // capture:确定性静态视角(可跑敌人动画不跑玩家)
      this.player.applyToCamera(this.camera);
      this.renderer.render(this.scene, this.camera);
      this.drawHud();
      this.reportPerf();
      return;
    }

    if (this.opts.qa.auto) {
      // auto 模式:纯逻辑快跑,低频渲染(headless 软渲染一帧数秒,不能每帧画)
      const steps = 120;
      for (let i = 0; i < steps && !this.gameOver && !this.victory; i++) this.step(1 / 30);
      if (this.frameCount % 60 === 0 || this.gameOver || this.victory) {
        this.player.applyToCamera(this.camera);
        this.renderer.render(this.scene, this.camera);
        this.drawHud();
      }
      this.reportPerf();
      return;
    }

    this.step(dt);
    this.player.applyToCamera(this.camera);
    this.renderer.render(this.scene, this.camera);
    this.drawHud();
    this.reportPerf();
  }

  /** 单步仿真(不含渲染) */
  private step(dt: number) {
    if (!this.gameOver && !this.victory) {
      this.player.update(dt);
      this.waves.update(dt, this.npcs.length);
      this.weapons.update(dt, this.player.state.gaitPhase, this.player.state.sprinting);
      // 相机后坐
      const rc = this.weapons.consumeRecoilCam();
      this.player.state.pitch = Math.min(1.45, this.player.state.pitch + rc * 0.6);
      // 抓钩拉玩家
      const pull = this.weapons.consumePlayerPull();
      if (pull) this.player.state.vel.addScaledVector(pull, 11);
    }
    this.player.applyToCamera(this.camera);

    // 敌人更新
    const ctx = {
      dt, now: this.t,
      playerPos: this.player.state.pos,
      playerEye: this.player.eyePos(),
      colliders: this.arena.colliders,
      nav: this.nav,
      em: this.em,
      others: this.npcs,
    };
    for (const n of this.npcs) n.update(ctx);

    // boss 更新
    if (this.boss) {
      const b = this.boss;
      const wasAlive = !b.dead;
      b.update(dt, {
        playerPos: this.player.state.pos,
        playerEye: this.player.eyePos(),
        onProjectile: (from, to, dmg) => {
          // boss 的铅笔弹:红色大弹
          const dir = new THREE.Vector3().subVectors(to, from).normalize();
          this.projectiles.spawn(from, dir, 14, dmg);
        },
        onSummon: () => {
          for (let i = 0; i < 2; i++) {
            const sp = this.arena.points.enemySpawns[(i * 3) % this.arena.points.enemySpawns.length];
            const npc = new Npc(i === 0 ? 'rusher' : 'grunt', (i + 5) % 8, sp.clone());
            this.scene.add(npc.model.group);
            this.npcs.push(npc);
          }
          this.killFeed.push({ text: '涂鸦大王召唤了增援', points: 0, t: 2 });
        },
      });
      if (wasAlive && b.dead) {
        // boss 死亡:大团墨水 + 胜利
        this.deathInk.trigger(b.pos.clone(), new THREE.Vector3(0.4, 0.1, 1), 42,
          (x, z) => this.arena.colliders.groundHeight(x, z, 8, 0.5), null);
        this.scene.remove(b.group);
        this.boss = null;
        this.weapons.setBoss(null);
        this.score += 3000;
        this.killFeed.push({ text: '涂鸦大王被擦除 +3000', points: 3000, t: 4 });
        this.victory = true;
      }
    }

    // 投射物
    this.projectiles.update(dt, {
      colliders: this.arena.colliders,
      playerEye: this.player.eyePos(),
      playerPos: this.player.state.pos,
      enemies: this.npcs,
      em: this.em,
      playerBlocks: this.weapons.blocking,
      playerBlockDir: this.player.lookDir(),
    });

    // FX
    this.fx.update(dt, (x, z) => this.arena.colliders.groundHeight(x, z, 8, 0.5));
    this.deathInk.update(dt, (x, z) => this.arena.colliders.groundHeight(x, z, 8, 0.5));

    // 波间恢复
    if (this.waves.state.intermission > 5.9) {
      this.hp = Math.min(this.hpMax, this.hp + 34 * dt);
      this.weapons.refillAll(0.08);
    }

    // 衰减
    this.hurt = Math.max(0, this.hurt - dt * 1.45);
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
    for (const k of this.killFeed) k.t -= dt;
    this.killFeed = this.killFeed.filter((k) => k.t > 0);
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
  }

  /** 每秒把 draw call/三角形写入 stage 指示器(QA 性能证据);auto 模式写仿真状态 */
  private reportPerf() {
    this.frameCount++;
    if (this.opts.qa.auto) {
      const info = this.renderer.info;
      this.opts.onStage(
        `auto t=${this.t.toFixed(1)}s wave=${this.waves.state.wave} e=${this.npcs.length} ` +
        `hp=${Math.ceil(this.hp)} f=${this.frameCount} ${info.render.calls}c`,
      );
      return;
    }
    if (this.frameCount > 2 && this.frameCount % 30 !== 0) return;
    const info = this.renderer.info;
    this.opts.onStage(
      `perf · ${info.render.calls} calls · ${(info.render.triangles / 1000).toFixed(1)}k tris · ` +
      `geoms ${info.memory.geometries} · tex ${info.memory.textures}`,
    );
  }

  private drawHud() {
    const w = this.weapons;
    const st: HudState = {
      score: this.score,
      combo: this.combo,
      wave: this.waves.state.wave,
      enemiesLeft: this.waves.state.enemiesLeft,
      intermission: this.waves.state.intermission,
      hp: this.hp, hpMax: this.hpMax,
      ammo: w.hudAmmo,
      current: w.current,
      ammoAll: Object.fromEntries(SLOT_ORDER.map((id) => [id, w.ammoFor(id)])) as HudState['ammoAll'],
      reloading: w.reloading,
      hint: this.hint,
      banner: this.banner,
      killFeed: this.killFeed.map((k) => ({ text: k.text, t: k.t })),
      hurt: this.hurt,
      hurtDirAngle: this.hurtScreenAngle(),
      blocking: w.blocking,
      stamina: w.stamina,
      ads: w.isADS,
      boss: this.boss ? { name: 'THE DOODLER · 涂鸦大王', hp: this.boss.hp, hpMax: this.boss.hpMax } : null,
      gameOver: this.gameOver,
      victory: this.victory,
      katanaPhase: w.slashPhaseName,
      reticleSpread: this.player.state.sprinting ? 'sprint' : this.player.state.speed > 0.6 ? 'moving' : 'idle',
    };
    this.hud.draw(st);
  }

  private hurtScreenAngle(): number {
    // 伤害来源相对玩家 yaw 的屏幕角(0=正上)
    const dir = this.hurtDir;
    if (dir.lengthSq() < 1e-6) return 0;
    const rel = Math.atan2(dir.x, -dir.z) - this.player.state.yaw;
    return -rel + Math.PI;
  }

  dispose() { this.renderer.dispose(); }
}
