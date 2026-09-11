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

## 测试流程

### 本地双窗口测试
1. 打开浏览器A → 点击"对战模式" → "创建房间" → 记录房间码
2. 打开浏览器B → 点击"对战模式" → 输入房间码 → "加入房间"
3. A选红队,B选蓝队
4. A点击"开始对战"
5. 两边出生在对面,可以移动/射击/相互伤害
6. 击杀计分,死后5秒重生

### 预期表现
- 延迟: <100ms (本地),<300ms (同城)
- 丢包容忍: 客户端插值平滑
- 断线: Host断线游戏结束,Client断线踢出

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
