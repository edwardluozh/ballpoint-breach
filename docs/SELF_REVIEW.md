# BALLPOINT BREACH — 最终自评(scored self-review)

日期:2026-09-11。评分 1-5。每项附证据;缺口如实列出。

## 0. 2026-09-11 优化补记(用户反馈:卡顿掉帧 + 界面中文化)

| 项 | 前 | 后 | 证据 |
|---|---|---|---|
| stress(20 敌)draw calls | 963 | **278** | `qa/shot_stress2/3.png` stage 指示器 |
| 静态建筑渲染对象 | ~530 mesh+线 | ~20(按材质合并)+1 轮廓 LineSegments | `arena.ts` collectStatic/mergeGeometries |
| 每 NPC 渲染对象 | ~45 | **8**(躯干批 2+腿 4+武器 2) | `npcModel.ts` Batch 重写 |
| 投射物轨迹 | 每帧 dispose/new 几何 | 预分配 5 点缓冲 | `npc.ts` ProjectilePool |
| 敌人视线检测 | 每帧全盒 raycast | 0.15s 缓存 | `npc.ts` losCache |
| 渲染像素比 | min(dpr,2) | min(dpr,1.5) | `game.ts` |
| 界面语言 | 英文 | **全中文**(楷体手写风:得分/第 N 波/生命/武器名/播报/结束画面) | `qa/shot_cn.png` vision 复核 |

typecheck / 17 测试 / build 全部通过;外观变体、动画钩子、尺寸红线不变(测试断言)。

## A. 完成度对照 Definition of Done

| 要求 | 分 | 证据 | 缺口 |
|---|---|---|---|
| 大竞技场/建筑关系/NPC 尺度/第一人称构图/色板/影线/HUD 过参考对比 | 4 | `qa/shot_full.png`(开局含脚手架+undercroft+西楼+起重机+纸飞机)vs `reference/frames/ov_01.png`;vision 复核"多层脚手架/横贯高架/两层小楼/箱子/吊臂均可见,无明显穿模" | 影线密度与参考逐面比对未做量化;太阳位置/云量靠帧证据定性 |
| NPC 同族外观 + 有界个体变化 | 4 | `qa/shot_npc.png`:5 体(4 职业)雪人语言一致;vision 确认头/肚/鞋/手套/脸/武器齐全、变体有差异;17 项单测含 8 变体确定性 | 远距离可读性未做 60m 实测 |
| 死亡墨水四阶段(剪影/方向碎块/墙地沉积/持久历史) | 4 | `qa/shot_ink.png`:vision 确认主池+回声+≥3 拖痕+卫星滴、无"圆戳/同心圆/星爆"、墙渍有重力垂滴、组间变体差异 | 剪影 0.10s 与碎片飞散属代码实现,headless 未逐帧取证 |
| 全操作/5 武器/抓钩/敌职业/导航恢复/5 波/boss/胜负重开 | 3.5 | `qa/shot_auto60.png` stage=`auto ... wave=1 e=4 hp=150`(无人值守仿真推进到波 1、敌人生成);typecheck+17 测试通过 | **交互手感(真人开枪/格挡反弹/抓钩/切枪)未经真人试玩**;boss 二阶段仅代码路径 |
| Pointer Lock 不可用不立即暂停 | 4 | `main.ts` fallbackAim 路径;auto 模式即以 fallback 运行(headless 无锁)证明可用 | Windows 真机浏览器弹权限策略的行为差异未测 |
| typecheck / test / build | 5 | 三者全绿;build 产物 570KB(gzip 150KB) | chunk>500KB 警告(单 three 依赖,可 code-split,未做) |
| 无持续 runtime/shader 错误 | 4 | 全部 QA 截图无红色错误框;auto 长跑无异常 | 未做 console 级零警告审计 |
| 压力场景有界 | 4 | `qa/shot_stress.png` 20 敌完整渲染;弹壳/碎片/弹池/血渍全部预分配,单测断言池不增长 | headless 软渲染无法测真实 fps;527 draw calls 真机无碍但未优化合并 |
| 最终打分自评 | — | 本文件 | — |

**总分:4.0 / 5**

## B. 拒绝清单核对(Non-negotiables)

- ✅ 未缩小地图(72×78,契约 §A-F 全量落地,导航测试断言东西/南北贯通)
- ✅ 未放大 NPC(2.17 全高、3.4×头径,测试断言;门洞 2.25)
- ✅ 无镜像 NPC(左右鞋不同形、seed 扰动头/肚/四肢)
- ✅ 步枪为细长棱角+方框全息镜(非方块枪)
- ✅ 武士刀 contact 帧才结算(windup 0.13s→contact 判定,非 mouse-down)
- ✅ 敌人卡死 0.45s 弃目标走确定性逃逸向(recoverStuck,射线探测四向)
- ✅ 红屏受击+双 chevron+中心 300px 干净+680ms 衰减(open_01 帧证实参考亦无永久红晕)
- ✅ 枪械抛壳/下坠/弹跳/退役、霰弹 0.27s 泵点抛壳、狙击 0.31s、左轮留膛(测试断言)
- ✅ 天空纸飞机 32s 椭圆巡逻
- ✅ 死亡非红块/非通用爆裂/非单戳(ink 截图 vision 复核)
- ✅ 影线为多族 seeded shader 笔触,非单张平铺纹理;无 time uniform,相机移动不闪
- ⚠️ "不止于静态 mock":auto 仿真可推进波次,但交互深度待真人试玩确认

## C. 主要缺口(按优先级)

1. **真人试玩未做**:后坐手感、武士刀反弹时机窗、抓钩手感、boss 战节奏,需要一次 10 分钟真人通关校准(数值都在 `WEAPONS`/`CLASS_STATS`/Boss 集中可调)。
2. **性能未真机量化**:headless SwiftShader 一帧数秒不具参考性;真机 GPU 预计 60fps,但 527 draw calls 可通过合并静态轮廓几何(mergePenOutlines 已有工具)再降一个量级。
3. **敌人 AI 寻路开销**:repath 1.1s/敌 + A* 线性 open 表,20 敌软渲染环境偏慢;可加粗粒度路径缓存。
4. **影线/笔触最终对齐**:与参考逐帧像素对比(density/弯度/断续率)未做,当前值为帧证据+经验值。
5. **武士刀 viewmodel 姿势轴**:4 阶段多轴已实现,但弧线轨迹与参考的"正反交替"在视觉上仅二态,可再细分。
6. **音效**:参考未要求,未实现(明确不阻塞)。

## D. 交付物清单

- 源码 `src/`(12 模块)+ `tests/`(2 文件 17 用例)+ `tools/shot.mjs`
- `docs/REFERENCE_ANALYSIS.md`、`docs/LAYOUT_CONTRACT.md`、`docs/SELF_REVIEW.md`
- `qa/` 7 张验证截图;`reference/` 91 帧抽取 + 42 份 vision 分析存档
- `npm run typecheck / test / build` 全部通过
