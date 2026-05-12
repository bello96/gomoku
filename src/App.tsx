import { useCallback, useEffect, useState } from "react";
import { checkJoinable, fetchRoomInfo } from "./api";
import Home from "./pages/Home";
import Room from "./pages/Room";
import bgImage from "./bg.png";

interface RoomSession {
  roomCode: string;
  nickname: string;
  playerId: string;
}

const SESSION_KEY = "gomoku_session";

function loadSession(): RoomSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as RoomSession) : null;
  } catch {
    return null;
  }
}

function saveSession(s: RoomSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function App() {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [nicknameInput, setNicknameInput] = useState("");
  const [urlError, setUrlError] = useState("");
  const [pendingError, setPendingError] = useState("");
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingOwnerName, setPendingOwnerName] = useState<string | null>(null);

  useEffect(() => {
    const urlMatch = window.location.pathname.match(/^\/(\d{6})$/);
    const session = loadSession();

    if (urlMatch?.[1]) {
      const code = urlMatch[1];
      if (session && session.roomCode === code) {
        setNickname(session.nickname);
        setPlayerId(session.playerId);
        setRoomCode(code);
        return;
      }
      setNicknameInput(session?.nickname || "");
      setPendingCode(code);
      fetchRoomInfo(code).then((info) => {
        if (info?.ownerName) {
          setPendingOwnerName(info.ownerName);
        }
      });
    }
  }, []);

  function enterRoom(code: string, name: string, pid: string) {
    saveSession({ roomCode: code, nickname: name, playerId: pid });
    setNickname(name);
    setPlayerId(pid);
    setRoomCode(code);
    window.history.replaceState(null, "", `/${code}`);
  }

  async function confirmPendingJoin(code: string, name: string) {
    setPendingError("");
    setPendingLoading(true);
    const err = await checkJoinable(code);
    if (err) {
      setPendingLoading(false);
      setPendingError(err);
      setTimeout(() => {
        setPendingCode(null);
        setPendingError("");
        setUrlError(err);
        window.history.replaceState(null, "", "/");
        setTimeout(() => setUrlError(""), 3000);
      }, 1500);
      return;
    }
    enterRoom(code, name, genId());
    setPendingCode(null);
  }

  const handleEnterRoom = useCallback(
    (code: string, name: string) => {
      enterRoom(code, name, genId());
    },
    [],
  );

  const handleLeaveRoom = useCallback(() => {
    clearSession();
    setRoomCode(null);
    setNickname("");
    setPlayerId("");
    window.history.replaceState(null, "", "/");
  }, []);

  if (pendingCode) {
    return (
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat flex items-center justify-center z-50"
        style={{ backgroundImage: `url(${bgImage})` }}
      >
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative bg-white/90 backdrop-blur-md rounded-2xl p-8 w-full max-w-sm shadow-xl mx-4">
          {pendingOwnerName && (
            <div className="text-center mb-4">
              <span className="text-indigo-600 font-bold">
                {pendingOwnerName}
              </span>
              <span className="text-gray-600"> 邀请你一起下五子棋</span>
            </div>
          )}
          <h3 className="text-lg font-bold text-gray-700 mb-4">
            输入昵称加入房间
          </h3>
          {pendingError && (
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">
              {pendingError}
            </div>
          )}
          <input
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition mb-4"
            placeholder="你的昵称"
            maxLength={12}
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nicknameInput.trim()) {
                confirmPendingJoin(pendingCode, nicknameInput.trim());
              }
            }}
            autoFocus
          />
          <button
            className={`w-full py-3 px-4 font-semibold rounded-lg transition disabled:opacity-50 ${
              pendingLoading
                ? "bg-gray-400 text-white cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-700"
            }`}
            disabled={!nicknameInput.trim() || !!pendingError || pendingLoading}
            onClick={() =>
              confirmPendingJoin(pendingCode, nicknameInput.trim())
            }
          >
            {pendingLoading ? "加入中..." : "加入"}
          </button>
        </div>
      </div>
    );
  }

  if (roomCode && nickname && playerId) {
    return (
      <Room
        roomCode={roomCode}
        nickname={nickname}
        playerId={playerId}
        onLeave={handleLeaveRoom}
      />
    );
  }

  return <Home onEnterRoom={handleEnterRoom} urlError={urlError} />;
}
