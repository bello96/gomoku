import { useCallback, useEffect, useMemo, useState } from "react";
import { getHttpBase, getWsBase } from "../api";
import ChatPanel from "../components/ChatPanel";
import Confetti from "../components/Confetti";
import GomokuBoard from "../components/GomokuBoard";
import PlayerBar from "../components/PlayerBar";
import { useWebSocket } from "../hooks/useWebSocket";
import type {
  ChatMessage,
  GamePhase,
  PlayerInfo,
  ServerMessage,
} from "../types/protocol";

interface Props {
  roomCode: string;
  nickname: string;
  playerId: string;
  onLeave: () => void;
}

function createEmptyBoard(): number[][] {
  return Array.from({ length: 15 }, () => Array(15).fill(0) as number[]);
}

const TIMER_OPTIONS = [3, 5, 10, 15];

export default function Room({ roomCode, nickname, playerId, onLeave }: Props) {
  /* ── 房间状态 ── */
  const [myId, setMyId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [phase, setPhase] = useState<GamePhase>("waiting");
  const [timerMinutes, setTimerMinutes] = useState(5);

  /* ── 游戏状态 ── */
  const [board, setBoard] = useState<number[][]>(createEmptyBoard);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [blackPlayerId, setBlackPlayerId] = useState<string | null>(null);
  const [whitePlayerId, setWhitePlayerId] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [gameStartedAt, setGameStartedAt] = useState<number | null>(null);
  const [lastMove, setLastMove] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [scoredLines, setScoredLines] = useState<number[][]>([]);

  /* ── 结束状态 ── */
  const [winner, setWinner] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [isDraw, setIsDraw] = useState(false);
  const [endReason, setEndReason] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);
  const [showEndDialog, setShowEndDialog] = useState(false);

  /* ── 聊天 ── */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  /* ── 倒计时 ── */
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  /* ── 错误提示 ── */
  const [errorToast, setErrorToast] = useState("");

  /* ── WebSocket ── */
  const wsUrl = useMemo(
    () => `${getWsBase()}/api/rooms/${roomCode}/ws`,
    [roomCode],
  );
  const { connected, send, addListener, leave } = useWebSocket(wsUrl);

  // 加入房间：每次 WebSocket 连接（含自动重连）后都需重新 join，
  // 否则后端无法识别该连接，所有后续操作都会被拒绝
  useEffect(() => {
    if (connected) {
      send({ type: "join", playerName: nickname, playerId });
    }
  }, [connected, nickname, playerId, send]);

  // 页面离开时发送 beacon
  useEffect(() => {
    const handlePageHide = () => {
      navigator.sendBeacon(
        `${getHttpBase()}/api/rooms/${roomCode}/quickleave`,
        playerId,
      );
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [roomCode, playerId]);

  // 倒计时
  useEffect(() => {
    if (phase !== "playing" || !gameStartedAt) {
      setRemainingSeconds(null);
      return;
    }

    const tick = () => {
      const endTime = gameStartedAt + timerMinutes * 60 * 1000;
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setRemainingSeconds(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [phase, gameStartedAt, timerMinutes]);

  // 消息监听
  useEffect(() => {
    const unsub = addListener((msg: ServerMessage) => {
      switch (msg.type) {
        case "roomState": {
          setMyId(msg.yourId);
          setPlayers(msg.players);
          setOwnerId(msg.ownerId);
          setPhase(msg.phase);
          setTimerMinutes(msg.timerMinutes);
          setBoard(msg.board);
          setCurrentTurn(msg.currentTurn);
          setBlackPlayerId(msg.blackPlayerId);
          setWhitePlayerId(msg.whitePlayerId);
          setScores(msg.scores);
          setGameStartedAt(msg.gameStartedAt);
          setChatMessages(msg.chatHistory);
          setScoredLines(msg.scoredLines);
          setLastMove(msg.lastMove);
          if (msg.winner) {
            setWinner(msg.winner);
          }
          setIsDraw(msg.isDraw);
          if (msg.phase === "ended") {
            setShowEndDialog(true);
            if (msg.winner?.id === msg.yourId) {
              setShowConfetti(true);
            }
          }
          break;
        }
        case "playerJoined":
          setPlayers((prev) => {
            const existing = prev.find((p) => p.id === msg.player.id);
            if (existing) {
              return prev.map((p) => (p.id === msg.player.id ? msg.player : p));
            }
            return [...prev, msg.player];
          });
          break;
        case "playerLeft":
          setPlayers((prev) => prev.filter((p) => p.id !== msg.playerId));
          break;
        case "phaseChange":
          setPhase(msg.phase);
          setOwnerId(msg.ownerId);
          if (msg.phase === "readying") {
            setShowEndDialog(false);
            setShowConfetti(false);
            setWinner(null);
            setIsDraw(false);
          }
          break;
        case "gameStart":
          setPhase("playing");
          setBlackPlayerId(msg.blackPlayerId);
          setWhitePlayerId(msg.whitePlayerId);
          setTimerMinutes(msg.timerMinutes);
          setGameStartedAt(msg.startedAt);
          setBoard(msg.board);
          setCurrentTurn(1);
          setScores({});
          setLastMove(null);
          setScoredLines([]);
          setShowEndDialog(false);
          setShowConfetti(false);
          break;
        case "piecePlaced": {
          setBoard((prev) => {
            const next = prev.map((row) => [...row]);
            next[msg.row]![msg.col] = msg.color;
            return next;
          });
          setCurrentTurn(msg.currentTurn);
          setScores(msg.scores);
          setLastMove({ row: msg.row, col: msg.col });
          setScoredLines(msg.scoredLines);
          if (msg.removedCells.length > 0) {
            const cells = msg.removedCells;
            setTimeout(() => {
              setBoard((prev) => {
                const next = prev.map((row) => [...row]);
                for (let i = 0; i < cells.length; i += 2) {
                  next[cells[i]!]![cells[i + 1]!] = 0;
                }
                return next;
              });
              setScoredLines([]);
              setLastMove(null);
            }, 600);
          }
          break;
        }
        case "gameEnd":
          setPhase("ended");
          setScores(msg.scores);
          setIsDraw(msg.isDraw);
          setEndReason(msg.reason);
          if (msg.winnerId) {
            setWinner({ id: msg.winnerId, name: msg.winnerName });
            setShowConfetti(msg.winnerId === myId);
          } else {
            setWinner(null);
          }
          setShowEndDialog(true);
          break;
        case "readyChanged":
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === msg.playerId ? { ...p, ready: msg.ready } : p,
            ),
          );
          break;
        case "timerChanged":
          setTimerMinutes(msg.timerMinutes);
          break;
        case "chat":
          setChatMessages((prev) => [...prev, msg.message]);
          break;
        case "error":
          setErrorToast(msg.message);
          setTimeout(() => setErrorToast(""), 3000);
          break;
        case "roomClosed":
          alert(msg.reason);
          onLeave();
          break;
      }
    });
    return unsub;
  }, [addListener, myId, onLeave]);

  /* ── 操作 ── */
  const isOwner = myId === ownerId;
  const myColor = myId === blackPlayerId ? 1 : myId === whitePlayerId ? 2 : 0;
  const isMyTurn =
    phase === "playing" &&
    ((currentTurn === 1 && myId === blackPlayerId) ||
      (currentTurn === 2 && myId === whitePlayerId));
  const mePlayer = players.find((p) => p.id === myId);
  const opponentPlayer = players.find((p) => p.id !== myId);

  const handleReady = useCallback(() => send({ type: "ready" }), [send]);
  const handleStartGame = useCallback(
    () => send({ type: "startGame" }),
    [send],
  );
  const handlePlacePiece = useCallback(
    (row: number, col: number) => send({ type: "placePiece", row, col }),
    [send],
  );
  const handleSurrender = useCallback(
    () => send({ type: "surrender" }),
    [send],
  );
  const handlePlayAgain = useCallback(
    () => send({ type: "playAgain" }),
    [send],
  );
  const handleTransferOwner = useCallback(
    () => send({ type: "transferOwner" }),
    [send],
  );
  const handleSetTimer = useCallback(
    (minutes: number) => send({ type: "setTimer", minutes }),
    [send],
  );
  const handleSendChat = useCallback(
    (text: string) => send({ type: "chat", text }),
    [send],
  );
  const handleLeave = useCallback(() => {
    leave();
    onLeave();
  }, [leave, onLeave]);

  const opponentReady = opponentPlayer?.ready ?? false;
  const meReady = mePlayer?.ready ?? false;

  const blackPlayer = players.find((p) => p.id === blackPlayerId);
  const whitePlayer = players.find((p) => p.id === whitePlayerId);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const endReasonText: Record<string, string> = {
    timeout: "时间到",
    surrender: "投降",
    disconnect: "对方断线",
    boardFull: "棋盘已满",
  };

  return (
    <div className="h-screen bg-[#eff2ff] flex flex-col p-2 gap-2 overflow-hidden">
      <PlayerBar
        roomCode={roomCode}
        players={players}
        ownerId={ownerId}
        myId={myId}
        phase={phase}
        onPlayAgain={handlePlayAgain}
        onTransferOwner={handleTransferOwner}
        onLeave={handleLeave}
      />

      <div className="flex-1 flex gap-2 min-h-0">
        {/* 左侧：游戏区 */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0 min-h-0">
          {/* 状态栏：固定高度，避免切换阶段时容器跳动 */}
          <div className="bg-white rounded-lg px-4 shadow-sm shrink-0 h-[46px] flex items-center">
            {phase === "playing" && (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition text-sm ${
                      currentTurn === 1
                        ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300"
                        : "bg-gray-50 text-gray-500"
                    }`}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-gray-900 border border-gray-400 inline-block" />
                    <span className="font-medium">
                      {blackPlayer?.name || "黑棋"}
                    </span>
                    <span className="font-bold">
                      {scores[blackPlayerId || ""] || 0}
                    </span>
                  </div>
                  <span className="text-gray-300 text-xs font-bold">VS</span>
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition text-sm ${
                      currentTurn === 2
                        ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300"
                        : "bg-gray-50 text-gray-500"
                    }`}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-white border border-gray-400 inline-block" />
                    <span className="font-medium">
                      {whitePlayer?.name || "白棋"}
                    </span>
                    <span className="font-bold">
                      {scores[whitePlayerId || ""] || 0}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  {isMyTurn && (
                    <span className="text-xs text-green-600 font-medium animate-pulse">
                      轮到你了
                    </span>
                  )}
                  {remainingSeconds !== null && (
                    <span
                      className={`font-mono text-sm font-bold ${remainingSeconds <= 30 ? "text-red-500" : "text-gray-600"}`}
                    >
                      {formatTime(remainingSeconds)}
                    </span>
                  )}
                  <button
                    className="px-2.5 py-1 text-xs rounded-md transition font-medium bg-red-50 text-red-500 hover:bg-red-100"
                    onClick={handleSurrender}
                  >
                    投降
                  </button>
                </div>
              </div>
            )}

            {phase === "waiting" && (
              <div className="text-center text-gray-500 text-sm w-full">
                等待对手加入...
              </div>
            )}

            {phase === "readying" && (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  {isOwner && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">时长</span>
                      <div className="flex gap-1">
                        {TIMER_OPTIONS.map((m) => (
                          <button
                            key={m}
                            className={`px-2 py-0.5 text-xs rounded-md transition ${
                              timerMinutes === m
                                ? "bg-indigo-600 text-white"
                                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                            }`}
                            onClick={() => handleSetTimer(m)}
                          >
                            {m}分
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {!isOwner && (
                    <span className="text-xs text-gray-500">
                      时长：{timerMinutes}分钟
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  {!isOwner && (
                    <button
                      className={`px-3 py-1 text-xs rounded-md transition font-medium ${
                        meReady
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-indigo-600 text-white hover:bg-indigo-700"
                      }`}
                      onClick={handleReady}
                    >
                      {meReady ? "已准备 (取消)" : "准备"}
                    </button>
                  )}
                  {isOwner && (
                    <>
                      <span className="text-xs text-gray-400">
                        {opponentReady ? "对手已准备" : "等待对手准备..."}
                      </span>
                      <button
                        className="px-3 py-1 text-xs rounded-md transition font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                        disabled={!opponentReady}
                        onClick={handleStartGame}
                      >
                        开始游戏
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 棋盘 - 撑满剩余高度 */}
          <div className="flex-1 min-h-0">
            <GomokuBoard
              board={board}
              myColor={myColor}
              isMyTurn={isMyTurn}
              lastMove={lastMove}
              scoredLines={scoredLines}
              onPlace={handlePlacePiece}
              disabled={phase !== "playing"}
            />
          </div>
        </div>

        {/* 右侧：聊天 */}
        <div className="w-72 flex-shrink-0">
          <ChatPanel
            messages={chatMessages}
            myId={myId}
            onSendChat={handleSendChat}
          />
        </div>
      </div>

      {/* 结束弹窗 */}
      {showEndDialog && phase === "ended" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
          <div className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-xl text-center">
            <h2 className="text-2xl font-bold mb-2">
              {isDraw
                ? "平局！"
                : winner?.id === myId
                  ? "你赢了！"
                  : `${winner?.name || "对方"} 获胜`}
            </h2>
            <p className="text-gray-500 text-sm mb-4">
              {endReasonText[endReason] || endReason}
            </p>

            <div className="flex items-center justify-center gap-6 mb-6">
              <div className="text-center">
                <div className="flex items-center gap-1.5 mb-1 justify-center">
                  <span className="w-3 h-3 rounded-full bg-gray-900 inline-block" />
                  <span className="text-sm font-medium">
                    {blackPlayer?.name || "黑棋"}
                  </span>
                </div>
                <span className="text-2xl font-bold">
                  {scores[blackPlayerId || ""] || 0}
                </span>
              </div>
              <span className="text-gray-300 text-2xl">:</span>
              <div className="text-center">
                <div className="flex items-center gap-1.5 mb-1 justify-center">
                  <span className="w-3 h-3 rounded-full bg-white border-2 border-gray-400 inline-block" />
                  <span className="text-sm font-medium">
                    {whitePlayer?.name || "白棋"}
                  </span>
                </div>
                <span className="text-2xl font-bold">
                  {scores[whitePlayerId || ""] || 0}
                </span>
              </div>
            </div>

            <div className="flex gap-3 justify-center">
              {isOwner && (
                <button
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
                  onClick={handlePlayAgain}
                >
                  再来一局
                </button>
              )}
              <button
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                onClick={() => setShowEndDialog(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <Confetti show={showConfetti} />

      {errorToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {errorToast}
        </div>
      )}
    </div>
  );
}
