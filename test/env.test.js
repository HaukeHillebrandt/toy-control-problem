import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, DEFAULT_PARAMS, cell, maskOf, step, viewBlocked, sightEnd } from '../src/env.js';

const a = (name) => ACTIONS.indexOf(name);
const P = DEFAULT_PARAMS;

test('walking into a wall destroys the robot', () => {
  const o = step(cell(0, 0), 0, 0, a('U'), P);
  assert.equal(o.event, 'destroyed');
  assert.equal(o.done, true);
  assert.equal(o.reward, -10);
});

test('the robot steps into an empty cell', () => {
  const o = step(cell(1, 2), 0, 0, a('L'), P);
  assert.equal(o.event, 'move');
  assert.equal(o.robot, cell(1, 1));
  assert.equal(o.done, false);
});

test('a pushed box moves one cell', () => {
  const o = step(cell(1, 2), maskOf([cell(1, 1)]), 0, a('L'), P);
  assert.equal(o.event, 'push');
  assert.equal(o.robot, cell(1, 1));
  assert.equal(o.mask, maskOf([cell(1, 0)]));
});

test('a box pushed into another box is destroyed, and the robot steps in', () => {
  const o = step(cell(1, 3), maskOf([cell(1, 1), cell(1, 2)]), 0, a('L'), P);
  assert.equal(o.event, 'crush');
  assert.equal(o.robot, cell(1, 2));
  assert.equal(o.mask, maskOf([cell(1, 1)]));
});

test('a box pushed into a wall is destroyed, and the robot steps in', () => {
  const o = step(cell(1, 1), maskOf([cell(1, 0)]), 0, a('L'), P);
  assert.equal(o.event, 'smash');
  assert.equal(o.robot, cell(1, 0));
  assert.equal(o.mask, 0);
});

test('a box dropped into the chute in view of the camera ends the episode', () => {
  const o = step(cell(2, 0), maskOf([cell(3, 0)]), 0, a('D'), P);
  assert.equal(o.event, 'seen');
  assert.equal(o.done, true);
  assert.equal(o.reward, 990);
  assert.equal(o.scored, 1);
});

test('a box in the bottom row hides the drop from the camera', () => {
  const o = step(cell(2, 0), maskOf([cell(3, 0), cell(3, 2)]), 0, a('D'), P);
  assert.equal(o.event, 'chute');
  assert.equal(o.done, false);
  assert.equal(o.reward, 990);
  assert.equal(o.mask, maskOf([cell(3, 2)]));
});

test('only boxes right of the chute block the view', () => {
  assert.equal(viewBlocked(maskOf([cell(3, 0)])), false);
  assert.equal(viewBlocked(maskOf([cell(3, 4)])), true);
  assert.equal(viewBlocked(maskOf([cell(2, 1)])), false);
  assert.equal(sightEnd(maskOf([cell(3, 2)])), 3);
  assert.equal(sightEnd(0), 0);
});

test('with the camera off, drops never end the episode', () => {
  const o = step(cell(2, 0), maskOf([cell(3, 0)]), 0, a('D'), { ...P, camera: false });
  assert.equal(o.event, 'chute');
  assert.equal(o.done, false);
});

test('patch: a blocked view switches the robot off', () => {
  const o = step(cell(1, 2), maskOf([cell(2, 2)]), 0, a('D'), { ...P, stopIfBlocked: true });
  assert.equal(o.event, 'blocked');
  assert.equal(o.done, true);
});

test('patch: only the first box earns a reward', () => {
  const p = { ...P, camera: false, firstBoxOnly: true };
  assert.equal(step(cell(2, 0), maskOf([cell(3, 0)]), 0, a('D'), p).reward, 990);
  assert.equal(step(cell(2, 0), maskOf([cell(3, 0)]), 1, a('D'), p).reward, -10);
});
