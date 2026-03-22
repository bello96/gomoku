import { DurableObject } from "cloudflare:workers";

/* ── 类型定义 ── */
type GamePhase = "waiting" | "readying" | "playing" | "ended";

interface PlayerInfo {
  id: string;
  name: string;
  online: boolean;
  ready: boolean;
}

interface ChatMessage {
  id: string;
  kind: "chat" | "system";
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

interface DisconnectedPlayer {
  name: string;
  disconnectedAt: number;
  quickLeave: boolean;
  ready: boolean;
}

interface WsAttachment {
  playerId: string;
  playerName: string;
}

/* ── 常量 ── */
const BOARD_SIZE = 15;
const MAX_PLAYERS = 2;
const GRACE_PERIOD = 30_000;
const QUICK_GRACE = 5_000;
const INACTIVITY_TIMEOUT = 5 * 60_000;
const MAX_CHAT = 200;

/* ── 五子连珠检测 ── */
function findScoringLines(
  board: number[][],
  row: number,
  col: number,
): number[][] {
  const color = board[row]![col]!;
  if (color === 0) {
    return [];
  }
  const lines: number[][] = [];
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dr, dc] of directions) {
    const cells: [number, number][] = [[row, col]];

    // 正向
    let r = row + dr!;
    let c = col + dc!;
    while (
      r >= 0 &&
      r < BOARD_SIZE &&
      c >= 0 &&
      c < BOARD_SIZE &&
      board[r]![c] === color
    ) {
      cells.push([r, c]);
      r += dr!;
      c += dc!;
    }

    // 反向
    r = row - dr!;
    c = col - dc!;
    while (
      r >= 0 &&
      r < BOARD_SIZE &&
      c >= 0 &&
      c < BOARD_SIZE &&
      board[r]![c] === color
    ) {
      cells.push([r, c]);
      r -= dr!;
      c -= dc!;
    }

    if (cells.length >= 5) {
      cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      lines.push(cells.flat());
    }
  }

  return lines;
}

function createEmptyBoard(): number[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(0),
  );
}

/* ── GomokuRoom Durable Object ── */
export class GomokuRoom extends DurableObject {
  private loaded = false;
  private roomCode = "";
  private created = 0;
  private closed = false;
  private phase: GamePhase = "waiting";
  private ownerId: string | null = null;
  private timerMinutes = 5;
  private board: number[][] = createEmptyBoard();
  private currentTurn = 1;
  private blackPlayerId: string | null = null;
  private whitePlayerId: string | null = null;
  private scores: Record<string, number> = {};
  private gameStartedAt: number | null = null;
  private winner: { id: string; name: string } | null = null;
  private isDraw = false;
  private chatHistory: ChatMessage[] = [];
  private scoredLines: number[][] = [];
  private lastMove: { row: number; col: number } | null = null;
  private lastActivityAt = 0;
  private disconnectedPlayers = new Map<string, DisconnectedPlayer>();
  private playerReady = new Map<string, boolean>();

  /* ── 持久化 ── */
  private async ensureLoaded() {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    const s = this.ctx.storage;
    const data = await s.get([
      "roomCode",
      "created",
      "closed",
      "phase",
      "ownerId",
      "timerMinutes",
      "board",
      "currentTurn",
      "blackPlayerId",
      "whitePlayerId",
      "scores",
      "gameStartedAt",
      "winner",
      "isDraw",
      "chatHistory",
      "scoredLines",
      "lastMove",
      "lastActivityAt",
      "playerReady",
    ]);

    this.roomCode = (data.get("roomCode") as string) || "";
    this.created = (data.get("created") as number) || 0;
    this.closed = (data.get("closed") as boolean) || false;
    this.phase = (data.get("phase") as GamePhase) || "waiting";
    this.ownerId = (data.get("ownerId") as string) || null;
    this.timerMinutes = (data.get("timerMinutes") as number) || 5;
    this.board =
      (data.get("board") as number[][]) || createEmptyBoard();
    this.currentTurn = (data.get("currentTurn") as number) || 1;
    this.blackPlayerId = (data.get("blackPlayerId") as string) || null;
    this.whitePlayerId = (data.get("whitePlayerId") as string) || null;
    this.scores = (data.get("scores") as Record<string, number>) || {};
    this.gameStartedAt = (data.get("gameStartedAt") as number) || null;
    this.winner =
      (data.get("winner") as { id: string; name: string }) || null;
    this.isDraw = (data.get("isDraw") as boolean) || false;
    this.chatHistory = (data.get("chatHistory") as ChatMessage[]) || [];
    this.scoredLines = (data.get("scoredLines") as number[][]) || [];
    this.lastMove =
      (data.get("lastMove") as { row: number; col: number }) || null;
    this.lastActivityAt =
      (data.get("lastActivityAt") as number) || Date.now();

    const readyData = data.get("playerReady") as
      | Record<string, boolean>
      | undefined;
    if (readyData) {
      this.playerReady = new Map(Object.entries(readyData));
    }
  }

  private async save(fields: Record<string, unknown>) {
    await this.ctx.storage.put(fields);
  }

  /* ── HTTP 入口 ── */
  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      const { roomCode } = (await request.json()) as { roomCode: string };
      this.roomCode = roomCode;
      this.created = Date.now();
      this.lastActivityAt = Date.now();
      await this.save({
        roomCode,
        created: this.created,
        lastActivityAt: this.lastActivityAt,
        phase: "waiting",
        closed: false,
        timerMinutes: 5,
        board: createEmptyBoard(),
      });
      return new Response("ok");
    }

    if (url.pathname === "/quickleave" && request.method === "POST") {
      const playerId = await request.text();
      const dp = this.disconnectedPlayers.get(playerId);
      if (dp) {
        dp.quickLeave = true;
      }
      return new Response("ok");
    }

    if (url.pathname === "/info" && request.method === "GET") {
      const players = this.getActivePlayers();
      const owner = players.find((p) => p.id === this.ownerId);
      return Response.json({
        roomCode: this.roomCode,
        phase: this.phase,
        playerCount: players.length,
        closed: this.closed,
        ownerName: owner?.name || null,
      });
    }

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response("Not Found", { status: 404 });
  }

  /* ── WebSocket 生命周期 ── */
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.ensureLoaded();
    if (typeof raw !== "string") {
      return;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "join") {
      await this.onJoin(ws, msg);
      return;
    }

    const att = this.getAttachment(ws);
    if (!att) {
      this.sendTo(ws, { type: "error", message: "未加入房间" });
      return;
    }

    this.lastActivityAt = Date.now();
    await this.save({ lastActivityAt: this.lastActivityAt });

    switch (msg.type as string) {
      case "ping":
        break;
      case "ready":
        await this.onReady(att);
        break;
      case "setTimer":
        await this.onSetTimer(att, msg);
        break;
      case "startGame":
        await this.onStartGame(att);
        break;
      case "placePiece":
        await this.onPlacePiece(att, msg);
        break;
      case "chat":
        await this.onChat(att, msg);
        break;
      case "surrender":
        await this.onSurrender(att);
        break;
      case "playAgain":
        await this.onPlayAgain(att);
        break;
      case "transferOwner":
        await this.onTransferOwner(att);
        break;
      case "leave":
        await this.onLeave(ws, att);
        break;
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.ensureLoaded();
    const att = this.getAttachment(ws);
    if (att) {
      this.handleDisconnect(att.playerId, att.playerName);
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.ensureLoaded();
    const att = this.getAttachment(ws);
    if (att) {
      this.handleDisconnect(att.playerId, att.playerName);
    }
  }

  /* ── 消息处理 ── */
  private async onJoin(ws: WebSocket, msg: Record<string, unknown>) {
    if (this.closed) {
      this.sendTo(ws, { type: "roomClosed", reason: "房间已关闭" });
      ws.close(1000, "Room closed");
      return;
    }

    const playerName = (msg.playerName as string) || "匿名";
    const requestedId = msg.playerId as string | undefined;

    // 断线重连
    if (requestedId) {
      if (this.disconnectedPlayers.has(requestedId)) {
        const dp = this.disconnectedPlayers.get(requestedId)!;
        this.disconnectedPlayers.delete(requestedId);
        this.playerReady.set(requestedId, dp.ready);
        this.setAttachment(ws, { playerId: requestedId, playerName });
        this.broadcastExcept(ws, {
          type: "playerJoined",
          player: {
            id: requestedId,
            name: playerName,
            online: true,
            ready: dp.ready,
          },
        });
        this.sendRoomState(ws, requestedId);
        this.scheduleAlarm();
        return;
      }

      const existing = this.findWsByPlayerId(requestedId);
      if (existing) {
        this.setAttachment(existing, null as unknown as WsAttachment);
        try {
          existing.close(1000, "Replaced");
        } catch {
          /* ignore */
        }
        this.disconnectedPlayers.delete(requestedId);
        this.setAttachment(ws, { playerId: requestedId, playerName });
        this.sendRoomState(ws, requestedId);
        return;
      }
    }

    const activePlayers = this.getActivePlayers();
    if (activePlayers.length >= MAX_PLAYERS) {
      this.sendTo(ws, { type: "error", message: "房间已满" });
      ws.close(1000, "Room full");
      return;
    }

    const playerId = requestedId || generateId();
    this.setAttachment(ws, { playerId, playerName });
    this.playerReady.set(playerId, false);

    if (!this.ownerId) {
      this.ownerId = playerId;
      await this.save({ ownerId: playerId });
    }

    this.broadcastExcept(ws, {
      type: "playerJoined",
      player: { id: playerId, name: playerName, online: true, ready: false },
    });

    const allPlayers = this.getActivePlayers();
    if (allPlayers.length === 2 && this.phase === "waiting") {
      this.phase = "readying";
      await this.save({
        phase: "readying",
        playerReady: Object.fromEntries(this.playerReady),
      });
      this.broadcast({
        type: "phaseChange",
        phase: "readying",
        ownerId: this.ownerId,
      });
    }

    this.sendRoomState(ws, playerId);
    this.scheduleAlarm();
  }

  private async onReady(att: WsAttachment) {
    if (this.phase !== "readying") {
      return;
    }
    // 房主不需要准备
    if (att.playerId === this.ownerId) {
      return;
    }
    const current = this.playerReady.get(att.playerId) || false;
    this.playerReady.set(att.playerId, !current);
    await this.save({ playerReady: Object.fromEntries(this.playerReady) });
    this.broadcast({
      type: "readyChanged",
      playerId: att.playerId,
      ready: !current,
    });
  }

  private async onSetTimer(att: WsAttachment, msg: Record<string, unknown>) {
    if (att.playerId !== this.ownerId || this.phase !== "readying") {
      return;
    }
    const minutes = msg.minutes as number;
    if (typeof minutes !== "number" || minutes < 1 || minutes > 30) {
      return;
    }
    this.timerMinutes = Math.floor(minutes);
    await this.save({ timerMinutes: this.timerMinutes });
    this.broadcast({ type: "timerChanged", timerMinutes: this.timerMinutes });
  }

  private async onStartGame(att: WsAttachment) {
    if (att.playerId !== this.ownerId || this.phase !== "readying") {
      return;
    }
    const players = this.getActivePlayers();
    if (players.length < 2) {
      return;
    }
    // 检查非房主玩家是否已准备
    const nonOwner = players.find((p) => p.id !== this.ownerId);
    if (!nonOwner || !this.playerReady.get(nonOwner.id)) {
      return;
    }

    // 随机分配黑白
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    this.blackPlayerId = shuffled[0]!.id;
    this.whitePlayerId = shuffled[1]!.id;
    this.board = createEmptyBoard();
    this.currentTurn = 1;
    this.scores = {
      [this.blackPlayerId]: 0,
      [this.whitePlayerId]: 0,
    };
    this.gameStartedAt = Date.now();
    this.phase = "playing";
    this.winner = null;
    this.isDraw = false;
    this.scoredLines = [];
    this.lastMove = null;

    await this.save({
      phase: "playing",
      blackPlayerId: this.blackPlayerId,
      whitePlayerId: this.whitePlayerId,
      board: this.board,
      currentTurn: this.currentTurn,
      scores: this.scores,
      gameStartedAt: this.gameStartedAt,
      winner: null,
      isDraw: false,
      scoredLines: [],
      lastMove: null,
    });

    // 系统消息
    const sysMsg = this.addSystemMessage(
      `游戏开始！${shuffled[0]!.name} 执黑先行，${shuffled[1]!.name} 执白。限时 ${this.timerMinutes} 分钟`,
    );
    this.broadcast({ type: "chat", message: sysMsg });

    this.broadcast({
      type: "gameStart",
      blackPlayerId: this.blackPlayerId,
      whitePlayerId: this.whitePlayerId,
      timerMinutes: this.timerMinutes,
      startedAt: this.gameStartedAt,
      board: this.board,
    });

    this.scheduleAlarm();
  }

  private async onPlacePiece(att: WsAttachment, msg: Record<string, unknown>) {
    if (this.phase !== "playing") {
      return;
    }

    const row = msg.row as number;
    const col = msg.col as number;

    // 验证回合
    const expectedPlayerId =
      this.currentTurn === 1 ? this.blackPlayerId : this.whitePlayerId;
    if (att.playerId !== expectedPlayerId) {
      return;
    }

    // 验证位置
    if (
      typeof row !== "number" ||
      typeof col !== "number" ||
      row < 0 ||
      row >= BOARD_SIZE ||
      col < 0 ||
      col >= BOARD_SIZE
    ) {
      return;
    }
    if (this.board[row]![col] !== 0) {
      return;
    }

    // 落子
    this.board[row]![col] = this.currentTurn;

    // 检查得分
    const newLines = findScoringLines(this.board, row, col);
    if (newLines.length > 0) {
      this.scores[att.playerId] =
        (this.scores[att.playerId] || 0) + newLines.length;
      this.scoredLines = newLines;
    } else {
      this.scoredLines = [];
    }

    this.lastMove = { row, col };

    // 切换回合
    this.currentTurn = this.currentTurn === 1 ? 2 : 1;

    await this.save({
      board: this.board,
      currentTurn: this.currentTurn,
      scores: this.scores,
      scoredLines: this.scoredLines,
      lastMove: this.lastMove,
    });

    // 广播落子
    this.broadcast({
      type: "piecePlaced",
      row,
      col,
      color: this.currentTurn === 1 ? 2 : 1,
      playerId: att.playerId,
      currentTurn: this.currentTurn,
      scores: { ...this.scores },
      scoredLines: this.scoredLines,
    });

    // 得分系统消息
    if (newLines.length > 0) {
      const playerName = att.playerName;
      const sysMsg = this.addSystemMessage(
        `${playerName} 连成五子，得 ${newLines.length} 分！`,
      );
      this.broadcast({ type: "chat", message: sysMsg });
    }

    // 检查棋盘是否已满
    let hasEmpty = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (this.board[r]![c] === 0) {
          hasEmpty = true;
          break;
        }
      }
      if (hasEmpty) {
        break;
      }
    }

    if (!hasEmpty) {
      await this.endGame("boardFull");
    }
  }

  private async onChat(att: WsAttachment, msg: Record<string, unknown>) {
    const text = msg.text as string;
    if (!text || typeof text !== "string" || text.length > 500) {
      return;
    }
    const chatMsg: ChatMessage = {
      id: generateId(),
      kind: "chat",
      playerId: att.playerId,
      playerName: att.playerName,
      text: text.trim(),
      timestamp: Date.now(),
    };
    this.chatHistory.push(chatMsg);
    if (this.chatHistory.length > MAX_CHAT) {
      this.chatHistory = this.chatHistory.slice(-MAX_CHAT);
    }
    await this.save({ chatHistory: this.chatHistory });
    this.broadcast({ type: "chat", message: chatMsg });
  }

  private async onSurrender(att: WsAttachment) {
    if (this.phase !== "playing") {
      return;
    }
    const players = this.getActivePlayers();
    const winner = players.find((p) => p.id !== att.playerId);

    this.phase = "ended";
    this.winner = winner ? { id: winner.id, name: winner.name } : null;
    this.isDraw = false;

    await this.save({
      phase: "ended",
      winner: this.winner,
      isDraw: false,
    });

    const sysMsg = this.addSystemMessage(
      `${att.playerName} 投降了，${winner?.name || "对方"} 获胜！`,
    );
    this.broadcast({ type: "chat", message: sysMsg });

    this.broadcast({
      type: "gameEnd",
      winnerId: winner?.id || null,
      winnerName: winner?.name || "",
      scores: { ...this.scores },
      isDraw: false,
      reason: "surrender",
    });
  }

  private async onPlayAgain(att: WsAttachment) {
    if (att.playerId !== this.ownerId) {
      return;
    }
    if (this.phase !== "ended") {
      return;
    }

    this.phase = "readying";
    this.winner = null;
    this.isDraw = false;
    this.board = createEmptyBoard();
    this.scoredLines = [];
    this.lastMove = null;
    this.scores = {};
    this.gameStartedAt = null;
    this.blackPlayerId = null;
    this.whitePlayerId = null;

    for (const key of this.playerReady.keys()) {
      this.playerReady.set(key, false);
    }

    await this.save({
      phase: "readying",
      winner: null,
      isDraw: false,
      board: this.board,
      scoredLines: [],
      lastMove: null,
      scores: {},
      gameStartedAt: null,
      blackPlayerId: null,
      whitePlayerId: null,
      playerReady: Object.fromEntries(this.playerReady),
    });

    this.broadcast({
      type: "phaseChange",
      phase: "readying",
      ownerId: this.ownerId,
    });
    for (const [pid] of this.playerReady) {
      this.broadcast({ type: "readyChanged", playerId: pid, ready: false });
    }

    const sysMsg = this.addSystemMessage("房主发起了新一局");
    this.broadcast({ type: "chat", message: sysMsg });
  }

  private async onTransferOwner(att: WsAttachment) {
    if (att.playerId !== this.ownerId) {
      return;
    }
    if (this.phase === "playing") {
      return;
    }
    const players = this.getActivePlayers();
    const other = players.find((p) => p.id !== att.playerId);
    if (!other) {
      return;
    }
    this.ownerId = other.id;
    await this.save({ ownerId: other.id });
    this.broadcast({
      type: "phaseChange",
      phase: this.phase,
      ownerId: this.ownerId,
    });
  }

  private async onLeave(ws: WebSocket, att: WsAttachment) {
    this.removePlayer(att.playerId);
    try {
      ws.close(1000, "Left");
    } catch {
      /* ignore */
    }
    this.broadcast({ type: "playerLeft", playerId: att.playerId });
    await this.handlePlayerRemoved(att.playerId);
  }

  /* ── 游戏结束 ── */
  private async endGame(reason: string) {
    if (this.phase !== "playing") {
      return;
    }

    this.phase = "ended";
    const players = this.getActivePlayers();

    let winnerId: string | null = null;
    let winnerName = "";

    const blackScore = this.scores[this.blackPlayerId || ""] || 0;
    const whiteScore = this.scores[this.whitePlayerId || ""] || 0;

    if (blackScore === whiteScore) {
      this.isDraw = true;
      this.winner = null;
    } else if (blackScore > whiteScore) {
      winnerId = this.blackPlayerId;
      winnerName =
        players.find((p) => p.id === winnerId)?.name || "";
      this.winner = { id: winnerId!, name: winnerName };
      this.isDraw = false;
    } else {
      winnerId = this.whitePlayerId;
      winnerName =
        players.find((p) => p.id === winnerId)?.name || "";
      this.winner = { id: winnerId!, name: winnerName };
      this.isDraw = false;
    }

    await this.save({
      phase: "ended",
      winner: this.winner,
      isDraw: this.isDraw,
    });

    const reasonText =
      reason === "timeout"
        ? "时间到！"
        : reason === "boardFull"
          ? "棋盘已满！"
          : "游戏结束！";
    const resultText = this.isDraw
      ? `${reasonText} 双方平局`
      : `${reasonText} ${winnerName} 获胜！`;
    const sysMsg = this.addSystemMessage(resultText);
    this.broadcast({ type: "chat", message: sysMsg });

    this.broadcast({
      type: "gameEnd",
      winnerId,
      winnerName,
      scores: { ...this.scores },
      isDraw: this.isDraw,
      reason,
    });
  }

  /* ── 断线处理 ── */
  private handleDisconnect(playerId: string, playerName: string) {
    this.disconnectedPlayers.set(playerId, {
      name: playerName,
      disconnectedAt: Date.now(),
      quickLeave: false,
      ready: this.playerReady.get(playerId) || false,
    });
    this.scheduleAlarm();
  }

  private async handlePlayerRemoved(removedId: string) {
    this.disconnectedPlayers.delete(removedId);
    this.playerReady.delete(removedId);
    const remaining = this.getActivePlayers();

    if (remaining.length === 0) {
      this.closed = true;
      await this.save({ closed: true });
      return;
    }

    if (removedId === this.ownerId && remaining.length > 0) {
      this.ownerId = remaining[0]!.id;
      await this.save({ ownerId: this.ownerId });
    }

    // 游戏中有人离开 → 另一方获胜
    if (this.phase === "playing") {
      const winner = remaining[0]!;
      this.phase = "ended";
      this.winner = { id: winner.id, name: winner.name };
      this.isDraw = false;

      await this.save({
        phase: "ended",
        winner: this.winner,
        isDraw: false,
      });

      const sysMsg = this.addSystemMessage(
        `对方离开了，${winner.name} 获胜！`,
      );
      this.broadcast({ type: "chat", message: sysMsg });

      this.broadcast({
        type: "gameEnd",
        winnerId: winner.id,
        winnerName: winner.name,
        scores: { ...this.scores },
        isDraw: false,
        reason: "disconnect",
      });
      return;
    }

    if (remaining.length < 2 && this.phase !== "waiting") {
      this.phase = "waiting";
      await this.save({
        phase: "waiting",
        playerReady: Object.fromEntries(this.playerReady),
      });
      this.broadcast({
        type: "phaseChange",
        phase: "waiting",
        ownerId: this.ownerId,
      });
    }
  }

  /* ── 定时器 ── */
  private scheduleAlarm() {
    const now = Date.now();
    let next = now + INACTIVITY_TIMEOUT;

    // 断线清理
    for (const [, dp] of this.disconnectedPlayers) {
      const grace = dp.quickLeave ? QUICK_GRACE : GRACE_PERIOD;
      next = Math.min(next, dp.disconnectedAt + grace);
    }

    // 游戏倒计时
    if (this.phase === "playing" && this.gameStartedAt) {
      const gameEnd =
        this.gameStartedAt + this.timerMinutes * 60 * 1000;
      next = Math.min(next, gameEnd);
    }

    // 不活跃超时
    next = Math.min(next, this.lastActivityAt + INACTIVITY_TIMEOUT);

    next = Math.max(next, now + 100);
    this.ctx.storage.setAlarm(next);
  }

  async alarm() {
    await this.ensureLoaded();
    if (this.closed) {
      return;
    }
    const now = Date.now();

    // 断线清理
    for (const [id, dp] of this.disconnectedPlayers) {
      const grace = dp.quickLeave ? QUICK_GRACE : GRACE_PERIOD;
      if (now - dp.disconnectedAt >= grace) {
        this.disconnectedPlayers.delete(id);
        const stillConnected = this.findWsByPlayerId(id);
        if (stillConnected) {
          continue;
        }
        this.broadcast({ type: "playerLeft", playerId: id });
        await this.handlePlayerRemoved(id);
      }
    }

    // 游戏倒计时结束
    if (this.phase === "playing" && this.gameStartedAt) {
      if (now >= this.gameStartedAt + this.timerMinutes * 60 * 1000) {
        await this.endGame("timeout");
      }
    }

    // 不活跃超时
    if (now - this.lastActivityAt >= INACTIVITY_TIMEOUT) {
      this.closed = true;
      await this.save({ closed: true });
      this.broadcast({
        type: "roomClosed",
        reason: "长时间无操作，房间已关闭",
      });
      return;
    }

    if (
      !this.closed &&
      (this.disconnectedPlayers.size > 0 ||
        this.getWebSockets().length > 0 ||
        this.phase === "playing")
    ) {
      this.scheduleAlarm();
    }
  }

  /* ── 工具方法 ── */
  private addSystemMessage(text: string): ChatMessage {
    const msg: ChatMessage = {
      id: generateId(),
      kind: "system",
      playerId: "",
      playerName: "",
      text,
      timestamp: Date.now(),
    };
    this.chatHistory.push(msg);
    if (this.chatHistory.length > MAX_CHAT) {
      this.chatHistory = this.chatHistory.slice(-MAX_CHAT);
    }
    this.ctx.storage.put({ chatHistory: this.chatHistory });
    return msg;
  }

  private getWebSockets(): WebSocket[] {
    return this.ctx.getWebSockets();
  }

  private getAttachment(ws: WebSocket): WsAttachment | null {
    try {
      return ws.deserializeAttachment() as WsAttachment | null;
    } catch {
      return null;
    }
  }

  private setAttachment(ws: WebSocket, att: WsAttachment) {
    ws.serializeAttachment(att);
  }

  private getActivePlayers(): PlayerInfo[] {
    const players: PlayerInfo[] = [];
    const seen = new Set<string>();
    for (const ws of this.getWebSockets()) {
      const att = this.getAttachment(ws);
      if (att && !seen.has(att.playerId)) {
        seen.add(att.playerId);
        players.push({
          id: att.playerId,
          name: att.playerName,
          online: true,
          ready: this.playerReady.get(att.playerId) || false,
        });
      }
    }
    for (const [id, dp] of this.disconnectedPlayers) {
      if (!seen.has(id)) {
        players.push({
          id,
          name: dp.name,
          online: false,
          ready: dp.ready,
        });
      }
    }
    return players;
  }

  private findWsByPlayerId(playerId: string): WebSocket | null {
    for (const ws of this.getWebSockets()) {
      const att = this.getAttachment(ws);
      if (att?.playerId === playerId) {
        return ws;
      }
    }
    return null;
  }

  private removePlayer(playerId: string) {
    for (const ws of this.getWebSockets()) {
      const att = this.getAttachment(ws);
      if (att?.playerId === playerId) {
        this.setAttachment(ws, null as unknown as WsAttachment);
      }
    }
  }

  private sendRoomState(ws: WebSocket, yourId: string) {
    this.sendTo(ws, {
      type: "roomState",
      yourId,
      players: this.getActivePlayers(),
      ownerId: this.ownerId,
      phase: this.phase,
      timerMinutes: this.timerMinutes,
      board: this.board,
      currentTurn: this.currentTurn,
      blackPlayerId: this.blackPlayerId,
      whitePlayerId: this.whitePlayerId,
      scores: { ...this.scores },
      gameStartedAt: this.gameStartedAt,
      winner: this.winner,
      isDraw: this.isDraw,
      chatHistory: this.chatHistory,
      scoredLines: this.scoredLines,
      lastMove: this.lastMove,
    });
  }

  private sendTo(ws: WebSocket, data: unknown) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  private broadcast(data: unknown) {
    const msg = JSON.stringify(data);
    for (const ws of this.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  private broadcastExcept(exclude: WebSocket | null, data: unknown) {
    const msg = JSON.stringify(data);
    for (const ws of this.getWebSockets()) {
      if (ws !== exclude) {
        try {
          ws.send(msg);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/* ── 工具函数 ── */
function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
