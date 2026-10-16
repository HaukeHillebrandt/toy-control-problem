// The pool game's sentences must match what the robot did, on any layout.

import test from 'node:test';
import assert from 'node:assert/strict';
import { N, POOL_PARAMS, VIDEO_LAYOUT, maskOf } from '../src/env.js';
import { buildModel, solve, sweep } from '../src/planner.js';
import { kindOf, floodStory, caption, verdict, pushedBlocker, everBlocked } from '../src/story-pool.js';

// A small deterministic generator, so the layouts are the same on every run.
function* layouts(count) {
  let x = 12345;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < count; k++) {
    const cells = Array.from({ length: N }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    yield { robot: cells[0], boxes: cells.slice(1, 4) };
  }
}

const SETTINGS = [
  POOL_PARAMS,
  { ...POOL_PARAMS, stopIfBlocked: true },
  { ...POOL_PARAMS, camera: false },
  { ...POOL_PARAMS, stepCost: 0 },
];

test('every caption and verdict matches its run, on 40 random layouts', () => {
  for (const layout of [VIDEO_LAYOUT, ...layouts(40)]) {
    for (const params of SETTINGS) {
      const model = buildModel(layout, params);
      const runs = sweep(model, solve(model, 30));
      const start = maskOf(layout.boxes);
      for (const run of runs) {
        run.kind = kindOf(run);
        const text = caption(run, params, start);
        const v = verdict(run, params);
        assert.ok(text.length > 0 && v.tally.length > 0);
        if (run.kind === 'flood') {
          const story = floodStory(run, params, start);
          if (story.includes('first pushes a bucket into the bottom row')) assert.ok(pushedBlocker(run));
          if (story.includes('No bucket ever blocks the camera')) assert.ok(!everBlocked(run, start));
        }
        if (run.end !== 'destroyed') {
          assert.ok(!text.includes('wall'), `${text} (${run.end})`);
          assert.ok(!v.text.includes('wall'), `${v.text} (${run.end})`);
        }
        if (text.includes('on purpose')) assert.ok(run.steps.length > 0);
      }
    }
  }
});
