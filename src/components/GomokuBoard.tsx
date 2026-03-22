import { useCallback, useEffect, useRef, useState } from "react";

const BOARD_SIZE = 15;
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
  ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
  ctx.beginPath();
  ctx.arc(x + radius * 0.08, y + radius * 0.08, radius, 0, Math.PI * 2);
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
  const padding = size * 0.06;
  const cellSize = (size - 2 * padding) / (BOARD_SIZE - 1);
  const pieceRadius = cellSize * 0.42;

  // 木质背景
  ctx.fillStyle = "#D4A460";
  ctx.fillRect(0, 0, size, size);

  // 棋盘边框
  ctx.strokeStyle = "#8B6914";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    padding - 2,
    padding - 2,
    (BOARD_SIZE - 1) * cellSize + 4,
    (BOARD_SIZE - 1) * cellSize + 4,
  );

  // 网格线
  ctx.strokeStyle = "#5C4033";
  ctx.lineWidth = 1;
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
  ctx.fillStyle = "#5C4033";
  for (const [r, c] of STAR_POINTS) {
    ctx.beginPath();
    ctx.arc(
      padding + c * cellSize,
      padding + r * cellSize,
      cellSize * 0.1,
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
    // 收集坐标对
    const coords: [number, number][] = [];
    for (let i = 0; i < line.length; i += 2) {
      coords.push([line[i]!, line[i + 1]!]);
    }
    // 每个得分点上画金色圆圈
    ctx.strokeStyle = "rgba(255, 215, 0, 0.8)";
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
    // 连线
    if (coords.length >= 2) {
      ctx.strokeStyle = "rgba(255, 215, 0, 0.5)";
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
    const lastColor = board[lastMove.row]?.[lastMove.col];
    ctx.fillStyle = lastColor === 1 ? "#ff4444" : "#ff4444";
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
  const [size, setSize] = useState(560);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const measure = () => {
      const rect = container.getBoundingClientRect();
      setSize(Math.floor(Math.min(rect.width, rect.height, 640)));
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

      const padding = size * 0.06;
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
      className="w-full flex items-center justify-center"
      style={{ aspectRatio: "1", maxWidth: 640 }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
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
