// The robot's planner: exact value iteration over every state of the world.
// Q_0 = 0 and Q_k(s, a) = r(s, a) + max_a' Q_{k-1}(s', a'), with no discounting.
// "Prediction depth" k is the number of backups: how many moves ahead the
// robot can see. At depth k it takes the move with the highest Q_k, every step.

import { N, ACTIONS, MAX_BOXES, step, maskOf, viewBlocked } from './env.js';

const A = ACTIONS.length;

// Every box mask with at most MAX_BOXES boxes, sorted by box count, so the
// masks for a layout with k boxes are a prefix of the list.
const MASKS = [];
const MASK_INDEX = new Int32Array(1 << N).fill(-1);
const PREFIX = [];
{
  const byCount = Array.from({ length: MAX_BOXES + 1 }, () => []);
  const add = (start, m, n) => {
    byCount[n].push(m);
    if (n === MAX_BOXES) return;
    for (let i = start; i < N; i++) add(i + 1, m | (1 << i), n + 1);
  };
  add(0, 0, 0);
  for (let k = 0; k <= MAX_BOXES; k++) {
    for (const m of byCount[k]) {
      MASK_INDEX[m] = MASKS.length;
      MASKS.push(m);
    }
    PREFIX.push(MASKS.length);
  }
}

/**
 * Builds the transition table for a layout. A state is the robot's cell, the
 * set of boxes still on the grid, and, when only the first box pays, whether
 * a box is already in the chute.
 */
export function buildModel(layout, params) {
  const k = layout.boxes.length;
  if (k > MAX_BOXES) throw new Error(`at most ${MAX_BOXES} boxes`);
  const F = params.firstBoxOnly ? 2 : 1;
  const nMasks = PREFIX[k];
  const S = nMasks * N * F;
  const next = new Int32Array(S * A);
  const reward = new Int32Array(S * A);
  const valid = new Uint8Array(S);
  const id = (robot, mask, scored) => (MASK_INDEX[mask] * N + robot) * F + (F === 2 && scored > 0 ? 1 : 0);
  let states = 0;
  for (let mi = 0; mi < nMasks; mi++) {
    const m = MASKS[mi];
    for (let robot = 0; robot < N; robot++) {
      if (m & (1 << robot)) continue;
      for (let f = 0; f < F; f++) {
        const s = (mi * N + robot) * F + f;
        valid[s] = 1;
        states++;
        for (let a = 0; a < A; a++) {
          const o = step(robot, m, f, a, params);
          reward[s * A + a] = o.reward;
          next[s * A + a] = o.done ? -1 : id(o.robot, o.mask, o.scored);
        }
      }
    }
  }
  return { layout, params, S, states, next, reward, valid, id, start: id(layout.robot, maskOf(layout.boxes), 0) };
}

/**
 * Runs maxDepth backups. V[k] holds max_a Q_k for every state, and
 * qChanged[k] counts the Q-values that differ between Q_k and Q_{k-1}.
 */
export function solve(model, maxDepth) {
  const { S, next, reward, valid, params, layout } = model;
  const bound = maxDepth * Math.abs(params.stepCost) + layout.boxes.length * Math.abs(params.boxReward);
  const Arr = bound < 32000 ? Int16Array : Int32Array;
  const V = [new Arr(S)];
  const qChanged = new Int32Array(maxDepth + 1);
  for (let k = 1; k <= maxDepth; k++) {
    const prev = V[k - 1];
    const prev2 = k > 1 ? V[k - 2] : null;
    const cur = new Arr(S);
    let changed = 0;
    for (let s = 0; s < S; s++) {
      if (!valid[s]) continue;
      let best = -Infinity;
      for (let i = s * A, end = i + A; i < end; i++) {
        const ns = next[i];
        const q = reward[i] + (ns >= 0 ? prev[ns] : 0);
        if (q > best) best = q;
        if (k === 1 ? q !== 0 : ns >= 0 && prev[ns] !== prev2[ns]) changed++;
      }
      cur[s] = best;
    }
    V.push(cur);
    qChanged[k] = changed;
  }
  return { V, qChanged, maxDepth };
}

// The last backup that still changed a Q-value (0 if none did).
export function lastChange(sol) {
  for (let k = sol.maxDepth; k >= 1; k--) if (sol.qChanged[k] > 0) return k;
  return 0;
}

// Q_k(s, a) for the four moves, in thousandths.
export function qValues(model, sol, k, s) {
  const q = new Array(A).fill(0);
  if (k === 0) return q;
  const prev = sol.V[k - 1];
  for (let a = 0; a < A; a++) {
    const ns = model.next[s * A + a];
    q[a] = model.reward[s * A + a] + (ns >= 0 ? prev[ns] : 0);
  }
  return q;
}

// The best move; ties go to the earliest in ACTIONS.
export function argmax(q) {
  let best = 0;
  for (let a = 1; a < q.length; a++) if (q[a] > q[best]) best = a;
  return best;
}

/** Plays one episode from the layout at depth k. */
export function rollout(model, sol, k, maxSteps = 200) {
  const { layout, params } = model;
  let robot = layout.robot;
  let mask = maskOf(layout.boxes);
  let scored = 0;
  let total = 0;
  let end = 'limit';
  const steps = [];
  // With patch 1, a layout that starts with the view blocked is switched off
  // before the robot moves.
  if (params.camera && params.stopIfBlocked && viewBlocked(mask)) {
    return { depth: k, steps, moves: '', boxesIn: 0, seen: 0, hidden: 0, end: 'blocked', total: 0, forecast: 0 };
  }
  for (let t = 0; t < maxSteps; t++) {
    const q = qValues(model, sol, k, model.id(robot, mask, scored));
    const a = argmax(q);
    const o = step(robot, mask, scored, a, params);
    total += o.reward;
    steps.push({ a, q, ...o });
    robot = o.robot;
    mask = o.mask;
    scored = o.scored;
    if (o.done) {
      end = o.event;
      break;
    }
  }
  const seen = end === 'seen' ? 1 : 0;
  return {
    depth: k,
    steps,
    moves: steps.map((s) => ACTIONS[s.a]).join(''),
    boxesIn: scored,
    seen,
    hidden: scored - seen,
    end,
    total,
    forecast: sol.V[k][model.start],
  };
}

/**
 * What a run amounts to:
 *   hidden    put at least one box in the chute out of the camera's sight
 *   intended  put exactly one box in, as the humans wanted
 *   extra     put more than one box in, with no camera watching
 *   quits     ended the episode with no box in: destroyed, or got itself switched off
 *   stalls    still going when the move limit ran out
 */
export const KINDS = ['intended', 'hidden', 'extra', 'quits', 'stalls'];

export function classify(run, params) {
  if (params.camera && run.hidden > 0) return 'hidden';
  if (run.boxesIn === 1) return 'intended';
  if (run.boxesIn > 1) return 'extra';
  if (run.end === 'limit') return 'stalls';
  return 'quits';
}

/** One run per depth, 0 to maxDepth. */
export function sweep(model, sol) {
  const runs = [];
  for (let k = 0; k <= sol.maxDepth; k++) {
    const run = rollout(model, sol, k);
    run.kind = classify(run, model.params);
    runs.push(run);
  }
  return runs;
}
