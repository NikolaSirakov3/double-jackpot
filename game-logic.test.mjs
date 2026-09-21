import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  createRng,
  screenFromStops,
  evaluateScreen,
  createSpinOutcome,
  reelMotion,
  downwardReelTile,
} from './game-logic.js';

test('seeded random generator repeats the same sequence', () => {
  const a = createRng(123456);
  const b = createRng(123456);
  assert.deepEqual([a(), a(), a(), a()], [b(), b(), b(), b()]);
});

test('screenFromStops maps three strip stops into a 3 by 3 screen', () => {
  const screen = screenFromStops([0, 0, 0]);
  assert.deepEqual(screen, [
    [CONFIG.strips[0][0], CONFIG.strips[1][0], CONFIG.strips[2][0]],
    [CONFIG.strips[0][1], CONFIG.strips[1][1], CONFIG.strips[2][1]],
    [CONFIG.strips[0][2], CONFIG.strips[1][2], CONFIG.strips[2][2]],
  ]);
});

test('evaluateScreen pays every winning fixed line and records its cells', () => {
  const screen = [
    [1, 1, 1],
    [2, 3, 2],
    [2, 4, 2],
  ];
  const result = evaluateScreen(screen, 5);
  assert.equal(result.lineWin, CONFIG.pays[1]);
  assert.deepEqual(result.winningLines, [0]);
  assert.equal(result.jackpotSymbol, 0);
});

test('full screen Seven pays five lines and flags the double-wheel symbol', () => {
  const screen = Array.from({ length: 3 }, () => [1, 1, 1]);
  const result = evaluateScreen(screen, 5);
  assert.equal(result.lineWin, CONFIG.pays[1] * 5);
  assert.deepEqual(result.winningLines, [0, 1, 2, 3, 4]);
  assert.equal(result.jackpotSymbol, 1);
  assert.equal(result.wheelMultiplier, 2);
});

test('bet scaling preserves the documented line-bet paytable', () => {
  const screen = [
    [8, 8, 8],
    [1, 2, 3],
    [4, 5, 6],
  ];
  assert.equal(evaluateScreen(screen, 20).lineWin, CONFIG.pays[8] * 4);
});

test('forced max outcome is a full screen of Sevens on Grand', () => {
  const outcome = createSpinOutcome(createRng(7), 5, 'max');
  assert.equal(outcome.result.jackpotSymbol, 1);
  assert.equal(outcome.wheel.index, 0);
  assert.equal(outcome.wheel.multiplier, 2);
  assert.equal(outcome.totalWin, 20750);
});

test('reel motion scrolls continuously and lands each reel at a staggered exact stop', () => {
  const start = reelMotion(0, 0);
  const moving = reelMotion(400, 0);
  const firstLanded = reelMotion(800, 0);
  const secondStillMoving = reelMotion(800, 1);
  const finalLanded = reelMotion(1240, 2);

  assert.deepEqual(start, { position: 0, settled: false, stopAt: 800 });
  assert.equal(moving.settled, false);
  assert.ok(moving.position > 0 && moving.position < 12);
  assert.deepEqual(firstLanded, { position: 12, settled: true, stopAt: 800 });
  assert.equal(secondStillMoving.settled, false);
  assert.deepEqual(finalLanded, { position: 18, settled: true, stopAt: 1240 });
});

test('reel tiles travel downward while the next symbol enters from above', () => {
  assert.deepEqual(downwardReelTile(0, 12, 0), { tapeIndex: 12, yInCells: 0 });
  assert.deepEqual(downwardReelTile(0.25, 12, 0), { tapeIndex: 12, yInCells: 0.25 });
  assert.deepEqual(downwardReelTile(0.25, 12, -1), { tapeIndex: 11, yInCells: -0.75 });
  assert.deepEqual(downwardReelTile(1.25, 12, 0), { tapeIndex: 11, yInCells: 0.25 });
  assert.deepEqual(downwardReelTile(12, 12, 0), { tapeIndex: 0, yInCells: 0 });
});
