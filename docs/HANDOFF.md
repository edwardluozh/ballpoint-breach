# BALLPOINT BREACH — 接手优化指南(HANDOFF)

> 一句话:纯 TypeScript + Vite + Three.js **全程序化**的圆珠笔手绘风第一人称射击游戏。无任何外部美术/引擎/贴图——建筑、NPC、武器、血迹全部代码生成。本文写给下一个优化者。

## 1. 五分钟上手

```bash
npm install
npm run dev          # http://127.0.0.1:8901/  (点击进入,Esc 暂停)
npm run typecheck    # tsc --noEmit
npm test             # vitest:17 用例(导航连通/NPC 尺寸红线/武器规格/池上限/确定性)
npm run build        # typecheck + vite build
```

**QA 快捷参数**(不影响正常玩法,详见 README):

| URL | 看什么 |
|---|---|
| `?capture=1` | 免点击静态审阅(开局构图) |
| `?capture=1&view=npc / boss / ink / rear / west` | NPC 特写 / boss / 死亡墨水 / 两条远端路线 |
| `?capture=1&stress=1` | 20 敌压力场(右上角显示 draw calls) |
| `?auto=1` | 无人值守仿真(headless 验证波次推进) |

截图工具:`node tools/shot.mjs "capture=1&stress=1" 名字 12000`(第 4 参传 `real` 用真实时间模式)。

## 2. 架构地图(src/)

```
core/     rng.ts        mulberry32 确定性随机——所有"手绘感"必须 seed 驱动,禁 Math.random
          events.ts     类型化事件总线
          input.ts      键鼠 + Pointer Lock,拒绝时自动降级 fallback 瞄准
render/   penFill.ts    ★核心视觉:纸底+多族 seeded 影线 ShaderMaterial(无 time uniform)
          penOutline.ts 手绘轮廓:深主线+断续位移副线,合并在同一 LineSegments
          palette.ts    色板(#29277f 靛蓝 / #c92f4f 红 / #d7a049 赭 / #77c990 薄荷)
world/    arena.ts      全部建筑(脚手架/undercroft/西楼/catwalk/起重机),按材质键合批
          colliders.ts  AABB 世界:推出解算/地面高度/射线/LOS
          navgraph.ts   A*,层切换加惩罚→地面敌人天然走同层
          sky.ts        太阳/云/纸飞机(32s 椭圆巡逻)
player/   controller.ts 移动/跳/步阶/坠落重置;gaitPhase 距离驱动(步频手感的源头)
enemies/  npcModel.ts   雪人外观(8 变体)+ Batch 合批(每具 8 个渲染对象)
          npc.ts        FSM(seek/combat/stagger)+ 卡死 0.45s 恢复 + 投射物池
          waves.ts      5 波编队;boss.ts  THE DOODLER(7 招式+半血二阶段)
weapons/  defs.ts       ★全部数值集中在这一个文件
          system.ts     射击/装填/切枪/命中判定(射线-球/胶囊)/武士刀 4 阶段/抓钩
          viewmodels.ts 5 把程序化第一人称模型
fx/       pools.ts      弹壳/枪口碎片/烟/刀弧/抓钩线(全部预分配)
          deathInk.ts   死亡墨水:红剪影→识别性碎块→地面/墙面沉积(~60s)
hud/      hud.ts        canvas 2d 手写风 HUD(楷体),准星规格见注释
game.ts   总装:事件接线、波次推进、QA 模式、reportPerf(draw call 指示)
main.ts   启动/进入暂停/错误显示/window.__bb capture API
```

**数据流**:输入 → WeaponSystem 发攻击请求 → 共享世界查询(hitscan) → `em.emit('enemyDied'等)` → game 接线处做分数/墨水/移除。改玩法不改渲染、改渲染不改玩法,靠事件总线隔离。

## 3. 关键设计决策(为什么这样做)

1. **手绘不闪烁**:影线/轮廓全部由「世界坐标 + seed」决定,shader 无 time uniform → 相机怎么动笔触都钉在表面。**加任何视觉噪声时不要引入时间项**。
2. **合批按材质键**:`arena.ts` 的 `collectStatic(geo, matKey, ...)`——key 含 seed 桶/密度/纸色/影线色,同 key 几何 `mergeGeometries` 成一个 mesh(静态 ~20 个 draw call + 1 条总轮廓线)。**新建静态件务必走 box()/collectStatic,别直接 group.add**,否则 draw call 会悄悄涨回去。
3. **NPC 动态/静态拆分**:躯干(头/肚/脸/臂/手套)静态合批,腿×2 和武器保留小组做动画——这是 45→8 对象/具的来源。
4. **尺寸红线**(改外观先跑测试):NPC 全高 2.17=3.4×头径、门洞 2.25、眼高 1.58。`tests/gameplay.test.ts` 有断言,违反会红。
5. **布局即契约**:改任何建筑位置先改 `docs/LAYOUT_CONTRACT.md`(含世界坐标表),再改 `arena.ts` 对应段落——导航图 `navgraph.ts` 的节点是照契约手工对应的,布局动了节点也要动,否则敌人会卡在新结构上。
6. **中文文案位置**:HUD 全在 `hud.ts`(楷体 HAND 常量),播报/横幅在 `game.ts`/`waves.ts`/`npc.ts`/`system.ts` 的 `killFeed` emit 处,武器名注解在 `defs.ts`。

## 4. 调参速查(想改手感/难度看这里)

| 想调什么 | 改哪里 |
|---|---|
| 武器伤害/射速/后坐/弹匣/抛壳时点 | `weapons/defs.ts`(集中全部数值) |
| 移动速度/跳跃/步频 | `player/controller.ts` 顶部常量(WALK/SPRINT/JUMP_V/gait 系数 1.62) |
| 敌人血量/速度/伤害/分数 | `enemies/npc.ts` CLASS_STATS |
| 波次编队 | `enemies/waves.ts` WAVES 数组 |
| boss 血量/招式节奏 | `enemies/boss.ts`(hpMax、各 phase timer、speedMul/cdMul) |
| 影线密度/角度/断续率 | `render/penFill.ts` FRAG 里 hatchFamily 调用组 |
| 轮廓弯曲度/副线断续 | `render/penOutline.ts` displace/chance 参数 |
| 血渍形态 | `fx/deathInk.ts` blobPoly(主池)/拖痕/垂滴参数 |
| 受击红晕(中心干净区/峰值/衰减) | `hud/hud.ts` hurtOverlay 渐变 stop + `game.ts` hurt 衰减率 1.45 |

## 5. 已验证状态与已知缺口

**已验证**(证据在 `qa/` + `docs/SELF_REVIEW.md`):开局构图对比、NPC/boss/墨水外观、导航 9 项连通、20 敌 278 draw calls、auto 模式波次推进、typecheck/17 测试/build 全绿。

**缺口与下一步优化方向**(按收益排序):

1. **真人手感校准**:后坐/格挡时机/抓钩/弹速从未真人调过——跑一局,按 §4 表调数值即可,不用动结构。
2. **draw calls 还能再砍**:起重机 boom/brace/cable、补给、锚点、西楼楼板仍是独立对象(~40 个);NPC 武器组可并入躯干批(放弃后坐位移)。目标 <150。
3. **逻辑开销**:敌人 `resolveHorizontal`/`groundHeight` 每帧全盒遍历(~700 盒×20 敌),可加均匀网格 broadphase;`navgraph` A* 的 open 表是线性扫,节点少暂无碍。
4. **影线密度像素级对齐**:当前是帧证据+经验值,可抽参考帧与 `?capture` 同视角叠图微调 density/spacing。
5. **低端软渲染无解**:headless SwiftShader 一帧数秒属正常;真机 GPU 才是目标环境。

## 6. 环境的坑(这台机器特有)

- **Bash 工具 cwd 每次重置到 D:\**:`cd` 不持久,npm 一律用 `npm --prefix /d/claudecode/ballpoint-breach run xxx`。
- **Chrome headless 截图**:同 user-data-dir 复用会静默失败,`tools/shot.mjs` 已用时间戳 profile 规避;截图后立即读文件可能还没落盘,sleep 2 再读。
- **headless 验证仿真用 `?auto=1`**(低频渲染+每帧 120 步补偿),别用 virtual-time-budget 测真实帧率,两者都会骗你。
- **视觉回归靠 qwen-vl**(`~/.claude/skills/vision/vision.py`):小字先 ffmpeg crop 放大再问,直接问全图它会编(读出过不存在的文案)。

## 7. 文档索引

- `docs/REFERENCE_ANALYSIS.md` — 91 帧参考分析(色板/角色卡/动作表/HUD 规格)
- `docs/LAYOUT_CONTRACT.md` — 世界坐标契约(改布局先改它)
- `docs/SELF_REVIEW.md` — 4.0/5 自评 + 优化补记(963→278 calls)
- `README.md` — 运行/操作/QA 参数/架构速览
- `reference/` — 抽帧原图与 42 份分析存档;`qa/` — 全部验证截图
