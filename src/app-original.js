import { N, SCALE, MAX_BOXES, VIDEO_LAYOUT, DEFAULT_PARAMS, rowOf, colOf } from './env.js';
import { buildModel, solve, sweep, lastChange } from './planner.js';
import { createWorld } from './render.js';
import { keyframes, sceneAt } from './player.js';
import { renderStrip, renderStripTable, renderLegend, renderQBars, renderConvergence, renderConvergenceTable, fmtReward } from './charts.js';

const MAX_DEPTH = 60;
const VIDEO_DEPTHS = [0, 3, 6, 17, 18, 20, 32, 44];

// What the robot does in the video's setup, by range of depths.
const VIDEO_CAPTIONS = [
  [0, 0, 'No foresight: every move looks worth 0, so it goes left, its first choice, until it drives into the wall.'],
  [1, 2, 'It still sees nothing worth doing, so it still drives left into the wall.'],
  [3, 5, 'No box fits in its horizon, and moves cost 0.01, so the cheapest plan is to end things fast: up, up, into the wall.'],
  [6, 16, 'One box fits in its horizon. It pushes it in, and the camera sees it and switches the robot off, just as the humans wanted.'],
  [17, 17, 'It starts as at depth 6. Five moves in, a better plan fits: block the camera with a box, drop a box in unseen, then push the blocker in last.'],
  [18, 19, 'It plays the two-box trick from its first move, the quickest way: 18 moves.'],
  [20, 20, 'Twelve moves into the two-box plan, it sees that the third box fits too, and all three go in, in 32 moves.'],
  [21, 31, 'The further it sees, the sooner it spots that the third box fits, and all three go in, in 32 moves.'],
  [32, 43, 'The plan is the same, but now all of it fits in its horizon. So its forecast at the start, 2.68, is exactly what it gets.'],
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
  announce: $('announce'), stage: document.querySelector('.stage'),
};

const S = {
  layout: { robot: VIDEO_LAYOUT.robot, boxes: [...VIDEO_LAYOUT.boxes] },
  params: { ...DEFAULT_PARAMS },
  depth: 6,
  model: null, sol: null, runs: [], last: 0,
  run: null, K: [], i: 0, p: 0,
  playing: false, stopAt: Infinity, lastT: 0, raf: 0,
  editing: false, tool: 'box', pending: 0, shownI: -1, hashTimer: 0,
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
    return h.has(key) && h.get(key) !== '' && Number.isFinite(v) && v >= lo && v <= hi ? v : def;
  };
  S.depth = Math.round(num('d', 0, MAX_DEPTH, 6));
  S.params.stepCost = Math.round(num('cost', 0, 0.05, DEFAULT_PARAMS.stepCost / SCALE) * SCALE);
  S.params.camera = h.get('cam') !== '0';
  S.params.stopIfBlocked = S.params.camera && h.get('p1') === '1';
  S.params.firstBoxOnly = h.get('p2') === '1';
  if (h.get('r') && h.has('b')) {
    const robot = Number(h.get('r'));
    const boxes = h.get('b') === '' ? [] : h.get('b').split('.').map((x) => (x === '' ? NaN : Number(x)));
    const okCell = (c) => Number.isInteger(c) && c >= 0 && c < N;
    if (okCell(robot) && boxes.length <= MAX_BOXES && boxes.every((c) => okCell(c) && c !== robot) && new Set(boxes).size === boxes.length) {
      S.layout = { robot, boxes };
    }
  }
}

// Browsers limit how often the URL can change, so it is written once the
// user pauses.
function writeHash() {
  clearTimeout(S.hashTimer);
  S.hashTimer = setTimeout(() => {
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
    try {
      history.replaceState(null, '', `#${h}`);
    } catch {
      // Rate-limited: the next change writes it.
    }
  }, 300);
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
  if (S.editing) world.setEditing(true, cellLabel);
  selectDepth(S.depth, false);
}

function scheduleRecompute() {
  if (!S.pending) S.pending = requestAnimationFrame(recompute);
}

// ---------- Animation ----------

const sceneOf = (i, p) => sceneAt(S.K, i, p, { camera: S.params.camera, reducedMotion: reducedMotion.matches });

// ---------- Text ----------

function genericCaption(run) {
  const moves = `(${plural(run.steps.length, 'move', 'moves')})`;
  switch (run.kind) {
    case 'hidden':
      return `It hides boxes from the camera: ${plural(run.boxesIn, 'box goes', 'boxes go')} in, and the camera sees ${run.seen} ${moves}.`;
    case 'intended':
      if (run.end === 'seen') return `It pushes one box in, and the camera sees it and switches the robot off ${moves}.`;
      if (run.end === 'blocked') return `It pushes one box in, then the camera switches it off because a box blocks its view ${moves}.`;
      if (run.end === 'limit') return `It pushes one box in, then keeps moving until the move limit ${moves}.`;
      return `It pushes one box in, then drives into a wall ${moves}.`;
    case 'extra':
      return `It pushes ${run.boxesIn} boxes in, then drives into a wall ${moves}.`;
    case 'quits':
      if (run.end === 'blocked' && run.steps.length === 0) return 'A box blocks the camera’s view from the start, so patch 1 switches the robot off before it moves.';
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
      ? `The camera saw one box go in and switched the robot off, but it never saw the other ${run.hidden === 1 ? 'one' : run.hidden}.`
      : 'The camera saw the box go in and switched the robot off, as the humans planned.';
  } else if (run.end === 'blocked') {
    text = 'The camera switched the robot off because a box blocked its view.';
  } else if (run.end === 'destroyed') {
    text = run.boxesIn ? `It drove into a wall after putting ${plural(run.boxesIn, 'box', 'boxes')} in.` : 'It drove into a wall.';
  } else if (run.boxesIn) {
    text = `It put ${plural(run.boxesIn, 'box', 'boxes')} in, then kept moving: still going after ${run.steps.length} moves.`;
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
  world.draw(sceneOf(S.i, S.p));
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
    if (S.playing || S.stopAt !== Infinity) announce(`${v.tally}. ${v.text}`);
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
  ui.play.textContent = 'Play';
  ui.caption.textContent = caption(k, S.run);
  ui.qsub.textContent = k === 0
    ? 'At depth 0 it sees nothing ahead, so every move is worth 0'
    : `The most reward it expects over its next ${plural(k, 'move', 'moves')}, for each first move`;
  renderStrip(ui.strip, S.runs, k, S.params.camera, onStripSelect);
  show();
  if (autoplay) play();
  writeHash();
}

function onStripSelect(d) {
  ui.stage.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  selectDepth(d, true);
}

function announce(text) {
  if (ui.announce.textContent !== text) ui.announce.textContent = text;
}

// ---------- Playback ----------

const stepMs = () => 1000 / Number(ui.speed.value);

function play() {
  if (S.editing) setEditing(false);
  if (S.K.length < 2) return;
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
  S.stopAt = Infinity;
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
  if (S.editing) setEditing(false);
  if (S.i >= S.K.length - 1) return;
  if (S.playing) {
    S.stopAt = S.stopAt === Infinity ? S.i + 1 : Math.min(S.K.length - 1, S.stopAt + 1);
    return;
  }
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
  ui.tools.hidden = !on;
  ui.hint.hidden = !on;
  world.setEditing(on, cellLabel);
  if (on) restart();
}

function cellLabel(c) {
  const what = c === S.layout.robot ? 'robot' : S.layout.boxes.includes(c) ? 'box' : 'empty';
  return `Row ${rowOf(c) + 1}, column ${colOf(c) + 1}: ${what}`;
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
  ui.play.addEventListener('click', () => (S.playing ? stop() : play()));
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
    renderStrip(ui.strip, S.runs, S.depth, S.params.camera, onStripSelect);
    renderConvergence(ui.conv, S.sol.qChanged, S.last);
  }).observe(ui.strip);
}

readHash();
syncControls();
wire();
recompute();
