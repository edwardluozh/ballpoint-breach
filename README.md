# BALLPOINT BREACH

一款完全由代码程序化生成的第一人称射击游戏——整个世界看起来像用靛蓝圆珠笔画在横格笔记本纸上:建筑是手绘轮廓+交叉影线,敌人是纸白红线的"雪人",血是红墨水,boss 是戴皇冠的 THE DOODLER。

- 引擎:TypeScript + Vite + 原生 Three.js(无游戏引擎、无外部美术资源、无 GLB/贴图包)
- 参考来源:`D:\claudecode\cs.mp4`(1920×952,71s)逆向重建;分析见 `docs/REFERENCE_ANALYSIS.md`,世界布局见 `docs/LAYOUT_CONTRACT.md`
- **接手/优化请先读 `docs/HANDOFF.md`**(架构地图、调参速查、已知缺口、环境坑)**

## 运行

```bash
npm install
npm run dev        # http://127.0.0.1:8901/
npm run typecheck  # tsc --noEmit
npm test           # vitest(导航连通性/武器规格/NPC 尺寸/池上限/确定性)
npm run build      # typecheck + vite build
```

## 游戏模式

### 单人波次模式
5 波敌人(Grunt/Rusher/Heavy/Marksman),第 5 波 THE DOODLER 登场;波清恢复 HP 与弹药。

### 🎮 对战模式 (PvP) **NEW!**
- **CS风格房间系统**: 创建房间(6位码) / 加入房间
- **红蓝团队对抗**: 团队选择 → 分队出生 → 团队死斗
- **2-8玩家**: 本地测试或联机对战
- **架构**: Cloudflare Worker + Durable Object WebSocket房间服务器
- **主机权威**: 主机运行游戏逻辑,客户端发送输入
- **PlayerController**: 复用单人模式移动手感,无重复实现
- **完整同步**: 移动/射击/伤害/死亡/重生
- **团队识别**: 红/蓝色轮廓区分友军和敌人

详细架构/部署见 [`MULTIPLAYER.md`](MULTIPLAYER.md)

## 操作

| 键 | 功能 |
|---|---|
| WASD / Shift / Space | 移动 / 冲刺 / 跳跃 |
| 鼠标 | 视角(Pointer Lock 被拒时自动进入可用的 unlocked fallback) |
| 左键 | 开火 / 武士刀斩击(接触瞬间才结算) |
| 右键 | 狙击开镜 / 武士刀格挡(有限体力,时机正确可反弹子弹) |
| Q | 抓钩(拉敌人 / 拉自己到赭色锚点) |
| 1–5 | 步枪 / 霰弹 / 左轮 / 狙击 / 武士刀 |
| R | 装填 / 结束后重开;Esc 暂停 |

## QA 参数(不影响正常玩法)

| URL | 用途 |
|---|---|
| `?capture=1` | 免点击确定性视觉审阅 |
| `?capture=1&view=npc` / `view=boss` / `view=ink` / `view=rear` / `view=west` | NPC / boss / 死亡墨水 / 远端路线特写 |
| `?capture=1&ink=1` | 地面+墙面死亡墨水集成审阅 |
| `?capture=1&stress=1` | 20 敌压力场景(全部池化,无运行时增长) |
| `?auto=1` | 无人值守仿真(headless CI 用,低频渲染) |

页面暴露 `window.__bb`(start / snapshot / capturePass / state),运行时错误显示在左下红框,当前阶段/性能常驻右上角。

## 架构(src/)

- `core/` 确定性 RNG(mulberry32)、类型化事件总线、输入(Pointer Lock + fallback)
- `render/` 圆珠笔渲染:penFill(纸面+多族 seeded 影线 shader,无 time uniform)、penOutline(深主线+断续位移副线同几何合并)、屏幕空间纸张层(CSS)
- `world/` 竞技场(脚手架/undercroft/西楼/catwalk/起重机,几何与碰撞分离)、AABB 碰撞、导航图(A* 同层优先)
- `player/` 控制器(加速/跳/步阶/坠落重置,距离驱动步态相位)
- `enemies/` NPC(8 确定性外观变体+4 职业)、FSM AI(卡死 0.45s 恢复/分离/击退/踉跄)、波次、THE DOODLER
- `weapons/` 5 武器数值与程序化第一人称模型、命中判定(射线-球/胶囊)、武士刀 4 阶段姿势机、抓钩
- `fx/` 弹壳/枪口/烟雾/刀弧/抓钩线池、死亡墨水(红剪影→识别性碎块→地面/墙面持久沉积)
- `hud/` 手写风 HUD(参考规格准星、受击红墨晕+方向双箭头、boss 血条、结束画面)

## 截图证据

`qa/` 目录:`shot_full`(开局)、`shot_npc`、`shot_boss`、`shot_ink`、`shot_stress`、`shot_auto60`。
