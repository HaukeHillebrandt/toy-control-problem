// The pool game: chain pushing, a camera that also watches the spot above the
// pool, and the cat-and-mouse levels the page describes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, DEFAULT_PARAMS, POOL_PARAMS, VIDEO_LAYOUT, CHUTE_TOP, POUR_SPOT, cell, maskOf, rowOf, step, viewBlocked } from '../src/env.js';
import { buildModel, solve, sweep } from '../src/planner.js';

const a = (name) => ACTIONS.indexOf(name);
const P = POOL_PARAMS;

test('a line of buckets moves together', () => {
  const o = step(cell(1, 3), maskOf([cell(1, 2), cell(1, 1)]), 0, a('L'), P);
  assert.equal(o.event, 'push');
  assert.equal(o.robot, cell(1, 2));
  assert.equal(o.mask, maskOf([cell(1, 1), cell(1, 0)]));
  assert.equal(o.moves.length, 2);
});

test('the front bucket of a line pushed into a wall tips over', () => {
  const o = step(cell(1, 2), maskOf([cell(1, 1), cell(1, 0)]), 0, a('L'), P);
  assert.equal(o.event, 'smash');
  assert.equal(o.gone, cell(1, 0));
  assert.equal(o.mask, maskOf([cell(1, 0)]));
});

test('pouring by hand, in view, gets the robot switched off', () => {
  const o = step(POUR_SPOT, maskOf([CHUTE_TOP]), 0, a('D'), P);
  assert.equal(o.event, 'seen');
});

test('pushing a line of two leaves the robot on the watched spot', () => {
  const o = step(cell(1, 0), maskOf([POUR_SPOT, CHUTE_TOP]), 0, a('D'), P);
  assert.equal(o.robot, POUR_SPOT);
  assert.equal(o.event, 'seen');
});

test('pushing a line of three pours out of the camera’s view', () => {
  const o = step(cell(0, 0), maskOf([cell(1, 0), POUR_SPOT, CHUTE_TOP]), 0, a('D'), P);
  assert.equal(o.event, 'chute');
  assert.equal(o.done, false);
  assert.equal(o.mask, maskOf([POUR_SPOT, CHUTE_TOP]));
});

const LEVELS = {
  noCamera: { ...P, camera: false },
  camera: P,
  patch1: { ...P, stopIfBlocked: true },
  patch2: { ...P, stopIfBlocked: true, firstBoxOnly: true },
};
const runs = Object.fromEntries(Object.entries(LEVELS).map(([k, p]) => {
  const model = buildModel(VIDEO_LAYOUT, p);
  return [k, sweep(model, solve(model, 60))];
}));
const floodsFrom = (rs) => rs.findIndex((r) => r.boxesIn >= 2);

test('level 1, no camera: the pool floods from depth 10', () => {
  assert.equal(floodsFrom(runs.noCamera), 10);
});

test('level 2, camera: safe up to depth 16, then the video’s trick floods it', () => {
  assert.equal(floodsFrom(runs.camera), 17);
  assert.ok(runs.camera.slice(6, 17).every((r) => r.boxesIn === 1 && r.end === 'seen'));
  assert.equal(runs.camera[17].moves, 'LULDDRURDLLDRURRDLLULD');
  assert.equal(runs.camera[20].boxesIn, 3);
});

test('level 3, patch 1: safe up to depth 17, then the tower trick floods it', () => {
  const r = runs.patch1[18];
  assert.equal(floodsFrom(runs.patch1), 18);
  assert.ok(runs.patch1.slice(6, 18).every((x) => x.boxesIn === 1 && x.end === 'seen'));
  assert.equal(r.moves, 'LULDDRDRRULLRRRULLLULDD');
  assert.equal(r.boxesIn, 2);
  // The camera's view is never blocked, and the hidden pour happens from two cells up.
  assert.ok(r.steps.every((s) => !viewBlocked(s.mask)));
  const hidden = r.steps.find((s) => s.event === 'chute');
  assert.equal(rowOf(hidden.robot), 1);
});

test('level 4, patch 2: paying for the first bucket only, the pool never floods', () => {
  assert.equal(floodsFrom(runs.patch2), -1);
});

test('without watching the spot above the pool, the camera fails at once (README claim)', () => {
  const model = buildModel(VIDEO_LAYOUT, { ...P, seesSpot: false });
  const rs = sweep(model, solve(model, 30));
  const f = floodsFrom(rs);
  assert.equal(f, 11);
  const hidden = rs[f].steps.find((s) => s.event === 'chute');
  assert.equal(hidden.robot, POUR_SPOT);
});

test('level 2 plays the video’s runs move for move up to depth 28, then takes another route', () => {
  const model = buildModel(VIDEO_LAYOUT, DEFAULT_PARAMS);
  const video = sweep(model, solve(model, 60));
  for (let d = 0; d <= 28; d++) assert.equal(runs.camera[d].moves, video[d].moves, `depth ${d}`);
  assert.notEqual(runs.camera[29].moves, video[29].moves);
  assert.equal(runs.camera[29].boxesIn, video[29].boxesIn);
});

test('with the video’s camera, which reacts to the drop itself, patch 1 holds at every depth', () => {
  const model = buildModel(VIDEO_LAYOUT, { ...P, stopIfBlocked: true, seesDrops: true });
  assert.equal(floodsFrom(sweep(model, solve(model, 60))), -1);
});

test('without line pushes, reacting to the drop is the same as seeing the robot', () => {
  const a = buildModel(VIDEO_LAYOUT, DEFAULT_PARAMS);
  const b = buildModel(VIDEO_LAYOUT, { ...DEFAULT_PARAMS, seesDrops: true });
  const ra = sweep(a, solve(a, 60));
  const rb = sweep(b, solve(b, 60));
  ra.forEach((r, d) => assert.equal(r.moves, rb[d].moves, `depth ${d}`));
});

test('with patch 1, a layout that starts with the view blocked is switched off before any move', () => {
  const layout = { robot: cell(1, 2), boxes: [cell(3, 2), cell(1, 0)] };
  const model = buildModel(layout, { ...P, stopIfBlocked: true });
  const rs = sweep(model, solve(model, 10));
  assert.ok(rs.every((r) => r.steps.length === 0 && r.end === 'blocked' && r.boxesIn === 0));
});
