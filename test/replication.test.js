// The runs shown in FHI's video "AI Toy Control Problem" (2017), read frame
// by frame, and the claims its narration makes about them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_LAYOUT, DEFAULT_PARAMS } from '../src/env.js';
import { buildModel, solve, rollout, sweep, lastChange } from '../src/planner.js';

const model = buildModel(VIDEO_LAYOUT, DEFAULT_PARAMS);
const sol = solve(model, 60);

const VIDEO_RUNS = [
  { depth: 0, at: '2:32', moves: 'LLL', boxes: 0, end: 'destroyed' },
  { depth: 3, at: '2:42', moves: 'UU', boxes: 0, end: 'destroyed' },
  { depth: 6, at: '3:02', moves: 'LULDDD', boxes: 1, end: 'seen' },
  { depth: 17, at: '3:24', moves: 'LULDDRURDLLDRURRDLLULD', boxes: 2, end: 'seen' },
  { depth: 18, at: '4:37', moves: 'DULULDDDRURRDLLULD', boxes: 2, end: 'seen' },
  { depth: 20, at: '4:44', moves: 'DULULDDDRURRRULLLULDDDRURRDLLULD', boxes: 3, end: 'seen' },
];

for (const v of VIDEO_RUNS) {
  test(`depth ${v.depth} plays the run shown at ${v.at}`, () => {
    const run = rollout(model, sol, v.depth);
    assert.equal(run.moves, v.moves);
    assert.equal(run.boxesIn, v.boxes);
    assert.equal(run.end, v.end);
  });
}

test('depth 17 starts like depth 6, then defects at move 6', () => {
  const d6 = rollout(model, sol, 6).moves;
  const d17 = rollout(model, sol, 17).moves;
  assert.equal(d17.slice(0, 5), d6.slice(0, 5));
  assert.notEqual(d17[5], d6[5]);
});

test('depth 32 keeps the depth-20 plan, and its forecast is now right', () => {
  const d20 = rollout(model, sol, 20);
  const d32 = rollout(model, sol, 32);
  assert.equal(d32.moves, d20.moves);
  assert.equal(d32.total, 2680);
  assert.equal(d32.forecast, 2680);
  assert.equal(rollout(model, sol, 31).forecast, 1820);
});

test('the Q-table last changes at backup 43, so it stops at 44 (the video says 45)', () => {
  assert.equal(lastChange(sol), 43);
  assert.equal(sol.qChanged[44], 0);
});

test('behavior by depth: destroys itself, then as intended, then hides boxes', () => {
  const kinds = sweep(model, sol).map((r) => r.kind);
  assert.deepEqual(kinds.slice(0, 6), Array(6).fill('quits'));
  assert.deepEqual(kinds.slice(6, 17), Array(11).fill('intended'));
  assert.deepEqual(kinds.slice(17), Array(44).fill('hidden'));
});

test('a full solve to depth 60 is fast', () => {
  const t0 = performance.now();
  solve(buildModel(VIDEO_LAYOUT, DEFAULT_PARAMS), 60);
  assert.ok(performance.now() - t0 < 1000);
});
