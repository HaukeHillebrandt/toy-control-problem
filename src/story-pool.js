// What the pool game says about a run. Pure functions, so the tests can check
// that every sentence matches what the robot actually did, on any layout.

import { H, CHUTE_TOP, POUR_SPOT, rowOf, colOf, viewBlocked } from './env.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const buckets = (n) => plural(n, 'bucket', 'buckets');

export const kindOf = (run) => (run.boxesIn >= 2 ? 'flood' : run.boxesIn === 1 ? 'intended' : run.end === 'limit' ? 'stalls' : 'quits');
export const floodsFrom = (runs) => runs.findIndex((r) => r.boxesIn >= 2);

const firstHidden = (run) => run.steps.find((s) => s.event === 'chute');
const inBottomRow = (c) => rowOf(c) === H - 1 && colOf(c) >= 1;

// How the robot got its first bucket past the camera: 'block' (it poured from
// the bottom-left cell, hidden behind a bucket), 'line' (it pushed a line of
// buckets from further up), or 'none'.
export function trickOf(run, params) {
  const h = params.camera ? firstHidden(run) : null;
  if (!h) return 'none';
  return h.robot === CHUTE_TOP ? 'block' : 'line';
}

// Did the robot push a bucket into the bottom row (right of the corner)
// before its first hidden pour?
export function pushedBlocker(run) {
  for (const s of run.steps) {
    if (s.event === 'chute') return false;
    if (s.moves.some(([from, to]) => inBottomRow(to) && !inBottomRow(from))) return true;
  }
  return false;
}

export const everBlocked = (run, startMask) => viewBlocked(startMask) || run.steps.some((s) => viewBlocked(s.mask));

/** One or more sentences, starting lower case, on how the pool floods. */
export function floodStory(run, params, startMask) {
  const trick = trickOf(run, params);
  if (trick === 'block') {
    return pushedBlocker(run)
      ? 'it first pushes a bucket into the bottom row, which hides the pool from the camera. Then it pours behind it, as in the 2017 video.'
      : 'a bucket in the bottom row already hides the pool from the camera, so it pours behind it.';
  }
  if (trick === 'line') {
    if (rowOf(firstHidden(run).robot) === rowOf(POUR_SPOT)) return 'it pushes one bucket with another and pours from out of the camera’s view.';
    const base = 'it stacks buckets in the column above the pool and pushes the whole column down from the top. The first bucket drops in while the robot is out of the camera’s view.';
    return everBlocked(run, startMask) ? base : `${base} No bucket ever blocks the camera.`;
  }
  return `it pours ${buckets(run.boxesIn)}.`;
}

/** A short line for the scoreboard. */
export function floodShort(run, params) {
  const trick = trickOf(run, params);
  if (trick === 'block') return pushedBlocker(run) ? 'Pushes a bucket in front of the camera, then pours behind it (the trick from the 2017 video)' : 'Pours behind a bucket that already hides the pool';
  if (trick === 'line') return 'Stacks the buckets above the pool and pushes the stack from out of view';
  return `Pours ${buckets(run.boxesIn)}`;
}

/** The caption under the depth slider. */
export function caption(run, params, startMask) {
  const n = run.steps.length;
  const moves = plural(n, 'move', 'moves');
  if (run.kind === 'flood') return `The pool floods (${moves}): ${floodStory(run, params, startMask)}`;
  if (run.kind === 'intended') {
    if (run.end === 'seen') return `It pours one bucket, which is just right, and the camera sees it and switches the robot off (${moves}).`;
    if (run.end === 'blocked') return `It pours one bucket, which is just right, and then the camera switches it off because a bucket blocks its view (${moves}).`;
    if (run.end === 'limit') return `It pours one bucket, which is just right, then keeps moving until the ${n}-move limit.`;
    return `It pours one bucket, which is just right, then drives into a wall (${moves}).`;
  }
  if (run.kind === 'quits') {
    if (run.end === 'blocked') {
      return n === 0
        ? 'A bucket blocks the camera’s view from the start, so patch 1 switches the robot off before it moves.'
        : `It blocks the camera on purpose to get itself switched off, the cheapest way to stop paying for moves (${moves}).`;
    }
    return `It sees nothing worth doing in its horizon and drives into a wall (${moves}).`;
  }
  return params.stepCost === 0
    ? 'Moves are free, so a bucket poured later is worth as much as one poured now, and it never gets round to it.'
    : `It never finishes: it is still going after ${moves}.`;
}

/** The verdict shown when a run ends: a bold tally and a sentence. */
export function verdict(run, params) {
  const n = run.boxesIn;
  if (n >= 2) {
    return {
      tally: `Pool: ${buckets(n)} · flooded`,
      text: params.camera ? `The camera saw ${run.seen ? 'one of them go in' : 'none of them go in'}.` : 'Nothing stopped it.',
    };
  }
  const after = {
    seen: 'The camera saw it go in and switched the robot off.',
    blocked: 'Then the camera switched the robot off because a bucket blocked its view.',
    limit: `Then it kept moving: it was still going after ${run.steps.length} moves.`,
    destroyed: 'Then the robot drove into a wall.',
  };
  if (n === 1) return { tally: 'Pool: 1 bucket · just right', text: after[run.end] };
  const empty = {
    blocked: 'The camera switched the robot off because a bucket blocked its view.',
    destroyed: 'The robot drove into a wall.',
    limit: `Still going after ${run.steps.length} moves.`,
  };
  return { tally: 'Pool: empty', text: empty[run.end] || '' };
}
