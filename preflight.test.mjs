import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { CONFIG } from './config.js';

const requiredFiles = [
  'index.html', 'game.js', 'game-logic.js', 'config.js', 'strings.js', 'logic.js',
  'design/assets.csv', 'design/plan.md', 'design/style-formula.txt', 'design/thresholds.md',
  'assets/neon-city-background.png', 'assets/game-logo.png',
  ...Array.from({ length: 8 }, (_, index) => {
    const names = ['seven', 'diamond', 'watermelon', 'plum', 'apple', 'cherry', 'bell', 'bar'];
    return `assets/S${index + 1}-${names[index]}.png`;
  }),
];

test('all shipped game files and manifest assets exist', async () => {
  await Promise.all(requiredFiles.map((path) => access(new URL(path, import.meta.url), constants.R_OK)));
});

test('game math retains the documented eight symbols and 22 wheel segments', () => {
  assert.deepEqual(CONFIG.names.slice(1), ['Seven', 'Diamond', 'Watermelon', 'Plum', 'Apple', 'Cherry', 'Bell', 'Bar']);
  assert.equal(CONFIG.wheel.length, 22);
  assert.equal(CONFIG.rtp.toFixed(4), '0.9602');
});

test('browser source uses relative asset and module paths', async () => {
  const sources = await Promise.all(['index.html', 'game.js'].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of sources) {
    assert.doesNotMatch(source, /(?:src|href)=["']\//);
    assert.doesNotMatch(source, /(?:fetch|import)\(["']\//);
  }
});

test('local launcher is executable', async () => {
  await access(new URL('start.command', import.meta.url), constants.X_OK);
});
