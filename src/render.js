// Draws the grid world as SVG, in cell units: cell (r, c) spans x in [c, c+1]
// and y in [r, r+1]. The chute (or pool) sits below the bottom-left cell, the
// camera right of the bottom row. Two themes: 'boxes' (the video) and 'pool'
// (buckets of water and a pool that floods).

import { W, H, N, MAX_BOXES, POUR_SPOT, rowOf, colOf } from './env.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// Direction vectors for the moves L, R, D, U, as [dx, dy].
const FACE = [[-1, 0], [1, 0], [0, 1], [0, -1]];

export function createWorld(svg, onCellClick, { theme = 'boxes', seesSpot = false } = {}) {
  const pool = theme === 'pool';
  svg.setAttribute('viewBox', `-0.32 -0.32 ${W + 1.8} ${H + 1.44}`);
  svg.classList.toggle('pool-theme', pool);

  const cellsLayer = el('g', { class: 'cells' }, svg);
  for (let i = 0; i < N; i++) {
    const r = el('rect', { class: 'cell', x: colOf(i), y: rowOf(i), width: 1, height: 1 }, cellsLayer);
    r.dataset.cell = i;
  }
  const cells = [...cellsLayer.children];
  cellsLayer.addEventListener('click', (e) => {
    const c = e.target.dataset && e.target.dataset.cell;
    if (c !== undefined) onCellClick(Number(c));
  });
  cellsLayer.addEventListener('keydown', (e) => {
    const c = e.target.dataset && e.target.dataset.cell;
    if (c === undefined || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onCellClick(Number(c));
  });

  // Everything drawn over the cells lets clicks through to them.
  const overlay = el('g', { 'pointer-events': 'none' }, svg);
  const sight = el('rect', { class: 'sight', x: 0, y: H - 1, width: W, height: 1 }, overlay);
  const flash = el('rect', { class: 'sight-flash', x: 0, y: H - 1, width: W, height: 1, opacity: 0 }, overlay);
  const sightStop = el('line', { class: 'sight-stop', x1: 0, y1: H - 1, x2: 0, y2: H }, overlay);
  const spot = seesSpot
    ? el('rect', { class: 'sight spot', x: colOf(POUR_SPOT) + 0.04, y: rowOf(POUR_SPOT) + 0.04, width: 0.92, height: 0.92, rx: 0.06 }, overlay)
    : null;

  // The flood spreads from the pool corner, one ring of cells at a time.
  const floodCells = [];
  if (pool) {
    const g = el('g', { class: 'flood', 'pointer-events': 'none' }, svg);
    for (let i = 0; i < N; i++) {
      const d = H - 1 - rowOf(i) + colOf(i);
      const rect = el('rect', { x: colOf(i), y: rowOf(i), width: 1, height: 1 }, g);
      floodCells.push({ rect, d });
    }
  }

  const grid = el('g', { class: 'gridlines', 'pointer-events': 'none' }, svg);
  for (let c = 1; c < W; c++) el('line', { x1: c, y1: 0, x2: c, y2: H }, grid);
  for (let r = 1; r < H; r++) el('line', { x1: 0, y1: r, x2: W, y2: r }, grid);
  el('rect', { class: 'frame', x: 0, y: 0, width: W, height: H, rx: 0.04, 'pointer-events': 'none' }, svg);

  const chute = el('g', { class: pool ? 'pool' : 'chute' }, svg);
  el('rect', { class: 'basin', x: 0.05, y: H + 0.05, width: 0.9, height: 0.9, rx: 0.08 }, chute);
  const water = pool ? el('rect', { class: 'water', x: 0.11, y: H + 0.2, width: 0.78, height: 0.69, rx: 0.05 }, chute) : null;
  const spill = pool ? el('path', { class: 'spill', d: `M0.05 ${H + 0.06} q0.12 -0.16 0.24 0 t0.24 0 t0.24 0 t0.24 0` }, chute) : null;
  const chuteCount = el('text', { class: 'count', x: 0.5, y: H + 0.62, 'text-anchor': 'middle' }, chute);
  el('text', { class: 'label', x: 1.12, y: H + 0.57 }, svg).textContent = pool ? '← pool' : '← chute';

  const cam = el('g', { class: 'camera', transform: `translate(${W + 0.12} ${H - 1})` }, svg);
  el('circle', { class: 'lens-ring', cx: 0.27, cy: 0.5, r: 0.15 }, cam);
  el('rect', { class: 'body', x: 0.32, y: 0.3, width: 0.82, height: 0.42, rx: 0.08 }, cam);
  el('circle', { class: 'lens', cx: 0.27, cy: 0.5, r: 0.08 }, cam);
  el('circle', { class: 'rec', cx: 1.02, cy: 0.4, r: 0.045 }, cam);
  el('path', { class: 'stand', d: 'M0.73 0.72 V0.95 M0.56 0.95 H0.9' }, cam);
  el('line', { class: 'slash', x1: 0.12, y1: 0.18, x2: 1.2, y2: 0.86 }, cam);
  el('text', { class: 'label', x: W + 0.76, y: H + 0.27, 'text-anchor': 'middle' }, svg).textContent = 'camera';

  const boxLayer = el('g', { 'pointer-events': 'none' }, svg);
  const boxes = [];
  for (let j = 0; j < MAX_BOXES; j++) {
    const g = el('g', { class: pool ? 'bucket' : 'box' }, boxLayer);
    if (pool) {
      el('path', { class: 'handle', d: 'M-0.25 -0.2 Q0 -0.56 0.25 -0.2' }, g);
      el('path', { class: 'pail', d: 'M-0.3 -0.2 L0.3 -0.2 L0.21 0.32 Q0 0.37 -0.21 0.32 Z' }, g);
      el('ellipse', { class: 'surface', cx: 0, cy: -0.2, rx: 0.3, ry: 0.075 }, g);
      el('path', { class: 'band', d: 'M-0.27 0.02 L0.27 0.02' }, g);
    } else {
      el('rect', { class: 'outer', x: -0.36, y: -0.36, width: 0.72, height: 0.72, rx: 0.06 }, g);
      el('rect', { class: 'plank', x: -0.25, y: -0.25, width: 0.5, height: 0.5, rx: 0.03 }, g);
      el('path', { class: 'plank', d: 'M-0.25 -0.25 L0.25 0.25' }, g);
    }
    boxes.push(g);
  }

  const robot = el('g', { class: 'robot', 'pointer-events': 'none' }, svg);
  el('line', { class: 'antenna', x1: 0, y1: -0.33, x2: 0, y2: -0.45 }, robot);
  el('circle', { class: 'led', cx: 0, cy: -0.46, r: 0.05 }, robot);
  el('circle', { class: 'body', cx: 0, cy: 0, r: 0.33 }, robot);
  const eyes = [el('circle', { class: 'eye', r: 0.065 }, robot), el('circle', { class: 'eye', r: 0.065 }, robot)];
  el('path', { class: 'closed', d: 'M-0.18 0 H-0.06 M0.06 0 H0.18' }, robot);
  el('text', { class: 'offtag', x: 0, y: 0.25, 'text-anchor': 'middle' }, robot).textContent = 'OFF';

  const burst = el('g', { class: 'burst', 'pointer-events': 'none' }, svg);
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const rad = i % 2 ? 0.17 : 0.42;
    const t = (i / 16) * Math.PI * 2;
    pts.push(`${(rad * Math.cos(t)).toFixed(3)},${(rad * Math.sin(t)).toFixed(3)}`);
  }
  el('polygon', { class: 'ray', points: pts.join(' ') }, burst);
  el('circle', { class: 'core', r: 0.14 }, burst);

  const banner = pool ? el('g', { class: 'banner', 'pointer-events': 'none' }, svg) : null;
  if (banner) {
    el('rect', { x: W / 2 - 1.15, y: 0.18, width: 2.3, height: 0.62, rx: 0.31 }, banner);
    el('text', { x: W / 2, y: 0.61, 'text-anchor': 'middle' }, banner).textContent = 'FLOOD!';
  }

  let lastFlood = -1;

  return {
    // While editing, each cell is a button that keyboard and screen-reader
    // users can reach; labelFor(i) says what is in cell i.
    setEditing(on, labelFor) {
      cellsLayer.classList.toggle('editable', on);
      svg.setAttribute('role', on ? 'group' : 'img');
      cells.forEach((r, i) => {
        if (on) {
          r.setAttribute('tabindex', '0');
          r.setAttribute('role', 'button');
          r.setAttribute('aria-label', labelFor(i));
        } else {
          r.removeAttribute('tabindex');
          r.removeAttribute('role');
          r.removeAttribute('aria-label');
        }
      });
    },

    /**
     * scene: { robot: {x, y, facing, mode: 'on'|'off'|'gone'}, boxes: [{x, y, opacity, scale}],
     *          chute, sight (leftmost visible column, or null with the camera off),
     *          flash (0-1), burst: null | {x, y, t}, flood (0, 1 or 2) }
     */
    draw(scene) {
      const { robot: rb } = scene;
      robot.setAttribute('display', rb.mode === 'gone' ? 'none' : 'inline');
      robot.setAttribute('transform', `translate(${rb.x + 0.5} ${rb.y + 0.5})`);
      robot.classList.toggle('off', rb.mode === 'off');
      const [dx, dy] = FACE[rb.facing];
      eyes.forEach((e, k) => {
        const s = k ? 1 : -1;
        e.setAttribute('cx', (dx * 0.11 - dy * 0.13 * s).toFixed(3));
        e.setAttribute('cy', (dy * 0.11 + dx * 0.13 * s - 0.03).toFixed(3));
      });

      boxes.forEach((g, j) => {
        const b = scene.boxes[j];
        if (!b || b.opacity <= 0) {
          g.setAttribute('display', 'none');
          return;
        }
        g.setAttribute('display', 'inline');
        g.setAttribute('opacity', b.opacity.toFixed(3));
        g.setAttribute('transform', `translate(${b.x + 0.5} ${b.y + 0.5}) scale(${b.scale.toFixed(3)})`);
      });

      if (pool) {
        water.setAttribute('display', scene.chute > 0 ? 'inline' : 'none');
        spill.setAttribute('display', scene.chute > 1 ? 'inline' : 'none');
        chuteCount.textContent = scene.chute > 1 ? `${scene.chute}` : scene.chute === 1 ? '✓' : '';
        chute.classList.toggle('overflow', scene.chute > 1);
      } else {
        chuteCount.textContent = scene.chute > 0 ? String(scene.chute) : '';
      }

      cam.classList.toggle('off', scene.sight === null);
      if (scene.sight === null) {
        for (const r of [sight, flash, spot]) if (r) r.setAttribute('display', 'none');
      } else {
        for (const r of [sight, flash]) {
          r.setAttribute('display', 'inline');
          r.setAttribute('x', scene.sight);
          r.setAttribute('width', W - scene.sight);
        }
        if (spot) spot.setAttribute('display', 'inline');
        flash.setAttribute('opacity', scene.flash.toFixed(3));
      }
      // Where a box cuts off the camera's view of the bottom row.
      if (scene.sight) {
        sightStop.setAttribute('display', 'inline');
        sightStop.setAttribute('x1', scene.sight);
        sightStop.setAttribute('x2', scene.sight);
      } else {
        sightStop.setAttribute('display', 'none');
      }

      if (scene.burst) {
        burst.setAttribute('display', 'inline');
        const s = 0.35 + 0.65 * scene.burst.t;
        burst.setAttribute('transform', `translate(${scene.burst.x + 0.5} ${scene.burst.y + 0.5}) scale(${s.toFixed(3)})`);
      } else {
        burst.setAttribute('display', 'none');
      }

      if (pool) {
        const flood = Math.min(2, Math.round(scene.flood || 0));
        if (flood !== lastFlood) {
          const reach = flood === 0 ? -1 : flood === 1 ? 2 : 5;
          for (const { rect, d } of floodCells) {
            const on = d <= reach;
            rect.style.transitionDelay = flood === 0 ? '0ms' : `${d * 110}ms`;
            rect.style.opacity = on ? String(0.62 - 0.07 * d) : '0';
          }
          banner.classList.toggle('show', flood > 0);
          svg.classList.toggle('flooded', flood > 0);
          lastFlood = flood;
        }
      }
    },
  };
}
