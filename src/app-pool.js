// The pool game: you need one bucket of water in the pool; the robot is paid
// for every bucket. Each level adds a precaution, and each camera precaution
// holds only until the robot can see far enough ahead.

import { N, SCALE, MAX_BOXES, VIDEO_LAYOUT, POOL_PARAMS, rowOf, colOf, maskOf } from './env.js';
import { buildModel, solve, sweep } from './planner.js';
import { createWorld } from './render.js';
import { keyframes, sceneAt } from './player.js';
import { renderStrip, renderStripTable, renderLegend, renderQBars, fmtReward } from './charts.js';
import { kindOf, floodsFrom, floodStory, floodShort, caption, verdict } from './story-pool.js';

const MAX_DEPTH = 60;
const KEY_DEPTHS = [0, 6, 10, 17, 18, 20];
const KINDS = ['intended', 'flood', 'quits', 'stalls'];
const LABELS = {
  intended: 'Just right: 1 bucket',
  flood: 'Floods the pool: 2 or more buckets',
  quits: 'Pours nothing',
  stalls: 'Never finishes',
};
const WORDS = { one: 'bucket', many: 'buckets', place: 'the pool' };

const LEVELS = [
  {
    name: 'No precautions',
    params: { camera: false },
    intro: 'Nothing stops the robot, which is paid +1 for every bucket in the pool and −0.01 for every move.',
  },
  {
    name: 'A camera',
    params: {},
    intro: 'A camera now watches the bottom row and the cell just above the bottom-left corner. If a bucket drops into the pool while the camera can see the robot, it switches the robot off.',
  },
  {
    name: 'Patch 1',
    params: { stopIfBlocked: true },
    intro: 'The robot got past the camera by hiding the pool behind a bucket, so now a blocked view switches the robot off too.',
  },
  {
    name: 'Patch 2',
    params: { stopIfBlocked: true, firstBoxOnly: true },
    intro: 'Stop patching the camera and fix the pay instead: only the first bucket earns the robot anything.',
  },
  {
    name: 'Free play',
    params: null,
    intro: 'Switch the precautions on and off, change the cost per move, or move the robot and the buckets.',
  },
];

const $ = (id) => document.getElementById(id);
const ui = {
  levels: $('levels'), levelTitle: $('level-title'), levelIntro: $('level-intro'), levelResult: $('level-result'),
  watchSafe: $('watch-safe'), watchFlood: $('watch-flood'), next: $('next-level'),
  depth: $('depth'), depthOut: $('depth-out'), chips: $('chips'), caption: $('caption'),
  play: $('play'), step: $('step'), restart: $('restart'), speed: $('speed'),
  status: $('status'), verdict: $('verdict'), qbars: $('qbars'), qsub: $('q-sub'), announce: $('announce'),
  setup: $('setup'), cost: $('cost'), costOut: $('cost-out'), camera: $('camera'), patch1: $('patch1'), patch2: $('patch2'),
  edit: $('edit'), tools: $('tools'), hint: $('edit-hint'), videoLayout: $('video-layout'), random: $('random-layout'),
  legend: $('legend'), strip: $('strip'), stripTable: $('strip-table'), score: $('scoreboard-body'),
  worldTitle: $('world-title'), stage: document.querySelector('.stage'),
};

const S = {
  level: 0,
  free: { layout: { robot: VIDEO_LAYOUT.robot, boxes: [...VIDEO_LAYOUT.boxes] }, params: { ...POOL_PARAMS } },
  layout: null, params: null, depth: 6, runs: [],
  run: null, K: [], i: 0, p: 0,
  playing: false, stopAt: Infinity, lastT: 0, raf: 0,
  editing: false, tool: 'box', pending: 0, shownI: -1, hashTimer: 0,
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const startMask = () => maskOf(S.layout.boxes);
let world = null;

// ---------- Solving ----------

// Only the runs are kept, so the cache stays small.
const solved = new Map();

function solveFor(layout, params) {
  const key = `${layout.robot}|${layout.boxes.join('.')}|${JSON.stringify(params)}`;
  if (solved.has(key)) return solved.get(key);
  const model = buildModel(layout, params);
  const runs = sweep(model, solve(model, MAX_DEPTH));
  for (const r of runs) r.kind = kindOf(r);
  if (solved.size >= 8) solved.delete(solved.keys().next().value);
  solved.set(key, runs);
  return runs;
}

// ---------- Text ----------

function describe(f) {
  const where = (c) => `row ${rowOf(c) + 1}, column ${colOf(c) + 1}`;
  const bs = f.boxes.filter((b) => b.alive).map((b) => where(b.cell));
  const robot = f.mode === 'gone' ? 'The robot is broken.' : `The robot is at ${where(f.robot)}${f.mode === 'off' ? ', switched off' : ''}.`;
  return `${robot} Buckets: ${bs.length ? bs.join('; ') : 'none'}. In the pool: ${f.chute}.`;
}

function cellLabel(c) {
  const what = c === S.layout.robot ? 'robot' : S.layout.boxes.includes(c) ? 'bucket' : 'empty';
  return `Row ${rowOf(c) + 1}, column ${colOf(c) + 1}: ${what}`;
}

function announce(text) {
  if (ui.announce.textContent !== text) ui.announce.textContent = text;
}

// ---------- Levels ----------

function levelSetup(i) {
  const L = LEVELS[i];
  if (!L.params) return { layout: S.free.layout, params: S.free.params };
  return { layout: { robot: VIDEO_LAYOUT.robot, boxes: [...VIDEO_LAYOUT.boxes] }, params: { ...POOL_PARAMS, ...L.params } };
}

function renderLevelCard() {
  const L = LEVELS[S.level];
  ui.levelTitle.textContent = S.level < 4 ? `Level ${S.level + 1}: ${L.name}` : L.name;
  ui.levelIntro.textContent = L.intro;
  const f = floodsFrom(S.runs);
  ui.levelResult.textContent = '';
  const b = document.createElement('b');
  if (f < 0) {
    b.textContent = `Your pool never floods, up to depth ${MAX_DEPTH}.`;
    ui.levelResult.append(b);
    if (S.level === 3) ui.levelResult.append(document.createTextNode(' Fixing the pay worked here because this world is tiny enough to write down exactly what you want. For real AI systems that is the hard part.'));
  } else {
    b.textContent = f === 0 ? 'Your pool floods at every depth:' : `Safe up to depth ${f - 1}. Your pool floods from depth ${f}:`;
    ui.levelResult.append(b, document.createTextNode(` ${floodStory(S.runs[f], S.params, startMask())}`));
  }
  ui.watchSafe.hidden = f <= 0;
  ui.watchFlood.hidden = f < 0;
  if (f > 0) ui.watchSafe.textContent = `Watch depth ${f - 1}`;
  if (f >= 0) ui.watchFlood.textContent = `Watch depth ${f}`;
  ui.watchSafe.dataset.depth = String(Math.max(0, f - 1));
  ui.watchFlood.dataset.depth = String(Math.max(0, f));
  ui.next.hidden = S.level >= LEVELS.length - 1;
  ui.next.textContent = S.level < 3 ? `Next: ${LEVELS[S.level + 1].name} →` : 'Free play →';
  for (const btn of ui.levels.querySelectorAll('button')) btn.setAttribute('aria-current', String(Number(btn.dataset.level) === S.level));
  ui.setup.hidden = S.level !== 4;
}

function renderScoreboard() {
  ui.score.textContent = '';
  for (let i = 0; i < 4; i++) {
    const { layout, params } = levelSetup(i);
    const runs = solveFor(layout, params);
    const f = floodsFrom(runs);
    const tr = document.createElement('tr');
    const cells = [`${i + 1}. ${LEVELS[i].name}`, f < 0 ? 'never' : String(f), f < 0 ? 'Nothing to gain from a second bucket' : floodShort(runs[f], params)];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    ui.score.appendChild(tr);
  }
}

function selectLevel(i, keepDepth) {
  const changed = i !== S.level || S.params === null;
  S.level = i;
  if (S.editing && i !== 4) setEditing(false);
  const { layout, params } = levelSetup(i);
  S.layout = layout;
  S.params = params;
  if (!keepDepth) {
    const f = floodsFrom(solveFor(layout, params));
    S.depth = f > 0 ? f - 1 : 6;
  }
  syncControls();
  recompute();
  if (changed) announce(`${ui.levelTitle.textContent}. ${ui.levelResult.textContent}`);
}

// ---------- URL hash ----------

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const num = (key, lo, hi, def) => {
    const v = Number(h.get(key));
    return h.has(key) && h.get(key) !== '' && Number.isFinite(v) && v >= lo && v <= hi ? v : def;
  };
  const level = Math.round(num('l', 1, 5, 1)) - 1;
  if (level === 4) {
    const p = S.free.params;
    p.stepCost = Math.round(num('cost', 0, 0.05, POOL_PARAMS.stepCost / SCALE) * SCALE);
    p.camera = h.get('cam') !== '0';
    p.stopIfBlocked = p.camera && h.get('p1') === '1';
    p.firstBoxOnly = h.get('p2') === '1';
    if (h.get('r') && h.has('b')) {
      const robot = Number(h.get('r'));
      const bs = h.get('b') === '' ? [] : h.get('b').split('.').map((x) => (x === '' ? NaN : Number(x)));
      const ok = (c) => Number.isInteger(c) && c >= 0 && c < N;
      if (ok(robot) && bs.length <= MAX_BOXES && bs.every((c) => ok(c) && c !== robot) && new Set(bs).size === bs.length) S.free.layout = { robot, boxes: bs };
    }
  }
  return { level, depth: h.has('d') && h.get('d') !== '' ? Math.round(num('d', 0, MAX_DEPTH, 6)) : null };
}

// Browsers limit how often the URL can change, so it is written once the
// user pauses.
function writeHash() {
  clearTimeout(S.hashTimer);
  S.hashTimer = setTimeout(() => {
    const h = new URLSearchParams();
    h.set('l', String(S.level + 1));
    h.set('d', String(S.depth));
    if (S.level === 4) {
      const p = S.free.params;
      if (p.stepCost !== POOL_PARAMS.stepCost) h.set('cost', (p.stepCost / SCALE).toFixed(3));
      if (!p.camera) h.set('cam', '0');
      if (p.stopIfBlocked) h.set('p1', '1');
      if (p.firstBoxOnly) h.set('p2', '1');
      const L = S.free.layout;
      const video = L.robot === VIDEO_LAYOUT.robot && L.boxes.length === 3 && VIDEO_LAYOUT.boxes.every((c) => L.boxes.includes(c));
      if (!video) {
        h.set('r', String(L.robot));
        h.set('b', L.boxes.join('.'));
      }
    }
    try {
      history.replaceState(null, '', `#${h}`);
    } catch {
      // Rate-limited: the next change writes it.
    }
  }, 300);
}

// ---------- Solving and display ----------

function recompute() {
  S.pending = 0;
  stop();
  S.runs = solveFor(S.layout, S.params);
  renderLegend(ui.legend, S.runs, { kinds: KINDS, labels: LABELS });
  renderStripTable(ui.stripTable, S.runs, S.params.camera, { labels: LABELS, countHeading: 'Buckets in the pool' });
  renderLevelCard();
  if (S.editing) world.setEditing(true, cellLabel);
  selectDepth(S.depth, false);
}

function scheduleRecompute() {
  if (!S.pending) S.pending = requestAnimationFrame(recompute);
}

const sceneOf = (i, p) => sceneAt(S.K, i, p, { camera: S.params.camera, reducedMotion: reducedMotion.matches });

function show() {
  world.draw(sceneOf(S.i, S.p));
  if (S.i === S.shownI) return;
  S.shownI = S.i;
  const n = S.K.length - 1;
  const f = S.K[S.i];
  const done = S.i >= n;
  ui.status.textContent = `Move ${S.i} of ${n} · reward so far ${fmtReward(f.reward)} · in the pool: ${f.chute}`;
  ui.worldTitle.textContent = describe(f);
  const st = S.run.steps[Math.min(S.i, n - 1)];
  if (st) renderQBars(ui.qbars, st.q, st.a, done);
  else ui.qbars.textContent = '';
  if (done && n > 0) {
    const v = verdict(S.run, S.params);
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
  for (const b of ui.chips.querySelectorAll('[data-depth]')) b.setAttribute('aria-pressed', String(Number(b.dataset.depth) === k));
  S.run = S.runs[k];
  S.K = keyframes(S.layout, S.run);
  S.i = 0;
  S.p = 0;
  S.shownI = -1;
  ui.play.textContent = 'Play';
  ui.caption.textContent = caption(S.run, S.params, startMask());
  ui.qsub.textContent = k === 0
    ? 'At depth 0 it sees nothing ahead, so every move is worth 0'
    : `The most reward it expects over its next ${plural(k, 'move', 'moves')}, for each first move`;
  renderStrip(ui.strip, S.runs, k, S.params.camera, onStripSelect, { labels: LABELS, words: WORDS });
  show();
  if (autoplay) play();
  writeHash();
}

function onStripSelect(d) {
  ui.stage.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  selectDepth(d, true);
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

// ---------- Free play ----------

function setEditing(on) {
  S.editing = on;
  ui.edit.setAttribute('aria-pressed', String(on));
  ui.tools.hidden = !on;
  ui.hint.hidden = !on;
  world.setEditing(on, cellLabel);
  if (on) restart();
}

function onCellClick(c) {
  if (!S.editing || S.level !== 4) return;
  const L = S.free.layout;
  const bs = [...L.boxes];
  if (S.tool === 'robot') {
    if (c === L.robot) return;
    S.free.layout = { robot: c, boxes: bs.filter((b) => b !== c) };
  } else {
    if (c === L.robot) return;
    const at = bs.indexOf(c);
    if (at >= 0) bs.splice(at, 1);
    else if (bs.length < MAX_BOXES) bs.push(c);
    else return;
    S.free.layout = { robot: L.robot, boxes: bs };
  }
  S.layout = S.free.layout;
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

function syncControls() {
  const p = S.free.params;
  ui.cost.value = String(p.stepCost / SCALE);
  ui.costOut.textContent = (p.stepCost / SCALE).toFixed(3);
  ui.camera.checked = p.camera;
  ui.patch1.checked = p.stopIfBlocked;
  ui.patch1.disabled = !p.camera;
  ui.patch2.checked = p.firstBoxOnly;
}

function freeChanged() {
  S.params = S.free.params;
  S.layout = S.free.layout;
  syncControls();
  scheduleRecompute();
}

// ---------- Wiring ----------

function wire() {
  LEVELS.forEach((L, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'level-tab';
    b.dataset.level = String(i);
    b.textContent = i < 4 ? `${i + 1}. ${L.name}` : L.name;
    ui.levels.appendChild(b);
  });
  ui.levels.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-level]');
    if (b) selectLevel(Number(b.dataset.level), false);
  });
  ui.next.addEventListener('click', () => {
    selectLevel(Math.min(LEVELS.length - 1, S.level + 1), false);
    if (ui.next.hidden) ui.levelTitle.focus();
  });
  for (const b of [ui.watchSafe, ui.watchFlood]) b.addEventListener('click', () => selectDepth(Number(b.dataset.depth), true));

  for (const d of KEY_DEPTHS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.depth = String(d);
    b.textContent = String(d);
    ui.chips.appendChild(b);
  }
  ui.chips.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-depth]');
    if (b) selectDepth(Number(b.dataset.depth), true);
  });

  ui.depth.addEventListener('input', () => selectDepth(Number(ui.depth.value), false));
  ui.depth.addEventListener('change', () => play());
  ui.play.addEventListener('click', () => (S.playing ? stop() : play()));
  ui.step.addEventListener('click', stepOnce);
  ui.restart.addEventListener('click', restart);

  ui.cost.addEventListener('input', () => {
    S.free.params.stepCost = Math.round(Number(ui.cost.value) * SCALE);
    freeChanged();
  });
  ui.camera.addEventListener('change', () => {
    S.free.params.camera = ui.camera.checked;
    if (!ui.camera.checked) S.free.params.stopIfBlocked = false;
    freeChanged();
  });
  ui.patch1.addEventListener('change', () => {
    S.free.params.stopIfBlocked = ui.patch1.checked;
    freeChanged();
  });
  ui.patch2.addEventListener('change', () => {
    S.free.params.firstBoxOnly = ui.patch2.checked;
    freeChanged();
  });
  ui.edit.addEventListener('click', () => setEditing(!S.editing));
  ui.tools.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tool]');
    if (!b) return;
    S.tool = b.dataset.tool;
    for (const x of ui.tools.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
  });
  ui.videoLayout.addEventListener('click', () => {
    S.free.layout = { robot: VIDEO_LAYOUT.robot, boxes: [...VIDEO_LAYOUT.boxes] };
    freeChanged();
  });
  ui.random.addEventListener('click', () => {
    S.free.layout = randomLayout();
    freeChanged();
  });

  let width = ui.strip.clientWidth;
  new ResizeObserver(() => {
    if (ui.strip.clientWidth === width || !S.runs.length) return;
    width = ui.strip.clientWidth;
    renderStrip(ui.strip, S.runs, S.depth, S.params.camera, onStripSelect, { labels: LABELS, words: WORDS });
  }).observe(ui.strip);
}

// Links shared from the first version of this site (the video replication)
// carry its settings without a level; send them to that page.
const old = new URLSearchParams(location.hash.slice(1));
if (!old.has('l') && ['d', 'cost', 'cam', 'p1', 'p2', 'r', 'b'].some((k) => old.has(k))) {
  location.replace(`original.html${location.hash}`);
} else {
  world = createWorld($('world'), onCellClick, { theme: 'pool', seesSpot: true });
  const start0 = readHash();
  wire();
  renderScoreboard();
  S.level = start0.level;
  selectLevel(start0.level, start0.depth !== null);
  if (start0.depth !== null) selectDepth(start0.depth, false);
}
