/* ── 游戏阶段 ── */
export type GamePhase = "waiting" | "readying" | "playing" | "ended";

/* ── 玩家信息 ── */
export interface PlayerInfo {
  id: string;
  name: string;
  online: boolean;
  ready: boolean;
}

/* ── 聊天消息 ── */
export interface ChatMessage {
  id: string;
  kind: "chat" | "system";
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

/* ── 服务端 → 客户端 消息 ── */

export interface S_RoomState {
  type: "roomState";
  yourId: string;
  players: PlayerInfo[];
  ownerId: string;
  phase: GamePhase;
  timerMinutes: number;
  board: number[][];
  currentTurn: number;
  blackPlayerId: string | null;
  whitePlayerId: string | null;
  scores: Record<string, number>;
  gameStartedAt: number | null;
  winner: { id: string; name: string } | null;
  isDraw: boolean;
  chatHistory: ChatMessage[];
  scoredLines: number[][];
  lastMove: { row: number; col: number } | null;
}

export interface S_PlayerJoined {
  type: "playerJoined";
  player: PlayerInfo;
}

export interface S_PlayerLeft {
  type: "playerLeft";
  playerId: string;
}

export interface S_PhaseChange {
  type: "phaseChange";
  phase: GamePhase;
  ownerId: string;
}

export interface S_GameStart {
  type: "gameStart";
  blackPlayerId: string;
  whitePlayerId: string;
  timerMinutes: number;
  startedAt: number;
  board: number[][];
}

export interface S_PiecePlaced {
  type: "piecePlaced";
  row: number;
  col: number;
  color: number;
  playerId: string;
  currentTurn: number;
  scores: Record<string, number>;
  scoredLines: number[][];
  removedCells: number[];
}

export interface S_GameEnd {
  type: "gameEnd";
  winnerId: string | null;
  winnerName: string;
  scores: Record<string, number>;
  isDraw: boolean;
  reason: string;
}

export interface S_ReadyChanged {
  type: "readyChanged";
  playerId: string;
  ready: boolean;
}

export interface S_TimerChanged {
  type: "timerChanged";
  timerMinutes: number;
}

export interface S_Chat {
  type: "chat";
  message: ChatMessage;
}

export interface S_Error {
  type: "error";
  message: string;
}

export interface S_RoomClosed {
  type: "roomClosed";
  reason: string;
}

export type ServerMessage =
  | S_RoomState
  | S_PlayerJoined
  | S_PlayerLeft
  | S_PhaseChange
  | S_GameStart
  | S_PiecePlaced
  | S_GameEnd
  | S_ReadyChanged
  | S_TimerChanged
  | S_Chat
  | S_Error
  | S_RoomClosed;

/* ── 客户端 → 服务端 消息 ── */

export interface C_Join {
  type: "join";
  playerName: string;
  playerId?: string;
}

export interface C_Ready {
  type: "ready";
}

export interface C_SetTimer {
  type: "setTimer";
  minutes: number;
}

export interface C_StartGame {
  type: "startGame";
}

export interface C_PlacePiece {
  type: "placePiece";
  row: number;
  col: number;
}

export interface C_Chat {
  type: "chat";
  text: string;
}

export interface C_Surrender {
  type: "surrender";
}

export interface C_PlayAgain {
  type: "playAgain";
}

export interface C_TransferOwner {
  type: "transferOwner";
}

export interface C_Leave {
  type: "leave";
}

export interface C_Ping {
  type: "ping";
}

export type ClientMessage =
  | C_Join
  | C_Ready
  | C_SetTimer
  | C_StartGame
  | C_PlacePiece
  | C_Chat
  | C_Surrender
  | C_PlayAgain
  | C_TransferOwner
  | C_Leave
  | C_Ping;
