// Procedural drill generation. Every board is verified with TW.Search before it is used, and the
// generator records a full solution (placements + input paths) that is used for hints and self-tests.
TW.module(function (TW) {
  'use strict';

  const { W, H } = TW.Board;
  const { SHAPES, TYPES, STACK_ID, cellsOf } = TW.Pieces;

  const LINE_TYPES = [['single', 'Single', 1], ['double', 'Double', 2], ['triple', 'Triple', 3]];

  const SCENARIOS = {
    T: { label: 'T-Spin', piece: 'T', types: [['mini', 'Mini Single', 1], ...LINE_TYPES] },
    S: { label: 'S-Spin', piece: 'S', types: LINE_TYPES },
    Z: { label: 'Z-Spin', piece: 'Z', types: LINE_TYPES },
    L: { label: 'L-Spin', piece: 'L', types: LINE_TYPES },
    J: { label: 'J-Spin', piece: 'J', types: LINE_TYPES },
    I: { label: 'I-Spin', piece: 'I', types: LINE_TYPES },
    PC: { label: 'Perfect Clear', types: [['2', '2-line', 2], ['4', '4-line', 4]] },
  };

  const MAX_SETUP = { spin: 3, pc: 6 };

  const rand = (n) => Math.floor(Math.random() * n);
  const randInt = (a, b) => a + rand(b - a + 1);
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function makeGoal(scenario, type) {
    const sc = SCENARIOS[scenario];
    const t = sc.types.find((x) => x[0] === type) || sc.types[0];
    if (scenario === 'PC') return { kind: 'pc', height: t[2], text: 'Perfect Clear (' + t[1] + ')' };
    const spin = scenario === 'T' ? (t[0] === 'mini' ? 'mini' : 'full') : 'any';
    const text = (spin === 'mini' ? 'Mini ' : '') + sc.piece + '-Spin ' + TW.Spin.LINE_NAMES[t[2]].toLowerCase().replace(/^./, (c) => c.toUpperCase());
    return { kind: 'spin', piece: sc.piece, spin, lines: t[2], text };
  }

  function goalMatches(goal, type, spin, lines) {
    if (goal.kind !== 'spin' || type !== goal.piece || lines !== goal.lines) return false;
    return goal.spin === 'any' ? spin !== 'none' : spin === goal.spin;
  }

  // ---------- Spin drills ----------

  function bounds(shape) {
    const xs = shape.map((c) => c[0]), ys = shape.map((c) => c[1]);
    return { minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) };
  }

  // Empties (x, y) and every stack cell above it in that column, except protected rows.
  function digColumn(board, x, y, keepRows) {
    for (let r = y; r >= 0; r--) {
      if (r !== y && keepRows.has(r)) break;
      board.set(x, r, 0);
    }
  }

  // Removes cells that are not connected (orthogonally) to the floor.
  function removeFloating(board) {
    const seen = new Uint8Array(W * H);
    const stack = [];
    for (let x = 0; x < W; x++) if (board.get(x, H - 1)) { seen[(H - 1) * W + x] = 1; stack.push([x, H - 1]); }
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || nx >= W || ny < 0 || ny >= H || seen[ny * W + nx] || !board.get(nx, ny)) continue;
        seen[ny * W + nx] = 1;
        stack.push([nx, ny]);
      }
    }
    let removed = 0;
    for (let i = 0; i < W * H; i++) if (!seen[i] && board.cells[i]) { board.cells[i] = 0; removed++; }
    return removed;
  }

  // Builds a candidate board around a target placement of the goal piece. Returns { board, target } or null.
  function buildSpinBoard(goal, setupN) {
    const type = goal.piece;
    const rot = rand(4);
    const shape = SHAPES[type][rot];
    const bb = bounds(shape);
    const g = [0, 0, 1, 1, 2][rand(5)];
    const bottom = H - 1 - g;
    const target = { type, rot, x: randInt(-bb.minx, W - 1 - bb.maxx), y: bottom - bb.maxy };
    const P = cellsOf(target);
    const pset = new Set(P.map(([x, y]) => y * W + x));
    const spanRows = [...new Set(P.map((c) => c[1]))].sort((a, b) => a - b);
    if (spanRows.length < goal.lines) return null;
    const clearRows = new Set(shuffle(spanRows.slice()).slice(0, goal.lines));
    const pieceTop = spanRows[0];

    // Top cell of the piece in each of its columns.
    const pTop = {};
    for (const [x, y] of P) if (pTop[x] === undefined || y < pTop[x]) pTop[x] = y;
    const pCols = Object.keys(pTop).map(Number);
    let covered;
    do {
      covered = new Set(pCols.filter(() => Math.random() < 0.5));
    } while (pCols.length > 1 && (covered.size === 0 || covered.size === pCols.length));

    const board = new TW.Board();
    const minRow = Math.max(H - 16, pieceTop - 3 - setupN);
    const fillFrom = new Array(W);
    let walk = pieceTop + randInt(-2, 1) - rand(setupN + 1);
    for (let c = 0; c < W; c++) {
      if (pTop[c] !== undefined) {
        fillFrom[c] = covered.has(c) ? pTop[c] - randInt(1, 2) : pTop[c];
      } else {
        walk += randInt(-1, 1);
        walk = Math.min(pieceTop + 1, Math.max(pieceTop - 2 - setupN, walk));
        fillFrom[c] = walk;
      }
      fillFrom[c] = Math.max(minRow, fillFrom[c]);
      for (let r = fillFrom[c]; r <= bottom; r++) if (!pset.has(r * W + c)) board.set(c, r, STACK_ID);
    }

    // Garbage rows under the slot.
    let hole = rand(W);
    for (let r = bottom + 1; r < H; r++) {
      if (Math.random() < 0.3) hole = rand(W);
      for (let c = 0; c < W; c++) if (c !== hole) board.set(c, r, STACK_ID);
    }

    // Random roof/overhang variations right around the slot (TST and other triple slots need these).
    const lo = Math.max(0, Math.min(...pCols) - 1), hi = Math.min(W - 1, Math.max(...pCols) + 1);
    for (let i = randInt(0, 3); i > 0; i--) {
      const c = randInt(lo, hi), r = pieceTop - randInt(1, 3);
      if (r >= minRow && !pset.has(r * W + c)) board.set(c, r, board.get(c, r) ? 0 : STACK_ID);
    }

    for (const r of clearRows) for (let c = 0; c < W; c++) if (!pset.has(r * W + c)) board.set(c, r, STACK_ID);

    // Rows the piece touches but must not clear need an extra gap; rows above must not be full.
    const others = shuffle([...Array(W).keys()].filter((c) => pTop[c] === undefined));
    for (const r of spanRows) {
      if (clearRows.has(r)) continue;
      let full = true;
      for (let c = 0; c < W && full; c++) if (!board.get(c, r) && !pset.has(r * W + c)) full = false;
      if (full) digColumn(board, others.length ? others[0] : rand(W), r, clearRows);
    }
    for (let r = minRow; r < pieceTop; r++) if (board.rowFull(r)) digColumn(board, rand(W), r, clearRows);
    removeFloating(board);
    if (board.fullRows().length) return null;

    // Cheap pre-checks before running the full search.
    if (TW.Search.linesIfPlaced(board, target) !== goal.lines) return null;
    if (TW.Spin.detect(board, target, true) === 'none') return null;
    return { board, target };
  }

  // Chebyshev distance between two cell lists.
  function cellDist(a, b) {
    let best = Infinity;
    for (const [ax, ay] of a) for (const [bx, by] of b) best = Math.min(best, Math.max(Math.abs(ax - bx), Math.abs(ay - by)));
    return best;
  }

  // Removes up to n pieces from the stack in reverse placement order. Each removed piece must be a
  // resting surface placement, reachable from spawn on the board without it, and must not leave floating cells.
  // opts: exclude (types not allowed), distinct (no repeated types: a valid 7-bag window),
  //       near (anchor cells), reach (max distance to the anchor or to an already removed piece),
  //       radius (max distance to the anchor itself), blocks (predicate the board must pass after the removal),
  //       partial (return what was found), cosmetic (skip the reachability search), tries.
  function decompose(board, n, keepBelowRow, opts) {
    opts = opts || {};
    let cur = board.clone();
    const steps = [];
    const used = new Set(opts.exclude || []);
    const removedCells = [];
    for (let k = 0; k < n; k++) {
      const cands = [];
      for (const type of TYPES) {
        if (used.has(type)) continue;
        for (let rot = 0; rot < (type === 'O' ? 1 : 4); rot++) {
          for (let x = -3; x < W; x++) {
            for (let y = H - 18; y < H; y++) {
              const cells = cellsOf({ type, rot, x, y });
              if (!cells.every(([cx, cy]) => cx >= 0 && cx < W && cy < keepBelowRow && cy >= 0 && cur.get(cx, cy))) continue;
              let d = 0;
              if (opts.near) {
                d = cellDist(cells, opts.near);
                if (d > opts.radius) continue;
                if (Math.min(d, removedCells.length ? cellDist(cells, removedCells) : Infinity) > opts.reach) continue;
              }
              cands.push({ type, rot, x, y, cells, d });
            }
          }
        }
      }
      // Random order, closest to the anchor first.
      shuffle(cands).sort((a, b) => a.d - b.d);
      let found = null;
      let tries = 0;
      for (const c of cands) {
        const b2 = cur.clone();
        for (const [cx, cy] of c.cells) b2.set(cx, cy, 0);
        if (!c.cells.every(([cx, cy]) => { for (let r = cy - 1; r >= 0; r--) if (b2.get(cx, r)) return false; return true; })) continue;
        if (b2.fits(c.type, c.rot, c.x, c.y + 1)) continue;
        if (removeFloating(b2.clone())) continue;
        if (opts.cosmetic) {
          found = { b2, cells: c.cells, step: { type: c.type, rot: c.rot, x: c.x, y: c.y } };
          break;
        }
        if (++tries > (opts.tries || 30)) break;
        if (opts.blocks && !opts.blocks(b2)) continue;
        const res = TW.Search.search(b2, c.type);
        const pl = res.placements.find((p) => p.x === c.x && p.y === c.y && p.rot === c.rot);
        if (!pl) continue;
        found = { b2, cells: c.cells, step: { type: c.type, rot: c.rot, x: c.x, y: c.y, path: res.pathTo(pl) } };
        break;
      }
      if (!found) {
        if (opts.partial) break;
        return null;
      }
      cur = found.b2;
      if (opts.distinct) used.add(found.step.type);
      removedCells.push(...found.cells);
      steps.unshift(found.step);
    }
    return { board: cur, steps };
  }

  // Colors stack cells as real pieces: peels resting surface pieces off the stack (near `near` if given,
  // without leaving floating cells) and puts them back with their piece color. Best of several random runs.
  function colorize(board, keepBelowRow, near) {
    const opts = near ? { near, reach: 1, radius: 3, partial: true, cosmetic: true } : { partial: true, cosmetic: true };
    let best = null, bestScore = -1;
    for (let run = 0; run < 8; run++) {
      const dec = decompose(board, 12, keepBelowRow, opts);
      if (!dec) continue;
      const score = dec.steps.reduce((sum, st) => sum + (near ? 4 - Math.min(3, cellDist(cellsOf(st), near)) : 1), 0);
      if (score > bestScore) { best = dec; bestScore = score; }
    }
    const out = board.clone();
    if (best) for (const st of best.steps) out.place(st);
    return out;
  }

  // True when the goal piece can make the goal clear on this board right now.
  function goalPossible(board, goal) {
    return TW.Search.search(board, goal.piece).placements.some((p) => goalMatches(goal, p.type, p.spin, p.lines));
  }

  // Checks a spin drill: `setups` ([{ type, cells }], in order) must each be reachable without clearing lines,
  // the goal must work after the last one, and every setup piece must be needed:
  //  - no early spin: the goal is impossible before the last setup piece is placed;
  //  - no shortcut: leaving out any one setup piece (e.g. keeping it in hold) also makes the goal impossible.
  // Returns { steps, goalStep } with input paths, or null. `target` (optional) is the preferred goal placement.
  function validateSpin(board, setups, goal, target) {
    const b = board.clone();
    const steps = [];
    if (setups.length && goalPossible(b, goal)) return null;
    for (let i = 0; i < setups.length; i++) {
      const s = setups[i];
      const res = TW.Search.search(b, s.type);
      const want = s.cells.map((c) => c.join(',')).sort().join(';');
      const pl = res.placements.find((p) => !p.lines && cellsOf(p).map((c) => c.join(',')).sort().join(';') === want);
      if (!pl) return null;
      steps.push({ type: pl.type, rot: pl.rot, x: pl.x, y: pl.y, path: res.pathTo(pl) });
      b.place(pl);
      if (i < setups.length - 1 && goalPossible(b, goal)) return null;
    }
    const res = TW.Search.search(b, goal.piece);
    const hits = res.placements.filter((p) => goalMatches(goal, p.type, p.spin, p.lines));
    if (!hits.length) return null;
    const hit = (target && hits.find((h) => TW.Search.sameCells(h, target))) || hits[0];
    for (let skip = 0; setups.length > 1 && skip < steps.length - 1; skip++) {
      const b2 = board.clone();
      steps.forEach((st, i) => { if (i !== skip) b2.place(st); });
      if (goalPossible(b2, goal)) return null;
    }
    return { steps, goalStep: { type: hit.type, rot: hit.rot, x: hit.x, y: hit.y, path: res.pathTo(hit) } };
  }

  // Peels setupN setup pieces off a finished well (the goal works on `board`) so that every one is needed.
  // Returns { board, steps, goalStep } or null.
  function peelSetup(board, goal, target, setupN) {
    const slot = cellsOf(target);
    const keepBelow = Math.max(...slot.map((c) => c[1])) + 1;
    const opts = {
      exclude: [goal.piece], distinct: true, near: slot, reach: 1, radius: 2,
      blocks: (b) => !goalPossible(b, goal),
    };
    for (let d = 0; d < 4; d++) {
      const dec = setupN ? decompose(board, setupN, keepBelow, opts) : { board: board.clone(), steps: [] };
      if (!dec) continue;
      const v = validateSpin(dec.board, dec.steps.map((st) => ({ type: st.type, cells: cellsOf(st) })), goal, target);
      if (v) return { board: dec.board, steps: v.steps, goalStep: v.goalStep };
      if (!setupN) return null;
    }
    return null;
  }

  // Procedural spin drill: random stack around a target placement, then setup pieces peeled off near the slot.
  function genSpin(goal, setupN, maxAttempts) {
    for (let attempt = 0; attempt < (maxAttempts || 20000); attempt++) {
      const cand = buildSpinBoard(goal, setupN);
      if (!cand) continue;
      const res = TW.Search.search(cand.board, goal.piece);
      const hits = res.placements.filter((p) => goalMatches(goal, p.type, p.spin, p.lines));
      if (!hits.length) continue;
      const hit = hits.find((h) => TW.Search.sameCells(h, cand.target)) || hits[0];
      const out = peelSetup(cand.board, goal, hit, setupN);
      if (!out) continue;
      return {
        board: out.board,
        queue: [...out.steps.map((s) => s.type), goal.piece],
        solution: [...out.steps, out.goalStep],
        attempts: attempt + 1,
      };
    }
    return null;
  }

  // Spin drill from the well template library (js/wells.js): a known well, gray filler around it.
  function genFromTemplate(goal, setupN) {
    const pool = TW.Wells ? TW.Wells.pool(goal, setupN) : [];
    if (!pool.length) return null;
    for (let attempt = 0; attempt < 200; attempt++) {
      const t = pool[rand(pool.length)];
      const e = TW.Wells.embed(t, setupN);
      if (!e) continue;
      const v = validateSpin(e.board, e.setups, goal, e.target);
      if (!v) continue;
      return {
        board: e.board,
        queue: [...v.steps.map((s) => s.type), goal.piece],
        solution: [...v.steps, v.goalStep],
        attempts: attempt + 1,
        well: { id: t.id, name: t.name || null },
      };
    }
    return null;
  }

  // ---------- Perfect clear drills ----------

  function rowsToBoard(rows) {
    const b = new TW.Board();
    rows.forEach((mask, i) => {
      for (let x = 0; x < W; x++) if (mask & (1 << x)) b.set(x, H - 1 - i, STACK_ID);
    });
    return b;
  }

  function boardToRows(b) {
    const rows = [];
    for (let i = 0; i < H; i++) {
      let mask = 0;
      for (let x = 0; x < W; x++) if (b.get(x, H - 1 - i)) mask |= 1 << x;
      rows.push(mask);
    }
    while (rows.length && rows[rows.length - 1] === 0) rows.pop();
    return rows;
  }

  // Plays backwards from an empty board: each step re-inserts the rows the piece cleared and removes the piece.
  function genPC(goal, pieces) {
    const FULL = (1 << W) - 1;
    for (let attempt = 0; attempt < 400; attempt++) {
      let rows = [];
      const steps = [];
      let ok = true;
      // 7-bag: forward piece i belongs to bag floor((i + offset) / 7); types within a bag are distinct.
      const offset = rand(7);
      const bagUsed = new Map();
      for (let s = 0; s < pieces && ok; s++) {
        const bag = Math.floor((pieces - 1 - s + offset) / 7);
        if (!bagUsed.has(bag)) bagUsed.set(bag, new Set());
        const usedInBag = bagUsed.get(bag);
        let done = false;
        for (let t = 0; t < 30 && !done; t++) {
          const room = goal.height - rows.length;
          let k;
          if (rows.length === 0) k = randInt(1, Math.min(goal.height, 2));
          else k = Math.min(room, [0, 0, 0, 1, 1, 2][rand(6)]);
          const layers = rows.map((m) => ({ m, ins: false }));
          for (let i = 0; i < k; i++) layers.splice(rand(layers.length + 1), 0, { m: FULL, ins: true });
          const T = layers.map((l) => l.m);
          const inserted = layers.map((l, i) => (l.ins ? i : -1)).filter((i) => i >= 0);
          const TB = rowsToBoard(T);
          const cands = [];
          for (const type of TYPES) {
            if (usedInBag.has(type)) continue;
            for (let rot = 0; rot < (type === 'O' ? 1 : 4); rot++) {
              for (let x = -3; x < W; x++) {
                for (let y = H - T.length - 4; y < H; y++) {
                  const cells = cellsOf({ type, rot, x, y });
                  if (!cells.every(([cx, cy]) => cx >= 0 && cx < W && cy >= 0 && cy < H && TB.get(cx, cy))) continue;
                  const rowsHit = new Set(cells.map((c) => H - 1 - c[1]));
                  if (inserted.every((r) => rowsHit.has(r))) cands.push({ type, rot, x, y, cells });
                }
              }
            }
          }
          shuffle(cands);
          // Prefer placements with nothing above them (natural drops) over tucks.
          const surf = (b, c) => c.cells.every(([cx, cy]) => { for (let r = cy - 1; r >= 0; r--) if (b.get(cx, r)) return false; return true; });
          let tries = 0;
          for (const c of cands) {
            const SB = TB.clone();
            for (const [cx, cy] of c.cells) SB.set(cx, cy, 0);
            if (SB.fits(c.type, c.rot, c.x, c.y + 1)) continue;
            if (!surf(SB, c) && Math.random() < 0.85) continue;
            const nextRows = boardToRows(SB);
            if (nextRows.some((m) => m === 0)) continue; // no floating layers
            if (++tries > 12) break;
            const res = TW.Search.search(SB, c.type);
            const pl = res.placements.find((p) => p.x === c.x && p.y === c.y && p.rot === c.rot);
            if (!pl) continue;
            steps.unshift({ type: c.type, rot: c.rot, x: c.x, y: c.y, path: res.pathTo(pl) });
            usedInBag.add(c.type);
            rows = nextRows;
            done = true;
            break;
          }
        }
        if (!done) ok = false;
      }
      if (!ok || rows.length === 0) continue;
      if (goal.height === 4 && rows.length < 2) continue;
      return { board: colorize(rowsToBoard(rows), H), queue: steps.map((s) => s.type), solution: steps, attempts: attempt + 1 };
    }
    return null;
  }

  // ---------- Hold shuffles ----------

  // With one hold slot, can `queue` be played so the pieces are placed in `order`?
  // Returns, for each placement, whether hold is pressed right before it, or null.
  function holdPlan(queue, order) {
    const after = (qi, hold) => (qi < queue.length ? [queue[qi], qi + 1, hold] : [hold, qi, null]);
    function rec(k, cur, qi, hold) {
      if (k === order.length) return [];
      const want = order[k];
      if (cur === want) {
        const r = rec(k + 1, ...after(qi, hold));
        if (r) return [false, ...r];
      }
      if (!cur) return null;
      let next = hold, nq = qi;
      if (!hold) { if (qi >= queue.length) return null; next = queue[qi]; nq = qi + 1; }
      if (next === want) {
        const r = rec(k + 1, ...after(nq, cur));
        if (r) return [true, ...r];
      }
      return null;
    }
    return rec(0, queue[0], 1, null);
  }

  // Is there a perfect clear for `queue` played in order without hold? true / false, or null when the
  // search budget runs out.
  function pcWithoutHold(board, queue, height, budget) {
    let nodes = 0;
    const failed = new Set();
    function dfs(b, i) {
      if (i >= queue.length) return false;
      const key = i + '|' + b.toRows().join('');
      if (failed.has(key)) return false;
      if (++nodes > budget) throw dfs;
      for (const pl of TW.Search.search(b, queue[i]).placements) {
        const nb = b.clone();
        nb.place(pl);
        nb.clearLines();
        if (nb.isEmpty()) return true;
        const h = nb.stackHeight();
        if (h > height) continue;
        let filled = 0;
        for (let y = H - h; y < H; y++) for (let x = 0; x < W; x++) if (nb.get(x, y)) filled++;
        if (filled + 4 * (queue.length - i - 1) < W * h) continue; // not enough pieces left to fill the stack
        if (dfs(nb, i + 1)) return true;
      }
      failed.add(key);
      return false;
    }
    try { return dfs(board, 0); } catch (e) { if (e === dfs) return null; throw e; }
  }

  // Reorders the queue so the drill needs hold: the solution's placement order only works by holding.
  // Spin drills: the goal piece comes early (it can't spin before the setup is done, so it must be held).
  // Perfect clears: a piece comes early, and a search confirms there is no perfect clear without hold.
  function holdShuffle(drill, goal) {
    const steps = drill.solution;
    const order = steps.map((s) => s.type);
    let queue = null;
    if (goal.kind === 'spin') {
      const n = order.length - 1;
      if (n < 1) return false;
      queue = order.slice(0, n);
      queue.splice(rand(n), 0, goal.piece);
    } else {
      for (let t = 0; t < 8 && !queue; t++) {
        const q = order.slice();
        const from = randInt(1, q.length - 1), to = rand(from);
        q.splice(to, 0, q.splice(from, 1)[0]);
        if (q.join('') === order.join('') || !holdPlan(q, order)) continue;
        if (pcWithoutHold(drill.board, q, goal.height, 1500) === false) queue = q;
      }
      if (!queue) return false;
    }
    const plan = holdPlan(queue, order);
    if (!plan) return false;
    drill.queue = queue;
    drill.solution = [];
    steps.forEach((s, i) => {
      if (plan[i]) drill.solution.push({ hold: true });
      drill.solution.push(s);
    });
    drill.needsHold = true;
    return true;
  }

  // Returns a drill { board, queue, solution, goal, scenario, type, setup } or null.
  // opts: hold (hold allowed), shuffle (chance in % of a queue order that needs hold).
  function generate(scenario, type, setup, opts) {
    if (scenario === 'OP') return TW.Openers.generate(type, !opts || opts.hold !== false);
    const goal = makeGoal(scenario, type);
    let drill;
    if (goal.kind === 'pc') {
      const n = Math.min(setup, MAX_SETUP.pc);
      drill = genPC(goal, 2 + n);
    } else {
      const n = Math.min(setup, MAX_SETUP.spin);
      drill = genFromTemplate(goal, n) || genSpin(goal, n);
    }
    if (!drill) return null;
    const hold = !opts || opts.hold !== false;
    if (hold && opts && opts.shuffle > 0 && Math.random() * 100 < opts.shuffle) holdShuffle(drill, goal);
    return Object.assign(drill, { goal, scenario, type, setup });
  }

  TW.Generator = {
    SCENARIOS, MAX_SETUP, generate, makeGoal, goalMatches,
    // Used by js/wells.js, the debug self-test and tools/mine-wells.js.
    goalPossible, validateSpin, peelSetup, genSpin, buildSpinBoard, removeFloating, holdPlan, pcWithoutHold, holdShuffle,
  };
});
