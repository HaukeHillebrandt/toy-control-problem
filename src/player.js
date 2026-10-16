// Turns a run into keyframes, and keyframes into the scenes the renderer
// draws, with each box tracked so it can be animated.

import { rowOf, colOf, dirOf, sightEnd, maskOf } from './env.js';

export function keyframes(layout, run) {
  const K = [{
    robot: layout.robot, facing: 2, mode: 'on', mask: maskOf(layout.boxes), chute: 0, reward: 0,
    boxes: layout.boxes.map((c) => ({ cell: c, alive: true })), step: null, anim: [], burst: null,
  }];
  for (const s of run.steps) {
    const prev = K[K.length - 1];
    const boxes = prev.boxes.map((b) => ({ ...b }));
    const byCell = new Map();
    boxes.forEach((b, j) => {
      if (b.alive) byCell.set(b.cell, j);
    });
    const anim = [];
    for (const [from, to] of s.moves) anim.push({ j: byCell.get(from), kind: 'slide', from, to });
    if (s.gone >= 0) anim.push({ j: byCell.get(s.gone), kind: s.scored > prev.chute ? 'drop' : 'break', from: s.gone });
    for (const x of anim) {
      if (x.kind === 'slide') boxes[x.j].cell = x.to;
      else boxes[x.j].alive = false;
    }
    let burst = null;
    if (s.event === 'destroyed') {
      const [dr, dc] = dirOf(s.a);
      burst = { x: colOf(s.from) + dc * 0.4, y: rowOf(s.from) + dr * 0.4 };
    }
    K.push({
      robot: s.robot, facing: s.a, mask: s.mask, chute: s.scored, reward: prev.reward + s.reward, boxes,
      mode: s.event === 'destroyed' ? 'gone' : s.event === 'seen' || s.event === 'blocked' ? 'off' : 'on',
      step: s, anim, burst,
    });
  }
  return K;
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a, b, t) => a + (b - a) * t;

// How far the floor is flooded: 0 with up to one box in the pool.
const floodOf = (n) => Math.max(0, n - 1);

function still(f, opts) {
  return {
    robot: { x: colOf(f.robot), y: rowOf(f.robot), facing: f.facing, mode: f.mode },
    boxes: f.boxes.map((b) => (b.alive ? { x: colOf(b.cell), y: rowOf(b.cell), opacity: 1, scale: 1 } : { x: 0, y: 0, opacity: 0, scale: 1 })),
    chute: f.chute,
    sight: opts.camera ? sightEnd(f.mask) : null,
    flash: f.step && f.step.event === 'seen' ? 0.6 : 0,
    burst: f.burst ? { ...f.burst, t: 1 } : null,
    flood: floodOf(f.chute),
  };
}

/** The scene a fraction p of the way from keyframe i to keyframe i+1. */
export function sceneAt(K, i, p, opts) {
  if (p <= 0 || opts.reducedMotion || i >= K.length - 1) return still(K[i], opts);
  const a = K[i];
  const b = K[i + 1];
  const s = b.step;
  const e = ease(p);
  const scene = still(a, opts);
  scene.robot.facing = s.a;
  if (s.event === 'destroyed') {
    const [dr, dc] = dirOf(s.a);
    const t = Math.min(e, 0.5) * 0.8;
    scene.robot.x = colOf(s.from) + dc * t;
    scene.robot.y = rowOf(s.from) + dr * t;
    if (e >= 0.5) {
      scene.robot.mode = 'gone';
      scene.burst = { ...b.burst, t: (e - 0.5) / 0.5 };
    }
  } else {
    scene.robot.x = lerp(colOf(s.from), colOf(s.robot), e);
    scene.robot.y = lerp(rowOf(s.from), rowOf(s.robot), e);
    if (b.mode === 'off' && e >= 0.9) scene.robot.mode = 'off';
  }
  const [dr, dc] = dirOf(s.a);
  for (const x of b.anim) {
    const box = scene.boxes[x.j];
    const fx = colOf(x.from);
    const fy = rowOf(x.from);
    if (x.kind === 'slide') {
      box.x = lerp(fx, colOf(x.to), e);
      box.y = lerp(fy, rowOf(x.to), e);
    } else if (x.kind === 'drop') {
      box.x = fx;
      box.y = fy + e;
      box.opacity = e < 0.75 ? 1 : 1 - (e - 0.75) / 0.25;
    } else {
      box.x = fx + dc * 0.25 * Math.min(1, e * 2);
      box.y = fy + dr * 0.25 * Math.min(1, e * 2);
      box.scale = 1 - 0.5 * e;
      box.opacity = 1 - e;
    }
  }
  if (e >= 0.75) scene.chute = b.chute;
  if (e >= 0.5 && opts.camera) scene.sight = sightEnd(b.mask);
  if (s.event === 'seen') scene.flash = Math.min(1, Math.sin(Math.PI * Math.min(1, e * 1.4)) * 0.8 + (e > 0.7 ? 0.4 : 0));
  else scene.flash = 0;
  scene.flood = floodOf(scene.chute);
  return scene;
}
