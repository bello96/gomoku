# 五子棋对战 (Gomoku Battle)

双人在线实时对战五子棋，支持 **连五得分制**、**限时比拼**、**断线重连**、**实时聊天**。

**🎮 在线体验**: <https://gomoku.dengjiabei.cn/>

---

## 🎯 游戏规则

- **棋盘**：15×15 标准棋盘，黑白交替落子
- **得分**：连成五子（横/竖/斜）即得 1 分，**得分棋子被立即移除**，可继续在原位置落子
- **限时**：可设置 3 / 5 / 10 / 15 分钟，超时按当前分数判胜负
- **结束方式**：超时、投降、棋盘填满、对方离开
- **平局**：限时结束时双方分数相同

## 🕹️ 操作方式

- 点击棋盘交叉点落子（仅在自己回合）
- 鼠标悬停预览落子位置（半透明棋子）
- 红点标记最后一手棋
- 得分时高亮连成的五子并以金色连线标识

---

## 🛠 技术栈

| 层级       | 技术                                            |
| ---------- | ----------------------------------------------- |
| 前端框架   | React 18 + TypeScript + Vite 6                  |
| 样式       | Twind v1（运行时 Tailwind，零构建配置）         |
| 渲染       | HTML5 Canvas（高 DPI 支持，ResizeObserver 自适应） |
| 后端       | Cloudflare Workers + Durable Objects (SQLite)   |
| 通信       | WebSocket（hibernation API，闲置自动休眠）      |
| 部署       | Cloudflare Pages + Workers                      |
| CI/CD      | GitHub Actions（变更路径触发）                  |

---

## 📁 项目结构

```
gomoku/
├── src/                                # 前端源码
│   ├── components/
│   │   ├── GomokuBoard.tsx             # Canvas 棋盘渲染 + 音效
│   │   ├── ChatPanel.tsx               # 实时聊天
│   │   ├── PlayerBar.tsx               # 房间信息栏（房号/玩家/操作）
│   │   └── Confetti.tsx                # 胜利彩带特效
│   ├── pages/
│   │   ├── Home.tsx                    # 创建/加入房间
│   │   └── Room.tsx                    # 游戏房间主界面
│   ├── hooks/
│   │   └── useWebSocket.ts             # WebSocket + 心跳 + 指数退避重连
│   ├── types/
│   │   └── protocol.ts                 # 前后端共享消息协议
│   ├── api.ts                          # API 地址 / 房间 fetch 工具
│   ├── App.tsx                         # 路由 + sessionStorage 会话管理
│   └── main.tsx                        # 入口（Twind 初始化）
│
├── worker/                             # Cloudflare Worker
│   ├── src/
│   │   ├── index.ts                    # HTTP 路由 + 房间号分配
│   │   └── room.ts                     # GomokuRoom Durable Object
│   ├── wrangler.toml                   # Worker 配置 + 路由 + DO 绑定
│   └── tsconfig.json
│
├── .github/workflows/
│   ├── deploy-pages.yml                # 前端自动部署（worker/** 之外的变更触发）
│   └── deploy-worker.yml               # Worker 自动部署（worker/** 变更触发）
│
├── .env.example                        # 环境变量模板
├── .env.development                    # 本地开发环境变量
├── vite.config.ts
└── tsconfig.{json,app.json,node.json}
```

---

## ✨ 核心特性

### 连五得分制
- 一次落子可同时形成多个方向的五连，每条独立计分
- 连成五子的棋子立即清除，腾出空间继续对弈
- 得分动效：金色描边 + 连线 600ms 后清盘

### 限时对战
- 房主在准备阶段选择限时
- 倒计时最后 30 秒红色警告
- 超时按当前分数判胜负，分数相同记平局

### 断线重连
- 默认 30 秒重连窗口
- `pagehide` 时通过 `navigator.sendBeacon` 发送快速离线信号，缩短为 5 秒
- 重连成功后服务端通过 `roomState` 完整恢复棋盘、分数、计时、聊天历史
- WebSocket 自动重连：指数退避 1s / 2s / 4s / 8s / 15s

### 房间分享
- 6 位数字房间号 + URL 邀请（`/{roomCode}`）
- 通过链接进入显示房主昵称："**XXX 邀请你一起下五子棋**"
- 创建时房间号去重，最多重试 10 次避免碰撞

### 实时聊天
- 游戏内消息无长度限制（单条 ≤ 500 字符），保留最近 200 条
- 系统消息自动推送：开局、得分、胜负、玩家加入/离开
- 重连后自动恢复完整聊天历史

---

## 🔌 消息协议

前后端通过 WebSocket 交换 JSON 消息，类型定义统一在 `src/types/protocol.ts`。

### 客户端 → 服务端

| 类型            | 字段                         | 说明                       |
| --------------- | ---------------------------- | -------------------------- |
| `join`          | `playerName`, `playerId?`    | 加入房间或重连恢复         |
| `ready`         | -                            | 切换准备状态（仅非房主）   |
| `setTimer`      | `minutes` (1–30)             | 房主设置限时               |
| `startGame`     | -                            | 房主开始游戏               |
| `placePiece`    | `row`, `col`                 | 落子                       |
| `chat`          | `text` (≤ 500 chars)         | 发送聊天                   |
| `surrender`     | -                            | 投降                       |
| `playAgain`     | -                            | 房主发起新一局             |
| `transferOwner` | -                            | 转让房主（仅非游戏中）     |
| `leave`         | -                            | 主动离开                   |
| `ping`          | -                            | 客户端心跳（每 25s）       |

### 服务端 → 客户端

| 类型            | 用途                                                  |
| --------------- | ----------------------------------------------------- |
| `roomState`    | 全量房间快照（加入 / 重连后下发）                     |
| `playerJoined` | 新玩家或断线玩家重连                                  |
| `playerLeft`    | 玩家离开（含 grace 期到期清理）                       |
| `phaseChange`   | 游戏阶段切换 + 房主变更                               |
| `gameStart`     | 游戏开局（含黑白分配、棋盘）                          |
| `piecePlaced`   | 落子结果（含得分线、被移除棋子）                      |
| `gameEnd`       | 游戏结束（胜者、原因、最终比分）                      |
| `readyChanged`  | 准备状态变化                                          |
| `timerChanged`  | 限时变化                                              |
| `chat`          | 聊天消息（含系统消息）                                |
| `error`         | 业务错误，前端以 toast 展示                           |
| `roomClosed`    | 房间关闭（长时间无操作 / 显式关闭）                   |

---

## 🚀 本地开发

### 1. 安装依赖

```bash
npm install
cd worker && npm install && cd ..
```

### 2. 启动开发服务

**方式 A：前端走线上 API（推荐）**

```bash
npm run dev          # 前端：localhost:5173，API 走 .env.development 配置的线上 worker
```

**方式 B：本地起 Worker**

```bash
npm run dev:worker   # Cloudflare Workers 本地：localhost:8787
# 同时另起一个终端：将前端的 VITE_API_BASE 改为 http://localhost:8787
echo "VITE_API_BASE=http://localhost:8787" > .env.development.local
npm run dev
```

### 3. 环境变量

复制 `.env.example` 为 `.env.development.local` 进行本地覆盖：

```bash
cp .env.example .env.development.local
```

| 变量            | 用途                                                       |
| --------------- | ---------------------------------------------------------- |
| `VITE_API_BASE` | API 地址。留空则用页面 origin；本地开发常设为线上或 `http://localhost:8787` |

### 4. 类型检查 / 构建

```bash
npx tsc -b           # 仅类型检查（前端 + 子项目）
npm run build        # 完整构建（输出到 dist/）
npm run preview      # 预览构建产物
```

Worker 单独类型检查：

```bash
cd worker && npx tsc --noEmit
```

---

## 🌐 部署

### 自动部署（推荐）

推送到 `master` 分支后 GitHub Actions 会按变更路径自动部署：

- 非 `worker/**` 的变更 → Cloudflare Pages（前端）
- `worker/**` 的变更 → Cloudflare Workers

需要在 GitHub Secrets 中配置：
- `CF_API_TOKEN`：Cloudflare API Token（含 Pages + Workers 编辑权限）
- `CF_ACCOUNT_ID`：Cloudflare Account ID

### 手动部署

```bash
# 前端
npm run build
npx wrangler pages deploy dist --project-name=gomoku

# Worker
cd worker
npx wrangler deploy
```

### Cloudflare 资源准备

- **Pages 项目**：名称 `gomoku`
- **Worker**：名称 `gomoku-worker`，绑定 Durable Object `GOMOKU_ROOM`
- **Custom Route**：`gomoku.dengjiabei.cn/api/*` → Worker（需在 `wrangler.toml` 修改为你自己的域名）
- **DO Migration**：`new_sqlite_classes = ["GomokuRoom"]`（首次部署时由 wrangler 自动应用）

---

## 🏗 架构要点

### Durable Object 单房间模型
每个房间号 = 一个 Durable Object 实例（通过 `idFromName(code)` 派生）。所有玩家的 WebSocket 连接收敛到同一个 DO，天然消除并发与状态同步问题。

### WebSocket Hibernation
Worker 使用 `ctx.acceptWebSocket()` + `ws.serializeAttachment()`，闲置时 DO 可休眠节省资源，恢复时通过 attachment 还原 playerId/playerName。

### 持久化策略
游戏关键状态（棋盘、分数、聊天、玩家就绪状态）写入 DO storage。重启或休眠后通过 `ensureLoaded()` 一次性恢复，玩家再连接时重发 `roomState`。

### 定时器调度
通过 `ctx.storage.setAlarm()` 统一调度：断线宽限期、游戏倒计时、不活跃房间清理。`alarm()` 触发后重新调度下一次最小到期时间。

### 房间号分配
6 位数字房间号容量 100 万，创建时通过 `/info` 探测目标 DO 是否已被占用，最多重试 10 次再失败。

---

## 🤝 贡献

仓库使用约定式提交（Conventional Commits）：

- `feat:` 新功能
- `fix:` 修复
- `style:` 样式调整
- `docs:` 文档
- `refactor:` 重构

提交信息描述部分请使用中文。

---

## 📜 License

MIT
