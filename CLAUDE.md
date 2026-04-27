# CLAUDE.md

本文件为 [Claude Code](https://claude.com/claude-code) 在本仓库工作时提供指引。

## 项目概览

**Gomoku Battle** — 双人在线实时对战五子棋，特色是 **连五得分制（连五后棋子被移除可继续落子，多次得分）**。

- 前端：React 18 + TypeScript + Vite + Twind（运行时 Tailwind）+ Canvas 棋盘
- 后端：Cloudflare Workers + Durable Objects (SQLite)，使用 WebSocket Hibernation
- 单仓双部署：根目录是前端，`worker/` 是后端
- 通信协议：`src/types/protocol.ts` 是前后端共享的真相源

## 常用命令

```bash
# 前端
npm install
npm run dev              # vite dev (默认 5173)
npm run build            # tsc -b && vite build
npm run preview          # 预览 dist
npx tsc -b               # 仅类型检查（含 references）

# Worker
cd worker && npm install
npm run dev:worker       # 在仓库根：cd worker && wrangler dev (8787)
cd worker && npx tsc --noEmit  # worker 类型检查
cd worker && npx wrangler deploy
```

**修改前端代码后必须运行 `npx tsc -b`；修改 worker 代码后必须运行 `cd worker && npx tsc --noEmit`。** 类型检查通过才能视为完成。

## 架构核心

### Durable Object 单房间模型
- 每个 6 位房间号 → `env.GOMOKU_ROOM.idFromName(code)` → 一个 DO 实例
- 所有 WebSocket 连接由同一个 DO 处理 → 天然单线程，无需并发控制
- DO 内部状态通过 `this.ctx.storage` 持久化，`ensureLoaded()` 在每个 fetch 入口处幂等加载

### WebSocket Hibernation API
- 使用 `this.ctx.acceptWebSocket(ws)` 而非传统 `ws.accept()`，DO 闲置时可休眠
- 玩家身份通过 `ws.serializeAttachment({ playerId, playerName })` 持久化在连接上
- 任何处理函数必须先 `await this.ensureLoaded()` 再访问字段

### 消息流向
```
客户端 useWebSocket → wsRef.send(JSON) →
  worker /api/rooms/:code/ws → 透传到 DO →
  GomokuRoom.webSocketMessage(ws, raw)
```
DO 通过 `this.broadcast()` / `this.broadcastExcept()` / `this.sendTo(ws)` 主动推送。

### 协议契约
- **任何消息字段变更必须同时改 `src/types/protocol.ts` 和 `worker/src/room.ts`**
- 客户端发的消息以 `Record<string, unknown>` 进入 worker，需手动校验类型
- 服务端发的消息客户端用 `ServerMessage` 类型缩窄

### 关键不变量
- `currentTurn`：1 = 黑方落子，2 = 白方落子；落子后切换
- 棋盘单元格值：`0` 空 / `1` 黑 / `2` 白
- `findScoringLines` 返回所有 ≥5 子的方向；每条独立得分；连成的棋子立即清空（保留落子的"第一手"也一并移除，可继续在原处落子）
- `phase`：`waiting` → `readying` → `playing` → `ended`，`playAgain` 后回到 `readying`
- 房主分配：第一个加入的玩家成为 `ownerId`；房主退出时下一个玩家自动接管

### 定时器（Alarm）
- DO 用 `ctx.storage.setAlarm()` 单一闹钟调度多个截止：
  - 断线宽限期（默认 30s，`pagehide` 后改为 5s）
  - 游戏倒计时（`gameStartedAt + timerMinutes * 60_000`）
  - 5 分钟不活跃自动关闭房间
- `scheduleAlarm()` 每次都重算最近的截止时间

## 代码约定

- **所有 `if` 语句必须用花括号**（含单行）
- TypeScript 严格模式 + `noUncheckedIndexedAccess`：访问数组/对象元素必须用 `!` 或显式判空
- 二维棋盘访问统一用 `board[r]![c]`
- 中文注释 + 中文 commit 信息（`feat:` / `fix:` / `style:` 等前缀保留英文）
- 不写多行 docstring；只在 WHY 不显然时写一行注释
- 编辑完成后运行 `npx tsc -b`（前端）或 `cd worker && npx tsc --noEmit`（worker），通过才算完成

## 部署

- **GitHub Actions 按变更路径触发**：
  - `worker/**` 之外的变更 → `deploy-pages.yml` → Cloudflare Pages
  - `worker/**` 变更 → `deploy-worker.yml` → Cloudflare Workers
- `master` 分支 push 即触发；不要手动跑部署除非用户明确要求
- 需要 Secrets：`CF_API_TOKEN`、`CF_ACCOUNT_ID`
- 自定义域名路由由 `worker/wrangler.toml` 中的 `routes` 指定（当前是 `gomoku.dengjiabei.cn/api/*`）

## 常见陷阱

### 前端
- **`useWebSocket` 自动重连**会创建新连接，但客户端代码必须在 `connected` 变化时重新发 `join`，否则后端无法识别该连接（参见 `src/pages/Room.tsx` 的 join useEffect）。**不要**用一次性 ref 守卫 join。
- **Canvas 高 DPI**：每次 size 变化要重新 `setTransform(dpr, 0, 0, dpr, 0, 0)`，否则模糊
- **AudioContext 须在用户交互后创建**：首次落子由用户点击触发，但对手落子触发的音效用同一个 ctx 实例没问题；不要在 mount 时就创建
- **重连恢复 lastMove 不应播音**：`GomokuBoard` 用 `mountedRef` 跳过首次 effect
- **Twind 样式是运行时**：在 `main.tsx` 中 `install()`，类名不需要构建步骤，但 IDE 不会自动补全
- **修改共享对象前必须复制**：`board.map(row => [...row])`，不要原地修改

### 后端
- **创建房间号必须查重**：6 位数字仅有 100 万种取值，碰撞时若直接 `/init` 会覆盖现有游戏
- **storage.put 务必 await 或 waitUntil**：fire-and-forget 在 hibernation 后可能丢失（系统消息已用 `ctx.waitUntil` 包装）
- **`getActivePlayers()` 包含离线但未到 grace 期的玩家**：用于占位以阻止第三方加入；处理"玩家计数"时注意区分
- **`setAttachment(ws, null)` 用于把连接标记为"无效"**：避免 close 触发 disconnect 时被当作正常玩家处理
- **`webSocketClose` / `webSocketError` 都要先 `ensureLoaded`**：休眠后第一次回调时 DO 字段是空的
- **Alarm 内的 `disconnectedPlayers.delete(id)` 必须在 `findWsByPlayerId` 检查前**，但删除后还要确认确无 ws 才广播 `playerLeft`
- **不要直接读 `playerReady.get(id)`**：未设置时是 `undefined`，要 `|| false`

### 协议同步
- 修改任何 `S_*` 或 `C_*` 接口都需要：
  1. `src/types/protocol.ts` 增删字段
  2. `worker/src/room.ts` 对应的发送/接收处理
  3. 前端组件中按需消费/构造
  4. 跑两端 tsc

## 不要做

- 不要绕过类型系统（`as unknown as T`、`@ts-ignore`），如有必要先重新设计接口
- 不要在 Room 组件 unmount 时手动 close ws —— `useWebSocket` 的 cleanup 已处理；多重 close 会触发 disconnect 误判
- 不要用 `Math.random()` 生成需要全局唯一的 ID（playerId 容忍碰撞，房间号已用查重重试）
- 不要直接修改 board 状态：`setBoard(prev => prev.map(r => [...r]))` 是必须的，否则 React 不重渲染
- 不要在 worker 中使用 Node.js API（`fs`、`path`、`Buffer` 等），只能用 Web Standards
- 不要手动改 `package-lock.json`；`worker/package-lock.json` 也是

## 文件速查

- 客户端入口与 sessionStorage：`src/App.tsx`
- WebSocket 自动重连/心跳：`src/hooks/useWebSocket.ts`
- 棋盘渲染与音效：`src/components/GomokuBoard.tsx`
- 房间主界面（消息分发）：`src/pages/Room.tsx`
- 协议（前后端契约）：`src/types/protocol.ts`
- HTTP 路由 + 房号分配：`worker/src/index.ts`
- 房间状态机 + 游戏逻辑：`worker/src/room.ts`
- 部署配置：`worker/wrangler.toml`、`.github/workflows/*.yml`
