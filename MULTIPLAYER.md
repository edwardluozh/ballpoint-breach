# 多人对战模式 (PvP)

## 架构概述

### 网络层 (PeerJS + WebRTC)
- **NetworkManager**: 封装PeerJS,管理P2P连接
- **主机权威**: Host运行游戏逻辑,广播状态;Client发送输入,渲染状态
- **房间系统**: 6位房间码,格式 `bp-XXXXXX`
- **消息类型**: `ready`, `lobby`, `team`, `start`, `state`, `input`, `shoot`, `hit`, `end`

### UI组件
1. **MainMenu** (`src/ui/menu.ts`)
   - 模式选择:单人波次 vs 对战
   - 创建房间 / 加入房间(输入码)

2. **LobbyUI** (`src/ui/lobby.ts`)
   - 显示房间码
   - 团队选择:红队 / 蓝队
   - 玩家名单(分队显示)
   - 开始按钮(仅Host可见)

### 游戏模式
- **PvPGame** (`src/pvp/PvPGame.ts`)
  - 团队死斗(TDM)
  - 团队出生点:红队南侧,蓝队北侧
  - 击杀/死亡计分
  - 重生系统(5秒)

## 集成点

### main.ts 修改
```typescript
// 启动时显示菜单而不是直接进入游戏
const menu = new MainMenu();
menu.onMenuAction(async (action, data) => {
  if (action === 'solo') {
    // 原有单人模式
    enterSoloGame();
  } else if (action === 'createRoom') {
    const net = new NetworkManager();
    const code = await net.createRoom(playerName);
    showLobby(net, code, true);
  } else if (action === 'joinRoom') {
    const net = new NetworkManager();
    await net.joinRoom(data, playerName);
    showLobby(net, data, false);
  }
});
```

### 对战循环
```typescript
// Host (30Hz状态广播)
function updateHost(dt) {
  // 1. 处理客户端输入
  // 2. 更新物理/碰撞/射击
  // 3. 广播状态
  net.send({
    type: 'state',
    players: [...],
    scores: { red, blue },
  });
}

// Client (发送输入)
function updateClient(dt) {
  // 1. 发送输入
  net.send({
    type: 'input',
    keys, mouse, shoot,
  });
  // 2. 插值渲染
  interpolatePlayers(dt);
}
```

## 团队识别

### 视觉区分
- 红队:NPC模型使用 `PAL.red` (#d7304a) 轮廓
- 蓝队:使用 `PAL.blue` (#4a90d7) 轮廓
- 修改 `npcModel.ts` 添加 `teamColor` 参数

### 友军标识
- 头顶显示队友名字(Canvas2D叠加)
- 准星变色:友军绿色,敌军红色

## 测试流程 ✅ 已就绪并修复

### 本地双窗口测试步骤
```bash
# 启动dev服务器
npm run dev

# 窗口A (Host)
1. 打开 http://localhost:5173
2. 点击"对战模式"
3. 点击"创建房间"
4. 记下6位房间码 (例如: ABC123)
5. 点击"加入红队"
6. **等待并确认窗口B玩家出现在蓝队列表**

# 窗口B (Guest) 
1. 打开 http://localhost:5173 (新窗口/隐身模式)
2. 点击"对战模式"
3. 输入房间码: ABC123
4. 点击"加入房间"
5. **确认看到Host在红队列表中**
6. 点击"加入蓝队"
7. **确认两个窗口都显示完整名单 (红队1人,蓝队1人)**

# Host开始对战
8. 窗口A点击"开始对战"

# 游戏开始!
9. 红队(A)出生在南侧(z=+25附近)
10. 蓝队(B)出生在北侧deck(z=-42附近)
11. **两个窗口都能看到对方玩家的简化雪人模型**
12. WASD移动(与单人模式手感一致),鼠标转视角
13. 左键射击对方
14. 击杀敌人得分,死后5秒重生
15. HUD显示: 红队分数 / 蓝队分数
```

### 已修复的Bug (2026-09-11)
1. ✅ **Lobby名单不同步**: Host现在会发送完整roster给新加入的guest
2. ✅ **对战中互相看不见**: 启动时根据lobby名单初始化所有远程玩家mesh
3. ✅ **操作反向**: 移动方向现在与单人模式完全一致 (使用相同的fwd/right向量)

### 预期表现
- 延迟: <100ms (本地),<300ms (同城)
- 移动: 平滑,客户端插值
- 射击: 点击即时发送,主机验证命中
- 死亡: 5秒倒计时重生
- 团队颜色: 红队红色轮廓,蓝队蓝色轮廓

## 已知限制 (MVP)
- 不支持中途加入(对战开始后房间锁定)
- 不支持观战模式(reserved for future)
- 无反作弊(朋友局足够)
- 无语音(可用第三方Discord)

## 下一步
- [ ] 集成菜单到 main.ts
- [ ] 实现对战游戏循环
- [ ] 团队颜色渲染
- [ ] 计分板UI
- [ ] 重生逻辑
- [ ] 端到端测试
