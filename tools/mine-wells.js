// Builds the well template library (js/wells-data.js) for spin drills.
// Usage: node tools/mine-wells.js [templates per drill type = 40] [seconds per drill type = 90]
//
// Sources: the named setups below, and wells from the procedural generator. For each well, setup pieces are
// peeled off near the slot so that every one is needed (see TW.Generator.validateSpin). The patch around the
// slot and the setup pieces becomes a template, which is kept only if it still works when placed into random
// gray stacks.
'use strict';
const fs = require('fs');
const path = require('path');

global.window = global;
const root = path.join(__dirname, '..');
for (const f of ['pieces', 'board', 'srs', 'spin', 'search', 'generator', 'wells']) {
  (0, eval)(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8')); // global scope, like a <script> tag
}
const { TW } = global;
const { W, H } = TW.Board;
const { cellsOf } = TW.Pieces;
const G = TW.Generator;

const PER_TYPE = +process.argv[2] || 40;
const SECONDS = +process.argv[3] || 90;
const MAX_SETUP = 3;

// Named setups: the finished well (no setup pieces); `clear` = rows the goal clears.
const NAMED = [
  { name: 'TSD', piece: 'T', spin: 'full', lines: 2, rows: ['##....', '#***##', '##*###'], clear: [1, 2] },
  { name: 'TSS', piece: 'T', spin: 'full', lines: 1, rows: ['##....', '#***##', '##*###'], clear: [1] },
  { name: 'TST', piece: 'T', spin: 'full', lines: 3, rows: ['...##', '..###', '.....', '##*##', '#**##', '##*##'], clear: [3, 4, 5] },
  { name: 'STSD', piece: 'T', spin: 'full', lines: 2, rows: ['...##', '..###', '.....', '##*##', '#**##', '##*##'], clear: [4, 5] },
];

const key = (t) => [t.piece, t.spin, t.lines, t.rows.join('/'), t.clear.join(','), t.wall || ''].join('|');
const canon = (t) => [key(t), key(TW.Wells.mirror(t))].sort()[0];

// How often the template works when placed into a random stack (all setup pieces in the queue).
function score(t, tries) {
  const p = TW.Wells.parse(t);
  if (!p) return 0;
  const goal = { kind: 'spin', piece: t.piece, spin: t.spin, lines: t.lines };
  let ok = 0;
  for (let i = 0; i < tries; i++) {
    const e = TW.Wells.embed(p, p.setupMax);
    if (e && G.validateSpin(e.board, e.setups, goal, e.target)) ok++;
  }
  return ok / tries;
}

// Cuts the patch around the slot and the setup pieces out of a solved drill.
function extract(board, steps, goalStep, goal) {
  const final = board.clone();
  steps.forEach((s) => final.place(s));
  const slot = cellsOf(goalStep);
  const groups = steps.map((s) => cellsOf(s));
  const all = slot.concat(...groups);
  const xs = all.map((c) => c[0]), ys = all.map((c) => c[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const x0 = Math.max(0, minx - 1), x1 = Math.min(W - 1, maxx + 1);
  const y0 = Math.max(0, miny - 2), y1 = Math.min(H - 1, maxy + 1);
  const at = (x, y) => (c) => c[0] === x && c[1] === y;
  const rows = [];
  for (let y = y0; y <= y1; y++) {
    let row = '';
    for (let x = x0; x <= x1; x++) {
      const gi = groups.findIndex((g) => g.some(at(x, y)));
      if (slot.some(at(x, y))) row += '*';
      else if (gi >= 0) row += String(gi + 1);
      else row += board.get(x, y) ? '#' : '.';
    }
    rows.push(row);
  }
  const withGoal = final.clone();
  withGoal.place(goalStep);
  const clear = [...new Set(slot.map((c) => c[1]))].filter((y) => withGoal.rowFull(y)).map((y) => y - y0).sort((a, b) => a - b);
  const wall = x0 === 0 && minx === 0 ? 'L' : x1 === W - 1 && maxx === W - 1 ? 'R' : null;
  const t = { piece: goal.piece, spin: goal.spin, lines: goal.lines, rows, clear };
  if (wall) t.wall = wall;
  return t;
}

// One candidate well from a named setup: place it in a random stack, then peel setup pieces.
function fromNamed(n, setupN) {
  const p = TW.Wells.parse({ ...n, id: n.name });
  const e = p && TW.Wells.embed(p, 0);
  if (!e) return null;
  const goal = { kind: 'spin', piece: n.piece, spin: n.spin, lines: n.lines };
  const res = TW.Search.search(e.board, goal.piece);
  const hit = res.placements.find((h) => G.goalMatches(goal, h.type, h.spin, h.lines) && TW.Search.sameCells(h, e.target));
  if (!hit) return null;
  const out = G.peelSetup(e.board, goal, hit, setupN);
  return out && extract(out.board, out.steps, out.goalStep, goal);
}

function fromGenerator(goal, setupN) {
  const d = G.genSpin(goal, setupN, 300);
  if (!d) return null;
  const steps = d.solution.slice(0, -1);
  return extract(d.board, steps, d.solution[d.solution.length - 1], goal);
}

const found = new Map(); // canonical key -> template
function consider(t, name) {
  if (!t) return false;
  const k = canon(t);
  if (found.has(k)) return false;
  if (score(t, 10) < 0.5) return false;
  const m = TW.Wells.mirror(t);
  if (score(m, 10) >= 0.5) t.mirror = true;
  if (name) t.name = name;
  found.set(k, t);
  return true;
}

function mine(label, make, target) {
  const t0 = Date.now();
  let n = 0;
  for (let setupN = MAX_SETUP; setupN >= 1 && n < target; setupN--) {
    // Spend most of the time on the full setup count; fewer setup pieces only fill what is left.
    const until = Date.now() + (setupN === MAX_SETUP ? 0.7 : 0.15) * SECONDS * 1000;
    while (n < target && Date.now() < until) if (make(setupN)) n++;
  }
  console.log(label.padEnd(16), String(n).padStart(3), 'templates', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}

for (const n of NAMED) mine(n.name + ' (named)', (s) => consider(fromNamed(n, s), n.name), Math.ceil(PER_TYPE / 4));
for (const [sc, def] of Object.entries(G.SCENARIOS)) {
  if (sc === 'PC' || sc === 'OP' || sc === 'Z' || sc === 'J') continue; // Z / J come from mirrored S / L
  for (const [type] of def.types) {
    const goal = G.makeGoal(sc, type);
    mine(sc + ' ' + type, (s) => consider(fromGenerator(goal, s)), PER_TYPE);
  }
}

const list = [...found.values()];
const counts = {};
for (const t of list) {
  const k = t.name ? t.name.toLowerCase() : (t.piece + t.spin[0] + t.lines).toLowerCase();
  counts[k] = (counts[k] || 0) + 1;
  t.id = k + '-' + counts[k];
}
const order = ['id', 'name', 'piece', 'spin', 'lines', 'wall', 'mirror', 'clear', 'rows'];
const lines = list.map((t) => '    ' + JSON.stringify(t, order.filter((f) => t[f] !== undefined)) + ',');
const out = '// Generated by tools/mine-wells.js. Do not edit by hand; see js/wells.js for the format.\n' +
  'TW.module(function (TW) {\n  TW.WELL_DATA = [\n' + lines.join('\n') + '\n  ];\n});\n';
fs.writeFileSync(path.join(root, 'js', 'wells-data.js'), out);
console.log('wrote', list.length, 'templates to js/wells-data.js');
