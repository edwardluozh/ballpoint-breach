# Ballpoint Breach - 对战模式 (Multiplayer)

## 架构 (WebSocket + Durable Object)

**使用 Cloudflare Worker + Durable Object 作为房间服务器。**

- **前端**: 静态 Vite + Three.js 网站(部署至 Cloudflare Pages)
- **后端**: Cloudflare Worker(房间管理、WebSocket 路由)
- **房间服务器**: Durable Object 实例(每个房间一个 DO,持有所有玩家的 WebSocket 连接)
- **网络协议**: WebSocket(客户端 ↔ Worker DO)
- **游戏逻辑**: Host-authoritative(主机运行物理模拟,客户端发送输入)

### 为什么选择这个架构?

1. **免费 tier 友好**: Cloudflare Workers + DO 免费额度足够小规模游戏
2. **低延迟**: WebSocket 直连 Durable Object,比 PeerJS 更稳定
3. **简单部署**: 前端静态托管,Worker 独立部署
4. **Host-authoritative**: 主机运行游戏逻辑,防止作弊
5. **房间隔离**: 每个房间是独立的 DO 实例,自动扩展

---

## 目录结构

```
ballpoint-breach/
├── src/                    # 前端代码(Vite/Three.js)
│   ├── net/
│   │   └── ws-client.ts    # WebSocket 客户端
│   ├── pvp/
│   │   └── PvPGameWS.ts    # PvP 游戏逻辑(使用 PlayerController)
│   ├── ui/
│   │   ├── menu.ts         # 主菜单(单人/对战)
│   │   └── lobby.ts        # 房间大厅(红蓝队选择)
│   └── main.ts             # 主入口(模式切换)
│
├── worker/                 # Cloudflare Worker + DO
│   ├── src/
│   │   ├── index.ts        # Worker 入口(路由、房间码生成)
│   │   └── room.ts         # Durable Object 房间类
│   ├── wrangler.toml       # Worker 配置
│   └── package.json
│
├── package.json
└── README.md
```

---

## 部署指南

### 1. 部署 Multiplayer Worker

Worker 负责房间管理和 WebSocket 连接。

```bash
cd worker
npm install
npx wrangler login      # 首次需要登录 Cloudflare 账号
npx wrangler deploy
```

部署后会得到 Worker URL,例如:
```
https://ballpoint-mp.<your-account>.workers.dev
```

**记下这个 URL!** 前端需要用它连接。

### 2. 配置前端 WebSocket URL

在 Cloudflare Pages 项目设置中添加环境变量:

```
VITE_MP_WS_URL = wss://ballpoint-mp.<your-account>.workers.dev
```

(注意 `wss://` 协议)

或者在本地开发时创建 `.env.local`:

```bash
echo 'VITE_MP_WS_URL=ws://localhost:8787' > .env.local
```

### 3. 部署前端到 Cloudflare Pages

```bash
npm run build
# 然后上传 dist/ 到 Cloudflare Pages
# 或者连接 GitHub 仓库自动部署
```

Pages 地址示例:
```
https://ballpoint-breach.pages.dev
```

---

## 本地开发测试

### 启动 Worker(本地)

```bash
cd worker
npm run dev
# Worker 运行在 http://localhost:8787
```

### 启动前端(本地)

```bash
# 在项目根目录
export VITE_MP_WS_URL=ws://localhost:8787  # 或创建 .env.local
npm run dev
# 前端运行在 http://localhost:5173
```

### 双浏览器测试流程

1. **浏览器 A(Host)**:
   - 打开 `http://localhost:5173`
   - 点击 **"对战"**
   - 点击 **"创建房间"**
   - 记下房间码(例如 `RY51I5`)
   - 选择 **"红队"**
   - 等待对手加入

2. **浏览器 B(Guest)**:
   - 打开新窗口 `http://localhost:5173`
   - 点击 **"对战"**
   - 点击 **"加入房间"**
   - 输入房间码 `RY51I5`
   - 选择 **"蓝队"**
   - 等待主机开始

3. **Host 点击 "开始对战"**

4. **验证**:
   - 两边都能看到对方的角色网格
   - WASD 移动,鼠标视角 - **和单人模式完全一样的手感**
   - 红队/蓝队用不同颜色的线框表示
   - HUD 显示红蓝队分数、HP、队伍

---

## 网络协议

### Client → Server 消息

| type      | 说明               | 参数                                |
|-----------|--------------------|-------------------------------------|
| `hello`   | 客户端加入房间     | `name: string`                      |
| `team`    | 选择队伍           | `team: 'red' \| 'blue' \| 'spectator'` |
| `start`   | 主机开始对战       | -                                   |
| `input`   | 客户端发送输入     | `pos, vel, yaw, pitch, hp, alive`   |
| `shoot`   | 客户端射击         | `origin, dir`                       |
| `leave`   | 离开房间           | -                                   |

### Server → Client 消息

| type      | 说明               | 参数                                |
|-----------|--------------------|-------------------------------------|
| `welcome` | 服务器欢迎新连接   | `playerId, isHost, roomCode`        |
| `roster`  | 房间完整名单       | `players: [{id,name,team,ready}]`, `hostId` |
| `start`   | 对战开始           | -                                   |
| `state`   | 主机广播游戏状态   | `players: [{id,pos,yaw,pitch,hp,alive,team}]`, `redScore, blueScore` |
| `clientInput` | 转发客户端输入给主机 | `playerId, pos, vel, yaw, pitch, hp, alive` |
| `clientShoot` | 转发客户端射击给主机 | `playerId, origin, dir` |
| `event`   | 游戏事件(死亡等)   | `eventType, ...`                    |
| `promoted`| 你被提升为主机     | `isHost: true`                      |
| `error`   | 错误消息           | `message: string`                   |

### 房间码

- 6 位大写字母 + 数字(排除易混淆字符 `0OI1`)
- 房间码 = Durable Object ID(`idFromName(code)`)
- 一个房间码 = 一个 DO 实例 = 一个隔离的游戏房间

---

## 游戏逻辑

### Host-Authoritative 模型

- **Host 运行**: 物理模拟、碰撞检测、射击判定、伤害计算、重生
- **Client 发送**: 输入(移动、视角、射击)
- **Host 广播**: 完整游戏状态(所有玩家位置/HP/存活)给所有客户端
- **Client 渲染**: 根据服务器状态插值显示远程玩家

### 使用 PlayerController

PvP 模式 **复用** 单人模式的 `PlayerController`:
- WASD/冲刺/跳跃/重力/碰撞 - 完全一致
- 不再重新实现移动代码
- `PvPGameWS` 只是薄胶水层,调用 `PlayerController.update(dt)`

### 网络更新频率

- **Client→Host input**: ~30Hz(每 33ms)
- **Host→Client state**: ~20Hz(每 50ms)

---

## 限制和已知问题

1. **延迟**: 目前无客户端预测 + 服务器校正,高延迟会感觉卡顿
2. **主机掉线**: 主机离开时,会提升第一个客户端为新主机,但游戏状态会丢失
3. **无伤害系统**: 目前射击没有命中判定(TODO: 主机端 hitscan)
4. **无重生**: 死亡后需要手动刷新(TODO: 5 秒重生计时器)
5. **房间容量**: 目标 2-8 人,未测试大规模

---

## 下一步优化

- [ ] 客户端预测 + 服务器校正(减少延迟感)
- [ ] 射击命中判定(主机端 hitscan)
- [ ] 死亡/重生系统(5 秒倒计时)
- [ ] 回合制/积分榜
- [ ] 观战模式
- [ ] 房间持久化(DO Alarm 定时清理空房间)

---

## FAQ

**Q: 为什么不用 PeerJS?**  
A: PeerJS 是 P2P,房间管理复杂,NAT 穿透不稳定。DO + WebSocket 是中心化服务器,更简单可靠。

**Q: 免费 tier 够用吗?**  
A: Cloudflare Workers 免费额度:
- 100,000 请求/天
- Durable Object: 1GB 存储 + 1M 读写/月
对于小规模测试/朋友开黑完全足够。

**Q: 如何防止作弊?**  
A: Host-authoritative 模型,主机验证所有操作。客户端只能发送输入,不能直接修改 HP/位置。

**Q: 单人模式还能玩吗?**  
A: 可以!主菜单选 **"单人闯关"** 即可,完全离线,不需要 Worker。

---

## 联系和贡献

有问题或建议?欢迎提 issue 或 PR!
