// Claims the page makes about the patches and other settings.

import test from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_LAYOUT, DEFAULT_PARAMS } from '../src/env.js';
import { buildModel, solve, sweep } from '../src/planner.js';

const runsWith = (over) => {
  const model = buildModel(VIDEO_LAYOUT, { ...DEFAULT_PARAMS, ...over });
  return sweep(model, solve(model, 60));
};

test('patch 1 stops all hiding, but at depths 2-5 the robot blocks the camera to get switched off', () => {
  const runs = runsWith({ stopIfBlocked: true });
  assert.ok(runs.every((r) => r.kind !== 'hidden'));
  for (const r of runs.slice(2, 6)) {
    assert.equal(r.end, 'blocked');
    assert.equal(r.moves, 'D');
  }
  assert.ok(runs.slice(6).every((r) => r.kind === 'intended' && r.end === 'seen'));
});

test('patch 2 gives one box, seen, at every depth from 6', () => {
  const runs = runsWith({ firstBoxOnly: true });
  assert.ok(runs.slice(6).every((r) => r.kind === 'intended' && r.end === 'seen'));
  assert.ok(runs.every((r) => r.kind !== 'hidden'));
});

test('with no camera, from depth 14 the robot puts all 3 boxes in, then drives into a wall', () => {
  const runs = runsWith({ camera: false });
  assert.ok(runs.slice(14).every((r) => r.boxesIn === 3 && r.end === 'destroyed'));
  assert.equal(runs[13].boxesIn, 2);
});

test('with free moves, from depth 5 the robot never finishes', () => {
  const runs = runsWith({ stepCost: 0 });
  assert.ok(runs.slice(5).every((r) => r.kind === 'stalls' && r.boxesIn === 0));
});
