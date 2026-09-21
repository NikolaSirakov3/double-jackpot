import { CONFIG } from './config.js';

export { CONFIG };

export const PAYLINES = [
  [[0, 0], [0, 1], [0, 2]],
  [[1, 0], [1, 1], [1, 2]],
  [[2, 0], [2, 1], [2, 2]],
  [[0, 0], [1, 1], [2, 2]],
  [[2, 0], [1, 1], [0, 2]],
];

export function createRng(seed = Date.now()) {
  let state = Number(seed) >>> 0 || 0x6d2b79f5;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function reelMotion(elapsed, reel, reducedMotion = false) {
  const stops = reducedMotion ? [260, 340, 420] : [800, 1020, 1240];
  const travel = reducedMotion ? 3 + reel : 12 + reel * 3;
  const stopAt = stops[reel];
  const t = Math.max(0, Math.min(1, elapsed / stopAt));
  const progress = 1 - Math.pow(1 - t, 3);
  return {
    position: t === 1 ? travel : travel * progress,
    settled: t === 1,
    stopAt,
  };
}

export function downwardReelTile(position, travel, row) {
  const base = Math.floor(position);
  const fraction = position - base;
  return {
    tapeIndex: travel - base + row,
    yInCells: row + fraction,
  };
}

export function screenFromStops(stops) {
  return Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, reel) => {
      const strip = CONFIG.strips[reel];
      const index = ((stops[reel] + row) % strip.length + strip.length) % strip.length;
      return strip[index];
    }),
  );
}

export function evaluateScreen(screen, totalBet = 5) {
  const lineBet = totalBet / 5;
  const winningLines = [];
  const winningCells = new Set();
  let lineWin = 0;

  PAYLINES.forEach((line, index) => {
    const symbol = screen[line[0][0]][line[0][1]];
    if (line.every(([row, reel]) => screen[row][reel] === symbol)) {
      winningLines.push(index);
      lineWin += CONFIG.pays[symbol] * lineBet;
      line.forEach(([row, reel]) => winningCells.add(`${row}:${reel}`));
    }
  });

  const jackpotSymbol = screen.every((row) => row.every((symbol) => symbol === screen[0][0]))
    ? screen[0][0]
    : 0;

  return {
    lineWin,
    winningLines,
    winningCells: [...winningCells],
    jackpotSymbol,
    wheelMultiplier: jackpotSymbol === 1 ? 2 : 1,
  };
}

function forcedScreen(kind) {
  if (kind === 'max') return Array.from({ length: 3 }, () => [1, 1, 1]);
  if (kind === 'wheel') return Array.from({ length: 3 }, () => [7, 7, 7]);
  if (kind === 'win') return [[2, 2, 2], [3, 4, 5], [6, 7, 8]];
  return null;
}

export function createSpinOutcome(random, totalBet = 5, force = null) {
  const fixed = forcedScreen(force);
  const stops = fixed
    ? null
    : CONFIG.strips.map((strip) => Math.floor(random() * strip.length));
  const screen = fixed ?? screenFromStops(stops);
  const result = evaluateScreen(screen, totalBet);
  let wheel = null;
  let wheelWin = 0;

  if (result.jackpotSymbol) {
    const index = force === 'max' ? 0 : Math.floor(random() * CONFIG.wheel.length);
    const [name, baseValue] = CONFIG.wheel[index];
    wheelWin = baseValue * (totalBet / 5) * result.wheelMultiplier;
    wheel = { index, name, baseValue, multiplier: result.wheelMultiplier, win: wheelWin };
  }

  return {
    stops,
    screen,
    result,
    wheel,
    totalWin: result.lineWin + wheelWin,
  };
}
