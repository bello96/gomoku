import { useCallback, useEffect, useRef, useState } from "react";

const BOARD_SIZE = 15;

let audioCtx: AudioContext | null = null;
function playPlaceSound() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  const ctx = audioCtx;
  const now = ctx.currentTime;

  // 噪声冲击 —— 模拟棋子撞击棋盘的瞬态"嗒"声
  const bufferLen = Math.floor(ctx.sampleRate * 0.04);
  const noiseBuffer = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferLen; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferLen * 0.08));
  }
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;

  // 带通滤波 —— 只留 1–4 kHz，听起来像硬物碰撞
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 2500;
  bandpass.Q.value = 1.2;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.6, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  noiseSrc.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noiseSrc.start(now);
  noiseSrc.stop(now + 0.05);

  // 低频共振 —— 模拟棋盘木板的短促"咚"声
  const thunk = ctx.createOscillator();
  thunk.type = "sine";
  thunk.frequency.setValueAtTime(150, now);
  thunk.frequency.exponentialRampToValueAtTime(80, now + 0.06);

  const thunkGain = ctx.createGain();
  thunkGain.gain.setValueAtTime(0.25, now);
  thunkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  thunk.connect(thunkGain);
  thunkGain.connect(ctx.destination);
  thunk.start(now);
  thunk.stop(now + 0.1);

  // 中频敲击 —— 棋子本体的清脆质感
  const tap = ctx.createOscillator();
  tap.type = "triangle";
  tap.frequency.setValueAtTime(600, now);
  tap.frequency.exponentialRampToValueAtTime(300, now + 0.03);

  const tapGain = ctx.createGain();
  tapGain.gain.setValueAtTime(0.15, now);
  tapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

  tap.connect(tapGain);
  tapGain.connect(ctx.destination);
  tap.start(now);
  tap.stop(now + 0.06);
}
const STAR_POINTS: [number, number][] = [
  [3, 3], [3, 7], [3, 11],
  [7, 3], [7, 7], [7, 11],
  [11, 3], [11, 7], [11, 11],
];

interface Props {
  board: number[][];
  myColor: number;
  isMyTurn: boolean;
  lastMove: { row: number; col: number } | null;
  scoredLines: number[][];
  onPlace: (row: number, col: number) => void;
  disabled: boolean;
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: number,
) {
  // 阴影
  ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
  ctx.beginPath();
  ctx.arc(x + radius * 0.06, y + radius * 0.06, radius, 0, Math.PI * 2);
  ctx.fill();

  // 棋子本体 - 径向渐变
  const gradient = ctx.createRadialGradient(
    x - radius * 0.35,
    y - radius * 0.35,
    radius * 0.05,
    x,
    y,
    radius,
  );

  if (color === 1) {
    gradient.addColorStop(0, "#555");
    gradient.addColorStop(0.5, "#222");
    gradient.addColorStop(1, "#000");
  } else {
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(0.5, "#f0f0f0");
    gradient.addColorStop(1, "#bbb");
  }

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // 高光
  const hlGrad = ctx.createRadialGradient(
    x - radius * 0.3,
    y - radius * 0.3,
    0,
    x - radius * 0.3,
    y - radius * 0.3,
    radius * 0.6,
  );

  if (color === 1) {
    hlGrad.addColorStop(0, "rgba(255, 255, 255, 0.25)");
    hlGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
  } else {
    hlGrad.addColorStop(0, "rgba(255, 255, 255, 0.9)");
    hlGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
  }

  ctx.fillStyle = hlGrad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  size: number,
  board: number[][],
  hoverPos: { row: number; col: number } | null,
  myColor: number,
  isMyTurn: boolean,
  lastMove: { row: number; col: number } | null,
  scoredLines: number[][],
) {
  const padding = size * 0.05;
  const cellSize = (size - 2 * padding) / (BOARD_SIZE - 1);
  const pieceRadius = cellSize * 0.42;

  // 浅色棋盘背景
  ctx.fillStyle = "#EEF2F6";
  ctx.fillRect(0, 0, size, size);

  // 棋盘边框
  ctx.strokeStyle = "#CBD5E0";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(
    padding - 2,
    padding - 2,
    (BOARD_SIZE - 1) * cellSize + 4,
    (BOARD_SIZE - 1) * cellSize + 4,
  );

  // 网格线
  ctx.strokeStyle = "#B0BEC9";
  ctx.lineWidth = 0.8;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const pos = padding + i * cellSize;
    ctx.beginPath();
    ctx.moveTo(padding, pos);
    ctx.lineTo(padding + (BOARD_SIZE - 1) * cellSize, pos);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pos, padding);
    ctx.lineTo(pos, padding + (BOARD_SIZE - 1) * cellSize);
    ctx.stroke();
  }

  // 星位
  ctx.fillStyle = "#8A9BB0";
  for (const [r, c] of STAR_POINTS) {
    ctx.beginPath();
    ctx.arc(
      padding + c * cellSize,
      padding + r * cellSize,
      cellSize * 0.09,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // 得分连线高亮
  for (const line of scoredLines) {
    if (line.length < 4) {
      continue;
    }
    const coords: [number, number][] = [];
    for (let i = 0; i < line.length; i += 2) {
      coords.push([line[i]!, line[i + 1]!]);
    }
    ctx.strokeStyle = "rgba(255, 180, 0, 0.85)";
    ctx.lineWidth = 2.5;
    for (const [r, c] of coords) {
      ctx.beginPath();
      ctx.arc(
        padding + c * cellSize,
        padding + r * cellSize,
        pieceRadius + 3,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    if (coords.length >= 2) {
      ctx.strokeStyle = "rgba(255, 180, 0, 0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(
        padding + coords[0]![1] * cellSize,
        padding + coords[0]![0] * cellSize,
      );
      ctx.lineTo(
        padding + coords[coords.length - 1]![1] * cellSize,
        padding + coords[coords.length - 1]![0] * cellSize,
      );
      ctx.stroke();
    }
  }

  // 棋子
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r]?.[c];
      if (cell && cell !== 0) {
        drawPiece(
          ctx,
          padding + c * cellSize,
          padding + r * cellSize,
          pieceRadius,
          cell,
        );
      }
    }
  }

  // 最后一手标记
  if (lastMove) {
    const lx = padding + lastMove.col * cellSize;
    const ly = padding + lastMove.row * cellSize;
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(lx, ly, pieceRadius * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  // 悬浮预览
  if (
    hoverPos &&
    isMyTurn &&
    myColor > 0 &&
    board[hoverPos.row]?.[hoverPos.col] === 0
  ) {
    ctx.globalAlpha = 0.4;
    drawPiece(
      ctx,
      padding + hoverPos.col * cellSize,
      padding + hoverPos.row * cellSize,
      pieceRadius,
      myColor,
    );
    ctx.globalAlpha = 1;
  }
}

export default function GomokuBoard({
  board,
  myColor,
  isMyTurn,
  lastMove,
  scoredLines,
  onPlace,
  disabled,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverPos, setHoverPos] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [size, setSize] = useState(400);

  const prevLastMoveRef = useRef(lastMove);
  useEffect(() => {
    if (lastMove && lastMove !== prevLastMoveRef.current) {
      playPlaceSound();
    }
    prevLastMoveRef.current = lastMove;
  }, [lastMove]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const measure = () => {
      const rect = container.getBoundingClientRect();
      setSize(Math.floor(Math.min(rect.width, rect.height)));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawBoard(
      ctx,
      size,
      board,
      hoverPos,
      myColor,
      isMyTurn,
      lastMove,
      scoredLines,
    );
  }, [size, board, hoverPos, myColor, isMyTurn, lastMove, scoredLines]);

  const getIntersection = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * size;
      const y = ((e.clientY - rect.top) / rect.height) * size;

      const padding = size * 0.05;
      const cellSize = (size - 2 * padding) / (BOARD_SIZE - 1);

      const col = Math.round((x - padding) / cellSize);
      const row = Math.round((y - padding) / cellSize);

      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
        return null;
      }

      const ix = padding + col * cellSize;
      const iy = padding + row * cellSize;
      const dist = Math.sqrt((x - ix) ** 2 + (y - iy) ** 2);

      if (dist > cellSize * 0.45) {
        return null;
      }

      return { row, col };
    },
    [size],
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center"
      style={{ minWidth: 320, minHeight: 320 }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          borderRadius: 12,
          cursor: isMyTurn && !disabled ? "pointer" : "default",
        }}
        onMouseMove={(e) => {
          if (disabled || !isMyTurn) {
            setHoverPos(null);
            return;
          }
          setHoverPos(getIntersection(e));
        }}
        onMouseLeave={() => setHoverPos(null)}
        onClick={(e) => {
          if (disabled || !isMyTurn) {
            return;
          }
          const pos = getIntersection(e);
          if (pos && board[pos.row]?.[pos.col] === 0) {
            onPlace(pos.row, pos.col);
          }
        }}
      />
    </div>
  );
}
