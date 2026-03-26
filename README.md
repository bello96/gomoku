# 五子棋对战

双人在线实时对战五子棋，支持连五得分、限时比拼、断线重连、实时聊天。

**在线体验**: https://gomoku.dengjiabei.cn/

## 游戏规则

- 15x15 标准棋盘，黑白交替落子
- 连成五子（横/竖/斜）即得分，得分棋子被移除
- 可设置限时（3/5/10/15 分钟），超时判负
- 支持投降、再来一局

## 操作方式

- 点击棋盘交叉点落子（仅在自己回合）
- 悬停预览落子位置（半透明棋子）
- 红点标记最后一手

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + Twind |
| 渲染 | HTML5 Canvas（高 DPI 支持） |
| 后端 | Cloudflare Workers + Durable Objects |
| 通信 | WebSocket（实时同步） |
| 部署 | Cloudflare Pages + Workers |
| CI/CD | GitHub Actions |

## 项目结构

```
gomoku/
├── src/
│   ├── components/
│   │   ├── GomokuBoard.tsx      # Canvas 棋盘渲染
│   │   ├── ChatPanel.tsx        # 实时聊天
│   │   ├── PlayerBar.tsx        # 房间信息栏
│   │   └── Confetti.tsx         # 胜利特效
│   ├── pages/
│   │   ├── Home.tsx             # 创建/加入房间
│   │   └── Room.tsx             # 游戏房间
│   ├── hooks/useWebSocket.ts    # WebSocket 自动重连
│   ├── types/protocol.ts       # 前后端共享消息协议
│   ├── api.ts                   # API 地址配置
│   ├── App.tsx                  # 路由 + 会话管理
│   └── main.tsx                 # 入口
├── worker/
│   └── src/
│       ├── index.ts             # HTTP 路由
│       └── room.ts              # GomokuRoom Durable Object
├── .github/workflows/
│   ├── deploy-pages.yml         # 前端自动部署
│   └── deploy-worker.yml        # Worker 自动部署
└── .env.development             # 开发环境配置
```

## 核心特性

- **连五得分制**: 连成五子得分并移除，可多次得分
- **限时对战**: 可配置 3/5/10/15 分钟，倒计时最后 30 秒红色警告
- **断线重连**: 30 秒内重连恢复游戏状态
- **房间分享**: 6 位房间号 + 链接邀请
- **实时聊天**: 游戏内聊天，系统消息自动推送

## 本地开发

```bash
# 安装依赖
npm install
cd worker && npm install && cd ..

# 启动前端（代理线上 API）
npm run dev

# 启动本地 Worker（可选）
npm run dev:worker
```

## 部署

推送到 `master` 分支后 GitHub Actions 自动部署：

- 前端变更 → Cloudflare Pages
- `worker/` 变更 → Cloudflare Workers

手动部署：

```bash
npm run build
npx wrangler pages deploy dist --project-name=gomoku
cd worker && npx wrangler deploy
```

## License

MIT
