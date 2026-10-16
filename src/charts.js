// Small charts: the outcome strip by depth, the robot's forecast bars and the
// convergence columns. Each has a hover tooltip and a table view.

import { ACTION_NAMES, SCALE } from './env.js';
import { KINDS } from './planner.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function html(tag, className, parent, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export const KIND_LABELS = {
  intended: 'Does what the humans wanted: 1 box',
  hidden: 'Hides boxes from the camera',
  extra: 'Puts in more than 1 box (no camera)',
  quits: 'Ends with no box in',
  stalls: 'Never finishes',
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function fmtReward(v) {
  const x = v / SCALE;
  if (x === 0) return '0.00';
  return (x > 0 ? '+' : '−') + Math.abs(x).toFixed(2);
}

function tooltip(host) {
  const tip = html('div', 'tooltip', host);
  tip.hidden = true;
  const strong = html('strong', '', tip);
  const span = html('span', '', tip);
  return {
    show(x, y, main, detail) {
      strong.textContent = main;
      span.textContent = detail;
      tip.hidden = false;
      const w = tip.offsetWidth;
      const left = Math.max(0, Math.min(host.clientWidth - w, x - w / 2));
      tip.style.transform = `translate(${left}px, ${y - tip.offsetHeight - 8}px)`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

export function renderLegend(host, runs, { kinds = KINDS, labels = KIND_LABELS } = {}) {
  host.textContent = '';
  const present = new Set(runs.map((r) => r.kind));
  for (const k of kinds) {
    if (!present.has(k)) continue;
    const item = html('span', '', host);
    html('span', `sw kind-${k}`, item);
    item.appendChild(document.createTextNode(labels[k]));
  }
}

function runDetail(run, camera, words = { one: 'box', many: 'boxes', place: 'the chute' }) {
  const seen = camera ? `, camera saw ${run.seen}` : '';
  return `${plural(run.boxesIn, words.one, words.many)} in ${words.place}${seen}`;
}

/** One cell per depth, colored by what the robot does. */
export function renderStrip(host, runs, selected, camera, onSelect, { labels = KIND_LABELS, words } = {}) {
  host.textContent = '';
  const width = Math.max(240, host.clientWidth);
  const n = runs.length;
  const gap = width / n >= 8 ? 2 : 1;
  const cw = (width - gap * (n - 1)) / n;
  const top = 24;
  const ch = 40;
  const height = top + ch + 34;
  const x = (k) => k * (cw + gap);
  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'What the robot does at each prediction depth, from 0 to 60. The table below lists the same data.' });

  const cells = runs.map((run, k) =>
    el('rect', { class: `cellmark kind-${run.kind}`, x: x(k), y: top, width: cw, height: ch, rx: Math.min(3, cw / 3) }, svg),
  );

  // Label the depths where the behavior changes.
  let lastKey = null;
  let lastLabelX = -Infinity;
  runs.forEach((run, k) => {
    const key = `${run.kind}:${run.boxesIn}`;
    if (key !== lastKey) {
      const cx = x(k) + cw / 2;
      if (cx - lastLabelX >= 20) {
        el('line', { class: 'tick', x1: cx, y1: top - 6, x2: cx, y2: top - 1 }, svg);
        el('text', { class: 'mark', x: cx, y: top - 10, 'text-anchor': k === 0 ? 'start' : 'middle' }, svg).textContent = String(k);
        lastLabelX = cx;
      }
    }
    lastKey = key;
  });

  if (selected >= 0 && selected < n) {
    el('rect', { class: 'sel', x: x(selected) - 1.5, y: top - 1.5, width: cw + 3, height: ch + 3, rx: 3 }, svg);
  }

  for (let k = 0; k < n; k += 10) {
    const cx = x(k) + cw / 2;
    el('line', { class: 'tick', x1: cx, y1: top + ch + 3, x2: cx, y2: top + ch + 7 }, svg);
    el('text', { x: cx, y: top + ch + 19, 'text-anchor': k === 0 ? 'start' : 'middle' }, svg).textContent = String(k);
  }
  el('text', { x: width, y: top + ch + 33, 'text-anchor': 'end' }, svg).textContent = 'prediction depth (moves it can see ahead) →';

  host.appendChild(svg);
  const tip = tooltip(host);
  let hovered = -1;
  const depthAt = (e) => {
    const rect = svg.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor((e.clientX - rect.left) / (cw + gap))));
  };
  svg.addEventListener('pointermove', (e) => {
    const k = depthAt(e);
    if (k !== hovered) {
      if (hovered >= 0) cells[hovered].classList.remove('hovered');
      cells[k].classList.add('hovered');
      hovered = k;
    }
    const run = runs[k];
    tip.show(x(k) + cw / 2, top, runDetail(run, camera, words), `Depth ${k} · ${labels[run.kind]} · ${plural(run.steps.length, 'move', 'moves')}`);
  });
  svg.addEventListener('pointerleave', () => {
    if (hovered >= 0) cells[hovered].classList.remove('hovered');
    hovered = -1;
    tip.hide();
  });
  svg.addEventListener('click', (e) => onSelect(depthAt(e)));
}

export function renderStripTable(host, runs, camera, { labels = KIND_LABELS, countHeading = 'Boxes in chute' } = {}) {
  host.textContent = '';
  const table = html('table', 'data', host);
  const head = html('tr', '', html('thead', '', table));
  for (const h of ['Depth', 'What it does', countHeading, camera ? 'Seen by camera' : null, 'Moves']) if (h) html('th', '', head, h);
  const body = html('tbody', '', table);
  runs.forEach((run, k) => {
    const tr = html('tr', '', body);
    html('td', '', tr, String(k));
    html('td', '', tr, labels[run.kind]);
    html('td', '', tr, String(run.boxesIn));
    if (camera) html('td', '', tr, String(run.seen));
    html('td', '', tr, String(run.steps.length));
  });
}

const ARROWS = ['←', '→', '↓', '↑'];

/** The robot's Q-values for the four moves; the chosen move is highlighted. */
export function renderQBars(host, q, chosen, done) {
  host.textContent = '';
  const rows = html('div', `qrows${done ? ' done' : ''}`, host);
  const lo = Math.min(0, ...q);
  const hi = Math.max(0, ...q);
  const span = Math.max(hi - lo, 50);
  const pos = (v) => ((v - lo) / span) * 100;
  q.forEach((v, a) => {
    const row = html('div', `qrow${a === chosen ? ' chosen' : ''}`, rows);
    html('span', 'qlabel', row, `${ARROWS[a]} ${ACTION_NAMES[a]}`);
    const track = html('div', 'qtrack', row);
    const zero = html('div', 'qzero', track);
    zero.style.left = `${pos(0)}%`;
    if (v !== 0) {
      const bar = html('div', `qbar ${v > 0 ? 'pos' : 'neg'}`, track);
      bar.style.left = `${pos(Math.min(0, v))}%`;
      bar.style.width = `${Math.abs(pos(v) - pos(0))}%`;
    }
    html('span', 'qval', row, fmtReward(v));
  });
}

const compact = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}K`.replace('.0K', 'K') : String(v));

/** Columns: how many Q-values changed at each backup, on a log scale. */
export function renderConvergence(host, qChanged, last) {
  host.textContent = '';
  const width = Math.max(240, host.clientWidth);
  const height = 170;
  const padL = 38;
  const padR = 6;
  const padT = 24;
  const padB = 34;
  const n = qChanged.length - 1;
  let maxV = 1;
  for (let k = 1; k <= n; k++) maxV = Math.max(maxV, qChanged[k]);
  const topExp = Math.max(1, Math.ceil(Math.log10(maxV)));
  const lo = -0.3;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const slot = plotW / n;
  const gap = slot >= 6 ? 2 : 1;
  const bw = Math.min(24, slot - gap);
  const y = (v) => padT + plotH - ((Math.log10(v) - lo) / (topExp - lo)) * plotH;
  const base = padT + plotH;
  const cx = (k) => padL + (k - 1) * slot + slot / 2;
  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Number of forecasts that change at each depth, on a log scale. The table below lists the same data.' });

  for (let e = 0; e <= topExp; e++) {
    const yy = y(10 ** e);
    el('line', { class: 'gridline', x1: padL, y1: yy, x2: width - padR, y2: yy }, svg);
    el('text', { x: padL - 6, y: yy + 4, 'text-anchor': 'end' }, svg).textContent = compact(10 ** e);
  }
  el('line', { class: 'tick', x1: padL, y1: base, x2: width - padR, y2: base }, svg);

  const cols = [];
  for (let k = 1; k <= n; k++) {
    const v = qChanged[k];
    if (v <= 0) {
      cols.push(null);
      continue;
    }
    const yy = y(v);
    const h = base - yy;
    const r = Math.min(4, bw / 2, h);
    const x0 = cx(k) - bw / 2;
    const d = `M${x0} ${base} V${yy + r} Q${x0} ${yy} ${x0 + r} ${yy} H${x0 + bw - r} Q${x0 + bw} ${yy} ${x0 + bw} ${yy + r} V${base} Z`;
    cols.push(el('path', { class: 'col', d }, svg));
  }

  for (const k of [1, 10, 20, 30, 40, 50, 60]) {
    if (k > n) continue;
    el('line', { class: 'tick', x1: cx(k), y1: base + 3, x2: cx(k), y2: base + 7 }, svg);
    el('text', { x: cx(k), y: base + 19, 'text-anchor': 'middle' }, svg).textContent = String(k);
  }
  el('text', { x: width - padR, y: base + 33, 'text-anchor': 'end' }, svg).textContent = 'prediction depth →';

  if (last > 0) {
    const lx = cx(last);
    const anchor = lx > width - 120 ? 'end' : 'start';
    el('text', { class: 'direct', x: anchor === 'end' ? lx + bw / 2 : lx - bw / 2, y: y(qChanged[last]) - 8, 'text-anchor': anchor }, svg).textContent = `last change: depth ${last}`;
  }

  host.appendChild(svg);
  const tip = tooltip(host);
  let hovered = -1;
  svg.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const k = Math.max(1, Math.min(n, Math.floor((e.clientX - rect.left - padL) / slot) + 1));
    if (k !== hovered) {
      if (hovered > 0 && cols[hovered - 1]) cols[hovered - 1].classList.remove('hovered');
      if (cols[k - 1]) cols[k - 1].classList.add('hovered');
      hovered = k;
    }
    const v = qChanged[k];
    tip.show(cx(k), v > 0 ? y(v) : base, v > 0 ? `${v.toLocaleString('en-US')} changed` : 'None changed', `Depth ${k}`);
  });
  svg.addEventListener('pointerleave', () => {
    if (hovered > 0 && cols[hovered - 1]) cols[hovered - 1].classList.remove('hovered');
    hovered = -1;
    tip.hide();
  });
}

export function renderConvergenceTable(host, qChanged) {
  host.textContent = '';
  const table = html('table', 'data', host);
  const head = html('tr', '', html('thead', '', table));
  html('th', '', head, 'Depth');
  html('th', '', head, 'Forecasts that changed');
  const body = html('tbody', '', table);
  for (let k = 1; k < qChanged.length; k++) {
    const tr = html('tr', '', body);
    html('td', '', tr, String(k));
    html('td', '', tr, qChanged[k].toLocaleString('en-US'));
  }
}
