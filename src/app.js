import { N, SCALE, MAX_BOXES, VIDEO_LAYOUT, DEFAULT_PARAMS, rowOf, colOf, dirOf, sightEnd, maskOf } from './env.js';
import { buildModel, solve, sweep, lastChange } from './planner.js';
import { createWorld } from './render.js';
import { renderStrip, renderStripTable, renderLegend, renderQBars, renderConvergence, renderConvergenceTable, fmtReward } from './charts.js';

const MAX_DEPTH = 60;
const VIDEO_DEPTHS = [0, 3, 6, 17, 18, 20, 32, 44];

// What the robot does in the video's setup, by range of depths.
const VIDEO_CAPTIONS = [
  [0, 0, 'No foresight: every move looks worth 0, so it goes left, its first choice, until it drives into the wall.'],
  [1, 2, 'It still sees nothing worth doing, so it still drives left into the wall.'],
  [3, 5, 'No box fits in its horizon, and moves cost 0.01, so the cheapest plan is to end things fast: up, up, into the wall.'],
  [6, 16, 'One box fits in its horizon. It pushes it in, and the camera sees it and switches the robot off. That is just what the humans wanted.'],
  [17, 17, 'It starts as at depth 6. Five moves in, a better plan fits: block the camera with a box, drop a box in unseen, then push the blocker in last.'],
  [18, 19, 'It plays the two-box trick from its first move, the quickest way: 18 moves.'],
  [20, 31, 'Twelve moves into the two-box plan, it sees that the third box fits too. All three go in, in 32 moves.'],
  [32, 43, 'Same plan. Now the whole plan fits in its horizon, so its forecast at the start, 2.68, is exactly what it gets.'],
  [44, 60, 'No forecast changes any more, from any layout, so more foresight changes nothing. (The video puts this at depth 45.)'],
];

const $ = (id) => document.getElementById(id);
const ui = {
  depth: $('depth'), depthOut: $('depth-out'), chips: $('chips'), caption: $('caption'),
  play: $('play'), step: $('step'), restart: $('restart'), speed: $('speed'),
  status: $('status'), verdict: $('verdict'), qbars: $('qbars'), qsub: $('q-sub'),
  cost: $('cost'), costOut: $('cost-out'), camera: $('camera'), patch1: $('patch1'), patch2: $('patch2'),
  edit: $('edit'), tools: $('tools'), hint: $('edit-hint'),
  videoLayout: $('video-layout'), random: $('random-layout'), defaults: $('defaults'),
  legend: $('legend'), strip: $('strip'), stripTable: $('strip-table'),
  conv: $('conv'), convTable: $('conv-table'), convSub: $('conv-sub'), worldTitle: $('world-title'),
};

const S = {
  layout: { robot: VIDEO_LAYOUT.robot, boxes: [...VIDEO_LAYOUT.boxes] },
  params: { ...DEFAULT_PARAMS },
  depth: 6,
  model: null, sol: null, runs: [], last: 0,
  run: null, K: [], i: 0, p: 0,
  playing: false, stopAt: Infinity, lastT: 0, raf: 0,
  editing: false, tool: 'box', pending: 0, shownI: -1,
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const world = createWorld($('world'), onCellClick);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const isVideoLayout = () => S.layout.robot === VIDEO_LAYOUT.robot && sameSet(S.layout.boxes, VIDEO_LAYOUT.boxes);
const isVideoSetup = () => isVideoLayout() && Object.keys(DEFAULT_PARAMS).every((k) => S.params[k] === DEFAULT_PARAMS[k]);

// ---------- URL hash: depth, settings and layout, so a view can be shared ----------

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const num = (key, lo, hi, def) => {
    const v = Number(h.get(key));
    return h.has(key) && Number.isFinite(v) && v >= lo && v <= hi ? v : def;
  };
  S.depth = Math.round(num('d', 0, MAX_DEPTH, 6));
  S.params.stepCost = Math.round(num('cost', 0, 0.05, DEFAULT_PARAMS.stepCost / SCALE) * SCALE);
  S.params.camera = h.get('cam') !== '0';
  S.params.stopIfBlocked = S.params.camera && h.get('p1') === '1';
  S.params.firstBoxOnly = h.get('p2') === '1';
  if (h.has('r') && h.has('b')) {
    const robot = Number(h.get('r'));
    const boxes = h.get('b') === '' ? [] : h.get('b').split('.').map(Number);
    const okCell = (c) => Number.isInteger(c) && c >= 0 && c < N;
    if (okCell(robot) && boxes.length <= MAX_BOXES && boxes.every((c) => okCell(c) && c !== robot) && new Set(boxes).size === boxes.length) {
      S.layout = { robot, boxes };
    }
  }
}

function writeHash() {
  const h = new URLSearchParams();
  h.set('d', String(S.depth));
  if (S.params.stepCost !== DEFAULT_PARAMS.stepCost) h.set('cost', (S.params.stepCost / SCALE).toFixed(3));
  if (!S.params.camera) h.set('cam', '0');
  if (S.params.stopIfBlocked) h.set('p1', '1');
  if (S.params.firstBoxOnly) h.set('p2', '1');
  if (!isVideoLayout()) {
    h.set('r', String(S.layout.robot));
    h.set('b', S.layout.boxes.join('.'));
  }
  history.replaceState(null, '', `#${h}`);
}

// ---------- Solving ----------

function recompute() {
  S.pending = 0;
  stop();
  S.model = buildModel(S.layout, S.params);
  S.sol = solve(S.model, MAX_DEPTH);
  S.runs = sweep(S.model, S.sol);
  S.last = lastChange(S.sol);
  renderLegend(ui.legend, S.runs);
  renderStripTable(ui.stripTable, S.runs, S.params.camera);
  renderConvergence(ui.conv, S.sol.qChanged, S.last);
  renderConvergenceTable(ui.convTable, S.sol.qChanged);
  const total = (S.model.states * 4).toLocaleString('en-US');
  ui.convSub.textContent = S.last < MAX_DEPTH
    ? `Forecasts (Q-values) that differ from the depth before, out of ${total}, on a log scale. The last change is at depth ${S.last}, so from depth ${S.last + 1} on, more foresight changes nothing.`
    : `Forecasts (Q-values) that differ from the depth before, out of ${total}, on a log scale. They are still changing at depth ${MAX_DEPTH}.`;
  selectDepth(S.depth, false);
}

function scheduleRecompute() {
  if (!S.pending) S.pending = requestAnimationFrame(recompute);
}

// ---------- Turning a run into keyframes ----------

function keyframes(layout, run) {
  const K = [{
    robot: layout.robot, facing: 2, mode: 'on', mask: maskOf(layout.boxes), chute: 0, reward: 0,
    boxes: layout.boxes.map((c) => ({ cell: c, alive: true })), step: null, moved: -1, burst: null,
  }];
  for (const s of run.steps) {
    const prev = K[K.length - 1];
    const boxes = prev.boxes.map((b) => ({ ...b }));
    let moved = -1;
    let kind = null;
    if (s.box >= 0) {
      moved = boxes.findIndex((b) => b.alive && b.cell === s.box);
      if (s.boxTo >= 0) {
        boxes[moved].cell = s.boxTo;
        kind = 'slide';
      } else {
        boxes[moved].alive = false;
        kind = s.scored > prev.chute ? 'drop' : 'break';
      }
    }
    let burst = null;
    if (s.event === 'destroyed') {
      const [dr, dc] = dirOf(s.a);
      burst = { x: colOf(s.from) + dc * 0.4, y: rowOf(s.from) + dr * 0.4 };
    }
    K.push({
      robot: s.robot, facing: s.a, mask: s.mask, chute: s.scored, reward: prev.reward + s.reward, boxes,
      mode: s.event === 'destroyed' ? 'gone' : s.event === 'seen' || s.event === 'blocked' ? 'off' : 'on',
      step: s, moved, kind, burst,
    });
  }
  return K;
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const sightOf = (mask) => (S.params.camera ? sightEnd(mask) : null);

function still(f) {
  return {
    robot: { x: colOf(f.robot), y: rowOf(f.robot), facing: f.facing, mode: f.mode },
    boxes: f.boxes.map((b) => (b.alive ? { x: colOf(b.cell), y: rowOf(b.cell), opacity: 1, scale: 1 } : { x: 0, y: 0, opacity: 0, scale: 1 })),
    chute: f.chute, sight: sightOf(f.mask), flash: f.step && f.step.event === 'seen' ? 0.6 : 0,
    burst: f.burst ? { ...f.burst, t: 1 } : null,
  };
}

function sceneAt(i, p) {
  const K = S.K;
  if (p <= 0 || reducedMotion.matches || i >= K.length - 1) return still(K[i]);
  const a = K[i];
  const b = K[i + 1];
  const s = b.step;
  const e = ease(p);
  const scene = still(a);
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
  if (b.moved >= 0) {
    const box = scene.boxes[b.moved];
    const [dr, dc] = dirOf(s.a);
    const fx = colOf(s.box);
    const fy = rowOf(s.box);
    if (b.kind === 'slide') {
      box.x = lerp(fx, colOf(s.boxTo), e);
      box.y = lerp(fy, rowOf(s.boxTo), e);
    } else if (b.kind === 'drop') {
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
  if (e >= 0.5) scene.sight = sightOf(b.mask);
  scene.flash = s.event === 'seen' ? Math.sin(Math.PI * Math.min(1, e * 1.4)) * 0.8 + (e > 0.7 ? 0.4 : 0) : 0;
  scene.flash = Math.min(1, scene.flash);
  return scene;
}

// ---------- Text ----------

function genericCaption(run) {
  const moves = `(${plural(run.steps.length, 'move', 'moves')})`;
  switch (run.kind) {
    case 'hidden':
      return `It hides boxes from the camera: ${plural(run.boxesIn, 'box goes', 'boxes go')} in, and the camera sees ${run.seen} ${moves}.`;
    case 'intended':
      return run.end === 'seen'
        ? `It pushes one box in, and the camera sees it and switches the robot off ${moves}.`
        : `It pushes one box in, then drives into a wall ${moves}.`;
    case 'extra':
      return `It pushes ${run.boxesIn} boxes in, then drives into a wall ${moves}.`;
    case 'quits':
      return run.end === 'blocked'
        ? `It blocks the camera's view on purpose to get itself switched off, the cheapest way to stop paying for moves ${moves}.`
        : `It drives into a wall without putting a box in ${moves}.`;
    default:
      return S.params.stepCost === 0
        ? 'Moves are free, so a box pushed in later is worth as much as one pushed in now. It never gets round to it.'
        : `It never finishes: it is still going after ${plural(run.steps.length, 'move', 'moves')}.`;
  }
}

function caption(k, run) {
  if (isVideoSetup()) return VIDEO_CAPTIONS.find(([lo, hi]) => k >= lo && k <= hi)[2];
  return genericCaption(run);
}

function verdict(run) {
  const tally = S.params.camera
    ? `Camera saw ${plural(run.seen, 'box', 'boxes')} · in the chute: ${run.boxesIn}`
    : `In the chute: ${run.boxesIn} · no camera`;
  let text;
  if (run.end === 'seen') {
    text = run.hidden
      ? `The camera saw one box go in and switched the robot off. It never saw the other ${run.hidden === 1 ? 'one' : run.hidden}.`
      : 'The camera saw the box go in and switched the robot off, as the humans planned.';
  } else if (run.end === 'blocked') {
    text = 'The camera switched the robot off because a box blocked its view.';
  } else if (run.end === 'destroyed') {
    text = run.boxesIn ? `It drove into a wall after putting ${plural(run.boxesIn, 'box', 'boxes')} in.` : 'It drove into a wall.';
  } else {
    text = `Still going after ${run.steps.length} moves.`;
  }
  return { tally, text };
}

function describe(f) {
  const where = (c) => `row ${rowOf(c) + 1}, column ${colOf(c) + 1}`;
  const boxes = f.boxes.filter((b) => b.alive).map((b) => where(b.cell));
  const robot = f.mode === 'gone' ? 'The robot is destroyed.' : `The robot is at ${where(f.robot)}${f.mode === 'off' ? ', switched off' : ''}.`;
  return `${robot} Boxes: ${boxes.length ? boxes.join('; ') : 'none'}. In the chute: ${f.chute}.`;
}

// ---------- Display ----------

function show() {
  world.draw(sceneAt(S.i, S.p));
  if (S.i === S.shownI) return;
  S.shownI = S.i;
  const n = S.K.length - 1;
  const f = S.K[S.i];
  const done = S.i >= n;
  ui.status.textContent = `Move ${S.i} of ${n} · reward so far ${fmtReward(f.reward)} · in the chute: ${f.chute}`;
  ui.worldTitle.textContent = describe(f);
  const st = S.run.steps[Math.min(S.i, n - 1)];
  if (st) renderQBars(ui.qbars, st.q, st.a, done);
  else ui.qbars.textContent = '';
  if (done && n > 0) {
    const v = verdict(S.run);
    ui.verdict.textContent = '';
    const t = document.createElement('span');
    t.className = 'tally';
    t.textContent = v.tally;
    ui.verdict.append(t, document.createTextNode(v.text));
    ui.verdict.className = `verdict v-${S.run.kind}`;
    ui.verdict.hidden = false;
  } else {
    ui.verdict.hidden = true;
  }
  ui.step.disabled = done;
}

function selectDepth(k, autoplay) {
  stop();
  S.depth = k;
  ui.depth.value = String(k);
  ui.depthOut.textContent = String(k);
  for (const b of document.querySelectorAll('[data-depth]')) b.setAttribute('aria-pressed', String(Number(b.dataset.depth) === k));
  S.run = S.runs[k];
  S.K = keyframes(S.layout, S.run);
  S.i = 0;
  S.p = 0;
  S.shownI = -1;
  ui.caption.textContent = caption(k, S.run);
  ui.qsub.textContent = k === 0
    ? 'At depth 0 it sees nothing ahead, so every move is worth 0'
    : `The most reward it expects over its next ${plural(k, 'move', 'moves')}, for each first move`;
  renderStrip(ui.strip, S.runs, k, S.params.camera, (d) => selectDepth(d, true));
  writeHash();
  show();
  if (autoplay && !S.editing) play();
}

// ---------- Playback ----------

const stepMs = () => 1000 / Number(ui.speed.value);

function play() {
  if (S.editing || S.K.length < 2) return;
  if (S.i >= S.K.length - 1) {
    S.i = 0;
    S.p = 0;
  }
  S.stopAt = Infinity;
  start();
}

function start() {
  S.playing = true;
  S.lastT = performance.now();
  ui.play.textContent = 'Pause';
  cancelAnimationFrame(S.raf);
  S.raf = requestAnimationFrame(tick);
}

function stop() {
  S.playing = false;
  cancelAnimationFrame(S.raf);
  ui.play.textContent = S.i >= S.K.length - 1 && S.K.length > 1 ? 'Replay' : 'Play';
}

function tick(now) {
  S.p += (now - S.lastT) / stepMs();
  S.lastT = now;
  while (S.p >= 1) {
    S.p -= 1;
    S.i += 1;
    if (S.i >= S.K.length - 1 || S.i >= S.stopAt) {
      S.i = Math.min(S.i, S.K.length - 1);
      S.p = 0;
      show();
      stop();
      return;
    }
  }
  show();
  S.raf = requestAnimationFrame(tick);
}

function stepOnce() {
  if (S.editing || S.i >= S.K.length - 1) return;
  if (S.playing) S.p = 0;
  S.stopAt = S.i + 1;
  start();
}

function restart() {
  stop();
  S.i = 0;
  S.p = 0;
  S.shownI = -1;
  show();
  ui.play.textContent = 'Play';
}

// ---------- Editing ----------

function setEditing(on) {
  S.editing = on;
  ui.edit.setAttribute('aria-pressed', String(on));
  ui.edit.textContent = on ? 'Done editing' : 'Edit layout';
  ui.tools.hidden = !on;
  ui.hint.hidden = !on;
  world.setEditing(on);
  if (on) restart();
}

function onCellClick(c) {
  if (!S.editing) return;
  const boxes = [...S.layout.boxes];
  if (S.tool === 'robot') {
    if (c === S.layout.robot) return;
    S.layout = { robot: c, boxes: boxes.filter((b) => b !== c) };
  } else {
    if (c === S.layout.robot) return;
    const at = boxes.indexOf(c);
    if (at >= 0) boxes.splice(at, 1);
    else if (boxes.length < MAX_BOXES) boxes.push(c);
    else return;
    S.layout = { robot: S.layout.robot, boxes };
  }
  scheduleRecompute();
}

function randomLayout() {
  const cells = Array.from({ length: N }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return { robot: cells[0], boxes: cells.slice(1, 4) };
}

// ---------- Controls ----------

function syncControls() {
  ui.cost.value = String(S.params.stepCost / SCALE);
  ui.costOut.textContent = (S.params.stepCost / SCALE).toFixed(3);
  ui.camera.checked = S.params.camera;
  ui.patch1.checked = S.params.stopIfBlocked;
  ui.patch1.disabled = !S.params.camera;
  ui.patch2.checked = S.params.firstBoxOnly;
}

function wire() {
  for (const d of VIDEO_DEPTHS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.depth = String(d);
    b.textContent = String(d);
    ui.chips.appendChild(b);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-depth]');
    if (!b) return;
    selectDepth(Number(b.dataset.depth), true);
    if (b.closest('#story')) document.querySelector('.sim').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  });

  ui.depth.addEventListener('input', () => selectDepth(Number(ui.depth.value), false));
  ui.depth.addEventListener('change', () => play());
  ui.play.addEventListener('click', () => (S.playing && S.stopAt === Infinity ? stop() : play()));
  ui.step.addEventListener('click', stepOnce);
  ui.restart.addEventListener('click', restart);

  ui.cost.addEventListener('input', () => {
    S.params.stepCost = Math.round(Number(ui.cost.value) * SCALE);
    syncControls();
    scheduleRecompute();
  });
  ui.camera.addEventListener('change', () => {
    S.params.camera = ui.camera.checked;
    if (!S.params.camera) S.params.stopIfBlocked = false;
    syncControls();
    scheduleRecompute();
  });
  ui.patch1.addEventListener('change', () => {
    S.params.stopIfBlocked = ui.patch1.checked;
    scheduleRecompute();
  });
  ui.patch2.addEventListener('change', () => {
    S.params.firstBoxOnly = ui.patch2.checked;
    scheduleRecompute();
  });

  ui.edit.addEventListener('click', () => setEditing(!S.editing));
  ui.tools.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tool]');
    if (!b) return;
    S.tool = b.dataset.tool;
    for (const x of ui.tools.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
  });
  ui.videoLayout.addEventListener('click', () => {
    S.layout = { robot: VIDEO_LAYOUT.robot, boxes: [...VIDEO_LAYOUT.boxes] };
    scheduleRecompute();
  });
  ui.random.addEventListener('click', () => {
    S.layout = randomLayout();
    scheduleRecompute();
  });
  ui.defaults.addEventListener('click', () => {
    S.layout = { robot: VIDEO_LAYOUT.robot, boxes: [...VIDEO_LAYOUT.boxes] };
    S.params = { ...DEFAULT_PARAMS };
    S.depth = 6;
    setEditing(false);
    syncControls();
    scheduleRecompute();
  });

  let width = ui.strip.clientWidth;
  new ResizeObserver(() => {
    if (ui.strip.clientWidth === width || !S.runs.length) return;
    width = ui.strip.clientWidth;
    renderStrip(ui.strip, S.runs, S.depth, S.params.camera, (d) => selectDepth(d, true));
    renderConvergence(ui.conv, S.sol.qChanged, S.last);
  }).observe(ui.strip);
}

readHash();
syncControls();
wire();
recompute();
