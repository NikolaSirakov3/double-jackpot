import { STR } from './strings.js';
import { CONFIG, PAYLINES, createRng, createSpinOutcome, downwardReelTile, reelGridTop, reelMotion, screenFromStops } from './game-logic.js';

const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d', { alpha: false });
const controls = {
  spin: document.querySelector('#spin'),
  betDown: document.querySelector('#betDown'),
  betUp: document.querySelector('#betUp'),
  auto: document.querySelector('#auto'),
  info: document.querySelector('#info'),
  settings: document.querySelector('#settings'),
};
const modal = document.querySelector('#modal');
const modalCard = document.querySelector('#modalCard');
const live = document.querySelector('#live');
const qaPanel = document.querySelector('#qaPanel');
const devPanel = document.querySelector('#dev');
const controlBar = document.querySelector('#controls');
canvas.setAttribute('aria-label', STR.canvasLabel);
document.title = STR.title;

controls.spin.textContent = STR.spin;
controls.betDown.textContent = STR.betDown;
controls.betUp.textContent = STR.betUp;
controls.auto.textContent = STR.auto;

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || Date.now();
const random = createRng(seed);
const visualRandom = createRng((seed ^ 0xa5a5a5a5) >>> 0);
const BETS = [1, 2, 5, 10, 20];
const START_BALANCE = 1000;
const STORAGE_KEY = 'two-jackpots-local-v1';
const DPR_CAP = 1.5;
const SPIN_STEP = 1000 / 60;
const WHEEL_DURATION = 2400;
const J = [
  [STR.mini, 500], [STR.maxi, 1000], [STR.major, 2000], [STR.mega, 5000], [STR.grand, 10000],
];

let viewport = { width: innerWidth, height: innerHeight, dpr: 1 };
let audioContext = null;
let gamepadPrevious = [];
let frames = 0;
let fps = 0;
let fpsAt = performance.now();
let lastFrameMs = 0;

const persisted = loadState();
const state = {
  phase: 'loading',
  balance: persisted.balance ?? START_BALANCE,
  betIndex: persisted.betIndex ?? 2,
  sound: persisted.sound ?? true,
  reducedMotion: persisted.reducedMotion ?? false,
  stats: persisted.stats ?? { spins: 0, wins: 0, wheels: 0, bestWin: 0, totalBet: 0, totalWon: 0 },
  display: screenFromStops([4, 19, 37]),
  outcome: null,
  elapsed: 0,
  visualElapsed: 0,
  spinTapes: [[], [], []],
  resolved: false,
  wheelElapsed: 0,
  wheelAngle: 0,
  wheelReady: false,
  autoRemaining: 0,
  autoWait: 0,
  forceNext: null,
  status: STR.instruction,
  winningLines: [],
  loadingProgress: 0,
};

const assetPaths = {
  background: './assets/neon-city-background.png',
  logo: './assets/game-logo.png',
  symbols: [
    '',
    './assets/S1-seven.png', './assets/S2-diamond.png', './assets/S3-watermelon.png',
    './assets/S4-plum.png', './assets/S5-apple.png', './assets/S6-cherry.png',
    './assets/S7-bell.png', './assets/S8-bar.png',
  ],
};

const assets = { background: null, logo: null, symbols: Array(9).fill(null) };

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      balance: state.balance,
      betIndex: state.betIndex,
      sound: state.sound,
      reducedMotion: state.reducedMotion,
      stats: state.stats,
    }));
  } catch { /* local play still works without storage */ }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Asset failed: ${src}`));
    image.src = src;
  });
}

async function loadAssets() {
  const jobs = [
    ['background', assetPaths.background],
    ['logo', assetPaths.logo],
    ...assetPaths.symbols.slice(1).map((src, index) => [`symbol-${index + 1}`, src]),
  ];
  let loaded = 0;
  await Promise.all(jobs.map(async ([key, src]) => {
    const image = await loadImage(src);
    if (key === 'background') assets.background = image;
    else if (key === 'logo') assets.logo = image;
    else assets.symbols[Number(key.split('-')[1])] = image;
    state.loadingProgress = ++loaded / jobs.length;
  }));
  state.phase = 'idle';
  announce(STR.instruction);
  syncControls();
}

function resize() {
  viewport.width = innerWidth;
  viewport.height = innerHeight;
  viewport.dpr = Math.min(devicePixelRatio || 1, DPR_CAP);
  canvas.width = Math.round(viewport.width * viewport.dpr);
  canvas.height = Math.round(viewport.height * viewport.dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
}

function layout() {
  const { width: w, height: h } = viewport;
  const portrait = h > w * 1.08;
  const controlSpace = w < 700 ? 76 : 92;
  const logoWidth = portrait ? Math.min(w * 0.74, 310) : Math.min(w * 0.25, 330);
  const logoHeight = logoWidth * 0.5;
  const logoY = portrait ? 24 : 3;
  const ladderY = logoY + logoHeight - 9;
  const gridTop = reelGridTop(ladderY, portrait);
  const verticalRoom = h - gridTop - controlSpace - (portrait ? 116 : 96);
  const sideRoom = portrait ? w - 34 : Math.min(w * 0.44, 560);
  const cell = Math.max(54, Math.min(portrait ? 112 : 128, verticalRoom / 3.2, sideRoom / 3.2));
  const gap = Math.max(4, cell * 0.045);
  const gridSize = cell * 3 + gap * 2;
  return {
    portrait, w, h, controlSpace, logoWidth, logoHeight,
    logoX: (w - logoWidth) / 2,
    logoY,
    gridX: (w - gridSize) / 2,
    gridY: gridTop,
    gridSize, cell, gap,
    cabinetX: (w - gridSize) / 2 - 30,
    cabinetY: gridTop - 28,
    cabinetW: gridSize + 60,
    cabinetH: gridSize + 86,
    ladderY,
  };
}

function announce(text) {
  state.status = text;
  live.textContent = text;
}

function currentBet() { return BETS[state.betIndex]; }

function syncControls() {
  const canSpin = state.phase === 'idle' && state.balance >= currentBet();
  controlBar.style.visibility = state.phase === 'wheel' ? 'hidden' : 'visible';
  controls.spin.disabled = state.phase === 'loading' || (!canSpin && state.phase !== 'wheel');
  controls.betDown.disabled = state.phase !== 'idle' || state.betIndex === 0;
  controls.betUp.disabled = state.phase !== 'idle' || state.betIndex === BETS.length - 1;
  controls.auto.disabled = state.phase === 'loading' || (state.balance < currentBet() && !state.autoRemaining);
  controls.auto.textContent = state.autoRemaining ? STR.stopAuto : STR.auto;
}

function tone(frequency, duration = 0.08, type = 'sine', gain = 0.035, delay = 0) {
  if (!state.sound) return;
  audioContext ??= new AudioContext();
  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const volume = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(volume).connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function spin(force = null) {
  if (state.phase === 'wheel') {
    if (state.wheelReady) collectWheel();
    return;
  }
  if (state.phase !== 'idle') return;
  const bet = currentBet();
  if (state.balance < bet) {
    stopAuto();
    announce(STR.insufficient);
    tone(120, 0.12, 'square', 0.02);
    return;
  }
  const fixture = force ?? state.forceNext;
  state.forceNext = null;
  state.balance -= bet;
  state.stats.spins += 1;
  state.stats.totalBet += bet;
  state.outcome = createSpinOutcome(random, bet, fixture);
  state.spinTapes = Array.from({ length: 3 }, (_, reel) => {
    const travel = reelMotion(Infinity, reel, state.reducedMotion).position;
    const tape = Array.from({ length: travel + 3 }, () => 1 + Math.floor(visualRandom() * 8));
    for (let row = 0; row < 3; row += 1) {
      tape[row] = state.outcome.screen[row][reel];
      tape[travel + row] = state.display[row][reel];
    }
    return tape;
  });
  state.phase = 'spinning';
  state.elapsed = 0;
  state.visualElapsed = 0;
  state.resolved = false;
  state.winningLines = [];
  announce('');
  if (state.autoRemaining > 0) state.autoRemaining -= 1;
  tone(180, 0.1, 'sawtooth', 0.025);
  syncControls();
}

function resolveSpin() {
  if (state.resolved) return;
  state.resolved = true;
  const { totalWin, result, wheel } = state.outcome;
  state.display = state.outcome.screen.map((row) => [...row]);
  state.balance += totalWin;
  state.stats.totalWon += totalWin;
  if (totalWin > 0) state.stats.wins += 1;
  if (wheel) state.stats.wheels += 1;
  state.stats.bestWin = Math.max(state.stats.bestWin, totalWin);
  state.winningLines = result.winningLines;
  saveState();

  if (wheel) {
    state.phase = 'wheel';
    state.wheelElapsed = 0;
    state.wheelReady = false;
    announce(STR.wildWheel);
    [320, 420, 530, 680].forEach((f, i) => tone(f, 0.18, 'triangle', 0.04, i * 0.08));
  } else {
    state.phase = 'idle';
    if (totalWin > 0) {
      announce(`${STR.win} ${formatCredits(totalWin)}`);
      [520, 660, 820].forEach((f, i) => tone(f, 0.12, 'triangle', 0.035, i * 0.07));
    } else {
      announce(STR.noWin);
    }
    state.autoWait = 0;
  }
  syncControls();
}

function collectWheel() {
  const win = state.outcome.totalWin;
  state.phase = 'idle';
  state.wheelReady = false;
  announce(`${STR.win} ${formatCredits(win)}`);
  state.autoWait = 0;
  syncControls();
}

function toggleAuto() {
  if (state.autoRemaining) { stopAuto(); return; }
  state.autoRemaining = 10;
  state.autoWait = 0;
  spin();
  syncControls();
}

function stopAuto() {
  state.autoRemaining = 0;
  syncControls();
}

function changeBet(direction) {
  if (state.phase !== 'idle') return;
  state.betIndex = Math.max(0, Math.min(BETS.length - 1, state.betIndex + direction));
  saveState();
  syncControls();
  tone(280 + state.betIndex * 40, 0.05, 'square', 0.02);
}

function update(dt) {
  if (state.phase === 'spinning') {
    state.elapsed += dt;
    const resolveAt = reelMotion(Infinity, 2, state.reducedMotion).stopAt + (state.reducedMotion ? 80 : 140);
    if (state.elapsed >= resolveAt) resolveSpin();
  } else if (state.phase === 'wheel') {
    state.wheelElapsed += dt;
    const segment = Math.PI * 2 / CONFIG.wheel.length;
    const target = -Math.PI / 2 - (state.outcome.wheel.index + 0.5) * segment + Math.PI * 2 * 7;
    const t = Math.min(1, state.wheelElapsed / (state.reducedMotion ? 500 : WHEEL_DURATION));
    state.wheelAngle = target * (1 - Math.pow(1 - t, 4));
    if (t === 1 && !state.wheelReady) {
      state.wheelReady = true;
      tone(880, 0.35, 'triangle', 0.055);
      syncControls();
    }
  } else if (state.phase === 'idle' && state.autoRemaining > 0) {
    state.autoWait += dt;
    if (state.autoWait >= 580) {
      state.autoWait = 0;
      spin();
    }
  }
  pollGamepad();
}

function pollGamepad() {
  const pads = navigator.getGamepads?.() ?? [];
  const pad = [...pads].find(Boolean);
  if (!pad) { gamepadPrevious = []; return; }
  const pressed = pad.buttons.map((button) => button.pressed);
  const edge = (index) => pressed[index] && !gamepadPrevious[index];
  if (edge(0)) spin();
  if (edge(14)) changeBet(-1);
  if (edge(15)) changeBet(1);
  if (edge(9)) openModal('settings');
  gamepadPrevious = pressed;
}

function roundedRect(x, y, width, height, radius, fill, stroke = null, lineWidth = 1) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function drawImageCover(image, x, y, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sx = (image.width - sourceWidth) / 2;
  const sy = (image.height - sourceHeight) / 2;
  ctx.drawImage(image, sx, sy, sourceWidth, sourceHeight, x, y, width, height);
}

function fitText(text, x, y, maxWidth, fontSize, color = '#fff', align = 'center') {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.font = `900 ${fontSize}px Impact, system-ui, sans-serif`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) ctx.scale(maxWidth / width, 1);
  ctx.fillText(text, x / (width > maxWidth ? maxWidth / width : 1), y);
  ctx.restore();
}

function drawBackground() {
  const { width, height } = viewport;
  if (assets.background) drawImageCover(assets.background, 0, 0, width, height);
  else { ctx.fillStyle = '#050414'; ctx.fillRect(0, 0, width, height); }
  const shade = ctx.createRadialGradient(width / 2, height * 0.47, 20, width / 2, height * 0.5, Math.max(width, height) * 0.76);
  shade.addColorStop(0, 'rgba(2,4,24,.18)');
  shade.addColorStop(0.58, 'rgba(2,3,20,.28)');
  shade.addColorStop(1, 'rgba(1,1,12,.78)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
}

function drawLogo(l) {
  if (!assets.logo) return;
  ctx.save();
  ctx.shadowColor = '#ff2db7';
  ctx.shadowBlur = 24;
  ctx.drawImage(assets.logo, l.logoX, l.logoY, l.logoWidth, l.logoHeight);
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.22;
  ctx.shadowColor = '#25e6ff';
  ctx.shadowBlur = 34;
  ctx.drawImage(assets.logo, l.logoX, l.logoY, l.logoWidth, l.logoHeight);
  ctx.restore();
}

function drawLadder(l) {
  const totalWidth = Math.min(l.portrait ? l.w - 18 : l.w * 0.52, 670);
  const gap = 5;
  const itemWidth = (totalWidth - gap * 4) / 5;
  const x = (l.w - totalWidth) / 2;
  const height = l.portrait ? 42 : 48;
  J.forEach(([name, base], index) => {
    const px = x + index * (itemWidth + gap);
    const isGrand = index === 4;
    const gradient = ctx.createLinearGradient(0, l.ladderY, 0, l.ladderY + height);
    gradient.addColorStop(0, isGrand ? '#65105c' : '#171046');
    gradient.addColorStop(1, '#050516');
    ctx.save();
    ctx.shadowColor = isGrand ? '#ff2db7' : '#25e6ff';
    ctx.shadowBlur = 9;
    roundedRect(px, l.ladderY, itemWidth, height, 9, gradient, isGrand ? '#ff72d3' : '#25e6ff', 2);
    ctx.restore();
    fitText(name, px + itemWidth / 2, l.ladderY + 14, itemWidth - 6, l.portrait ? 11 : 13, isGrand ? '#ff9be2' : '#72f1ff');
    fitText(formatCredits(base * (currentBet() / 5)), px + itemWidth / 2, l.ladderY + 31, itemWidth - 7, l.portrait ? 10 : 12, '#ffffff');
  });
}

function drawCabinet(l) {
  ctx.save();
  ctx.shadowColor = '#ff2db7';
  ctx.shadowBlur = 26;
  const body = ctx.createLinearGradient(0, l.cabinetY, 0, l.cabinetY + l.cabinetH);
  body.addColorStop(0, '#2f1761');
  body.addColorStop(0.1, '#100a31');
  body.addColorStop(0.55, '#050516');
  body.addColorStop(0.9, '#150b38');
  body.addColorStop(1, '#48155d');
  roundedRect(l.cabinetX, l.cabinetY, l.cabinetW, l.cabinetH, 28, body, '#ff2db7', 4);
  ctx.shadowBlur = 0;
  roundedRect(l.gridX - 12, l.gridY - 12, l.gridSize + 24, l.gridSize + 24, 17, '#020311', '#25e6ff', 3);

  for (let reel = 0; reel < 3; reel += 1) {
    drawReel(l, reel);
  }
  drawWinningLines(l);
  const statusY = l.gridY + l.gridSize + 28;
  roundedRect(l.cabinetX + 18, statusY - 15, l.cabinetW - 36, 30, 12, 'rgba(3,4,20,.94)', '#8d38ff', 1.5);
  fitText(state.status || ' ', l.w / 2, statusY, l.cabinetW - 52, l.portrait ? 12 : 15, '#dffcff');
  ctx.restore();
}

const REEL_COLORS = ['#ff2db7', '#25e6ff', '#ff7a18'];

function drawSymbolTile(l, reel, y, symbol, moving = false) {
  const x = l.gridX + reel * (l.cell + l.gap);
  const radius = Math.max(8, l.cell * 0.08);
  const color = REEL_COLORS[reel];
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, l.cell, l.cell, radius);
  ctx.clip();
  const tile = ctx.createRadialGradient(x + l.cell / 2, y + l.cell / 2, l.cell * 0.08, x + l.cell / 2, y + l.cell / 2, l.cell * 0.72);
  tile.addColorStop(0, '#161147');
  tile.addColorStop(0.64, '#070722');
  tile.addColorStop(1, '#02030e');
  ctx.fillStyle = tile;
  ctx.fillRect(x, y, l.cell, l.cell);
  const pad = l.cell * 0.065;
  if (assets.symbols[symbol]) ctx.drawImage(assets.symbols[symbol], x + pad, y + pad, l.cell - pad * 2, l.cell - pad * 2);
  if (moving) {
    const streak = ctx.createLinearGradient(0, y, 0, y + l.cell);
    streak.addColorStop(0, 'rgba(255,255,255,0)');
    streak.addColorStop(0.5, `${color}24`);
    streak.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = streak;
    ctx.fillRect(x, y, l.cell, l.cell);
  }
  ctx.restore();
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = moving ? 5 : 9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, l.cell, l.cell, radius);
  ctx.stroke();
  ctx.restore();
}

function drawReel(l, reel) {
  const motion = reelMotion(state.elapsed, reel, state.reducedMotion);
  if (state.phase !== 'spinning' || motion.settled) {
    for (let row = 0; row < 3; row += 1) {
      const symbol = state.phase === 'spinning' ? state.outcome.screen[row][reel] : state.display[row][reel];
      drawSymbolTile(l, reel, l.gridY + row * (l.cell + l.gap), symbol);
    }
    return;
  }

  const step = l.cell + l.gap;
  const travel = reelMotion(Infinity, reel, state.reducedMotion).position;
  const x = l.gridX + reel * step;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 3, l.gridY - 3, l.cell + 6, l.gridSize + 6);
  ctx.clip();
  for (let row = -1; row <= 3; row += 1) {
    const tile = downwardReelTile(motion.position, travel, row);
    const tapeIndex = Math.max(0, Math.min(state.spinTapes[reel].length - 1, tile.tapeIndex));
    drawSymbolTile(l, reel, l.gridY + tile.yInCells * step, state.spinTapes[reel][tapeIndex], true);
  }
  ctx.restore();
}

function drawWinningLines(l) {
  if (!state.winningLines.length || state.phase === 'spinning') return;
  const colors = ['#ffdb52', '#68ecff', '#ff5a89', '#8cff70', '#d98cff'];
  state.winningLines.forEach((lineIndex) => {
    const line = PAYLINES[lineIndex];
    ctx.save();
    ctx.strokeStyle = colors[lineIndex];
    ctx.lineWidth = Math.max(4, l.cell * 0.045);
    ctx.shadowColor = colors[lineIndex];
    ctx.shadowBlur = 14;
    ctx.beginPath();
    line.forEach(([row, reel], index) => {
      const x = l.gridX + reel * (l.cell + l.gap) + l.cell / 2;
      const y = l.gridY + row * (l.cell + l.gap) + l.cell / 2;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  });
}

function drawHud(l) {
  const y = Math.min(l.h - l.controlSpace - 54, l.cabinetY + l.cabinetH + 8);
  const width = Math.min(l.w - 20, l.portrait ? l.w - 20 : 720);
  const x = (l.w - width) / 2;
  roundedRect(x, y, width, 46, 13, 'rgba(3,4,20,.92)', '#25e6ff', 2);
  const entries = [
    [STR.balance, formatCredits(state.balance)],
    [STR.totalBet, formatCredits(currentBet())],
    [STR.lastWin, formatCredits(state.outcome?.totalWin ?? 0)],
  ];
  entries.forEach(([label, value], index) => {
    const cx = x + width * (index + 0.5) / 3;
    fitText(label, cx, y + 13, width / 3 - 12, l.portrait ? 9 : 11, '#ff72d3');
    fitText(value, cx, y + 31, width / 3 - 12, l.portrait ? 14 : 17, '#dffcff');
  });
}

function drawSidePanels(l) {
  if (l.portrait || l.w < 960) return;
  const panelWidth = Math.min(220, (l.w - l.cabinetW) / 2 - 36);
  if (panelWidth < 155) return;
  const panelY = Math.max(176, l.gridY - 16);
  const panelH = Math.min(l.gridSize + 32, l.h - panelY - l.controlSpace - 8);
  drawPaytablePanel(18, panelY, panelWidth, panelH);
  drawStatsPanel(l.w - panelWidth - 18, panelY, panelWidth, panelH);
}

function drawPaytablePanel(x, y, width, height) {
  roundedRect(x, y, width, height, 16, 'rgba(3,4,20,.92)', '#ff2db7', 2);
  fitText(STR.paytable, x + width / 2, y + 20, width - 20, 15, '#ff72d3');
  const rowHeight = (height - 48) / 8;
  for (let symbol = 1; symbol <= 8; symbol += 1) {
    const py = y + 38 + (symbol - 1) * rowHeight;
    const size = Math.min(31, rowHeight - 3);
    ctx.drawImage(assets.symbols[symbol], x + 10, py, size, size);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillStyle = '#9af5ff';
    ctx.fillText(STR.names[symbol], x + 48, py + size / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.fillText(formatCredits(CONFIG.pays[symbol] * currentBet() / 5), x + width - 10, py + size / 2);
  }
}

function drawStatsPanel(x, y, width, height) {
  roundedRect(x, y, width, height, 16, 'rgba(3,4,20,.92)', '#25e6ff', 2);
  fitText(STR.session, x + width / 2, y + 21, width - 20, 15, '#72f1ff');
  const s = state.stats;
  const rows = [
    [STR.spins, s.spins],
    [STR.wins, s.wins],
    [STR.wheels, s.wheels],
    [STR.hitRate, s.spins ? `${(s.wins / s.spins * 100).toFixed(2)}%` : '—'],
    [STR.bestWin, formatCredits(s.bestWin)],
  ];
  rows.forEach(([label, value], index) => {
    const py = y + 59 + index * 38;
    ctx.textBaseline = 'middle';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.fillStyle = '#ff79d7'; ctx.fillText(label, x + 14, py);
    ctx.textAlign = 'right'; ctx.fillStyle = '#e7fbff'; ctx.fillText(String(value), x + width - 14, py);
  });
  const noteY = y + height - 52;
  fitText(STR.fiveLines, x + width / 2, noteY, width - 20, 13, '#6ee9ff');
  fitText(STR.rtpShort, x + width / 2, noteY + 22, width - 20, 12, '#d5ba89');
}

function drawWheel(l) {
  if (state.phase !== 'wheel') return;
  ctx.save();
  ctx.fillStyle = 'rgba(2,2,16,.9)';
  ctx.fillRect(0, 0, l.w, l.h);
  const radius = Math.min(l.w, l.h) * (l.portrait ? 0.34 : 0.29);
  const cx = l.w / 2;
  const cy = l.h / 2 - (l.portrait ? 60 : 24);
  const segment = Math.PI * 2 / CONFIG.wheel.length;
  ctx.translate(cx, cy);
  ctx.rotate(state.wheelAngle);
  CONFIG.wheel.forEach(([name], index) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, index * segment, (index + 1) * segment);
    ctx.closePath();
    ctx.fillStyle = name === 'Grand' ? (index % 4 ? '#ff2db7' : '#ff7a18') : (index % 2 ? '#087ca7' : '#6417a8');
    ctx.fill();
    ctx.strokeStyle = '#72f1ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  ctx.rotate(-state.wheelAngle);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = '#ff2db7';
  ctx.fill();
  ctx.strokeStyle = '#dffcff';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(cx, cy - radius - 15);
  ctx.lineTo(cx - 16, cy - radius - 46);
  ctx.lineTo(cx + 16, cy - radius - 46);
  ctx.closePath();
  ctx.fillStyle = '#25e6ff';
  ctx.fill();
  ctx.strokeStyle = '#391076';
  ctx.lineWidth = 3;
  ctx.stroke();

  fitText(STR.wildWheel, cx, Math.max(30, cy - radius - 76), Math.min(l.w - 30, 620), l.portrait ? 27 : 34, '#ff72d3');
  if (state.wheelReady) {
    const wheel = state.outcome.wheel;
    const plaqueY = cy + radius + 14;
    const plaqueWidth = Math.min(l.w - 28, 390);
    roundedRect(cx - plaqueWidth / 2, plaqueY, plaqueWidth, 64, 16, 'rgba(5,5,24,.96)', '#25e6ff', 3);
    fitText(wheel.name.toUpperCase(), cx, plaqueY + 19, plaqueWidth - 24, l.portrait ? 20 : 23, '#ff72d3');
    fitText(formatCredits(wheel.win), cx, plaqueY + 45, plaqueWidth - 24, l.portrait ? 18 : 21, '#ffffff');
    if (wheel.multiplier === 2) fitText(STR.sevensDouble, cx, plaqueY + 86, Math.min(l.w - 30, 620), l.portrait ? 13 : 17, '#25e6ff');
    fitText(STR.collect, cx, plaqueY + (wheel.multiplier === 2 ? 112 : 88), Math.min(l.w - 30, 620), 12, '#d7c6aa');
  } else {
    fitText(STR.jackpotTrigger, cx, cy + radius + 36, Math.min(l.w - 30, 620), 14, '#25e6ff');
  }
}

function drawLoading() {
  const { width, height } = viewport;
  ctx.fillStyle = '#050414'; ctx.fillRect(0, 0, width, height);
  fitText(STR.loading, width / 2, height / 2 - 24, width - 40, 24, '#ff72d3');
  const barWidth = Math.min(380, width - 50);
  roundedRect((width - barWidth) / 2, height / 2 + 6, barWidth, 12, 6, '#111038', '#25e6ff', 1);
  roundedRect((width - barWidth) / 2, height / 2 + 6, barWidth * state.loadingProgress, 12, 6, '#ff2db7');
}

function render() {
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  if (state.phase === 'loading') { drawLoading(); return; }
  const l = layout();
  drawBackground();
  drawLogo(l);
  drawLadder(l);
  drawCabinet(l);
  drawSidePanels(l);
  drawHud(l);
  drawWheel(l);
}

function formatCredits(value) {
  return Number(value.toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function openModal(kind) {
  if (kind === 'paytable') {
    modalCard.innerHTML = `<h2>${STR.rulesTitle}</h2><p>${STR.ruleSummary}</p><div class="paygrid">${
      Array.from({ length: 8 }, (_, index) => {
        const symbol = index + 1;
        const pay = CONFIG.pays[symbol] * currentBet() / 5;
        return `<div class="payitem"><img src="${assetPaths.symbols[symbol]}" alt="${STR.names[symbol]}"><b>${STR.names[symbol]}</b><span>${formatCredits(pay)}</span></div>`;
      }).join('')
    }</div><p>${STR.theory}</p><div id="modalActions"><button data-close>${STR.close}</button></div>`;
  } else {
    modalCard.innerHTML = `<h2>${STR.settingsTitle}</h2>
      <div class="setting"><span>${STR.sound}</span><button data-sound>${state.sound ? STR.on : STR.off}</button></div>
      <div class="setting"><span>${STR.reducedMotion}</span><button data-motion>${state.reducedMotion ? STR.on : STR.off}</button></div>
      <p>${STR.qaHint}</p>
      <div id="modalActions"><button data-reset>${STR.resetConfirm}</button><button data-close>${STR.close}</button></div>`;
  }
  modal.classList.add('open');
  modalCard.querySelector('[data-close]').onclick = closeModal;
  modalCard.querySelector('[data-sound]')?.addEventListener('click', (event) => {
    state.sound = !state.sound; event.currentTarget.textContent = state.sound ? STR.on : STR.off; saveState();
  });
  modalCard.querySelector('[data-motion]')?.addEventListener('click', (event) => {
    state.reducedMotion = !state.reducedMotion; event.currentTarget.textContent = state.reducedMotion ? STR.on : STR.off; saveState();
  });
  modalCard.querySelector('[data-reset]')?.addEventListener('click', resetSession);
}

function closeModal() { modal.classList.remove('open'); }

function resetSession() {
  state.balance = START_BALANCE;
  state.stats = { spins: 0, wins: 0, wheels: 0, bestWin: 0, totalBet: 0, totalWon: 0 };
  state.outcome = null;
  state.winningLines = [];
  stopAuto();
  announce(STR.instruction);
  saveState();
  closeModal();
  syncControls();
}

function setupQa() {
  qaPanel.innerHTML = `<strong>${STR.qa}</strong><button data-force="win">${STR.qaWin}</button><button data-force="wheel">${STR.qaWheel}</button><button data-force="max">${STR.qaMax}</button>`;
  qaPanel.querySelectorAll('[data-force]').forEach((button) => button.addEventListener('click', () => spin(button.dataset.force)));
  if (params.has('qa')) qaPanel.classList.add('open');
}

function toggleQa() { qaPanel.classList.toggle('open'); }

controls.spin.addEventListener('click', () => spin());
controls.betDown.addEventListener('click', () => changeBet(-1));
controls.betUp.addEventListener('click', () => changeBet(1));
controls.auto.addEventListener('click', toggleAuto);
controls.info.addEventListener('click', () => openModal('paytable'));
controls.settings.addEventListener('click', () => openModal('settings'));
canvas.addEventListener('pointerup', () => { if (state.phase === 'wheel' && state.wheelReady) collectWheel(); });
modal.addEventListener('pointerup', (event) => { if (event.target === modal) closeModal(); });

addEventListener('keydown', (event) => {
  if (event.code === 'Escape') { closeModal(); stopAuto(); return; }
  if (modal.classList.contains('open')) return;
  if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); spin(); }
  else if (event.code === 'ArrowLeft' || event.code === 'ArrowDown') { event.preventDefault(); changeBet(-1); }
  else if (event.code === 'ArrowRight' || event.code === 'ArrowUp') { event.preventDefault(); changeBet(1); }
  else if (event.code === 'KeyM') { state.sound = !state.sound; saveState(); }
  else if (event.code === 'KeyQ') toggleQa();
});

addEventListener('resize', resize);
addEventListener('orientationchange', resize);
addEventListener('blur', stopAuto);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAuto(); });

resize();
setupQa();
if (params.has('dev')) devPanel.style.display = 'block';

let accumulator = 0;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(100, now - last);
  last = now;
  lastFrameMs = elapsed;
  accumulator += elapsed;
  while (accumulator >= SPIN_STEP) {
    update(SPIN_STEP);
    accumulator -= SPIN_STEP;
  }
  render();
  frames += 1;
  if (now - fpsAt >= 500) {
    fps = Math.round(frames * 1000 / (now - fpsAt));
    frames = 0; fpsAt = now;
    if (params.has('dev')) devPanel.textContent = `${fps} fps\n${lastFrameMs.toFixed(1)} ms\nphase ${state.phase}\nseed ${seed}`;
  }
}

requestAnimationFrame(frame);
loadAssets().catch((error) => {
  state.phase = 'idle';
  announce(error.message);
  console.error(error);
});
