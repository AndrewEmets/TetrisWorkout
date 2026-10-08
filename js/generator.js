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
  //       radius (max distance to the anchor itself), partial (return what was found), tries.
  function decompose(board, n, keepBelowRow, opts) {
    opts = opts || {};
    let cur = board.clone();
    const steps = [];
    const used = new Set(opts.exclude || []);
    const removedCells = [];
    for (let k = 0; k < n; k++) {
      const cands = [];
      if (opts.pieces) {
        for (const pc of opts.pieces) {
          if (used.has(pc.type) || !pc.cells.every(([cx, cy]) => cur.get(cx, cy))) continue;
          let d = 0;
          if (opts.near) {
            d = cellDist(pc.cells, opts.near);
            if (d > opts.radius) continue;
            if (Math.min(d, removedCells.length ? cellDist(pc.cells, removedCells) : Infinity) > opts.reach) continue;
          }
          cands.push({ ...pc, d });
        }
      }
      for (const type of opts.pieces ? [] : TYPES) {
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

  // All fixed tetromino orientations, as offsets from their top-left-most cell (scan order: top row first).
  const ORIENTS = (() => {
    const seen = new Set();
    const out = [];
    for (const type of TYPES) {
      for (let rot = 0; rot < 4; rot++) {
        const cells = SHAPES[type][rot];
        const ax = Math.min(...cells.filter((c) => c[1] === Math.min(...cells.map((d) => d[1]))).map((c) => c[0]));
        const ay = Math.min(...cells.map((c) => c[1]));
        const offs = cells.map(([x, y]) => [x - ax, y - ay]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        const key = type + offs.join(';');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ type, rot, ax, ay, offs });
      }
    }
    return out;
  })();

  // Covers `region` (cell indices y * W + x) with tetrominoes, leaving at most `skips` cells uncovered
  // (only cells farther than 1 from `slot`). Same-type pieces never touch. Returns placements or null.
  function tileRegion(region, limit, skips, slot) {
    const left = new Set(region);
    const order = [...region].sort((a, b) => a - b);
    const out = [];
    const typeAt = new Map();
    const touchesSame = (idx, type) => idx.some((j) => {
      const x = j % W;
      return (x > 0 && typeAt.get(j - 1) === type) || (x < W - 1 && typeAt.get(j + 1) === type) ||
        typeAt.get(j - W) === type || typeAt.get(j + W) === type;
    });
    let nodes = 0;
    const orients = shuffle(ORIENTS.slice());
    function rec(i, skipsLeft) {
      while (i < order.length && !left.has(order[i])) i++;
      if (i >= order.length) return true;
      if (++nodes > limit) return false;
      const c = order[i], cx = c % W, cy = Math.floor(c / W);
      for (const o of orients) {
        const idx = [];
        let ok = true;
        for (const [dx, dy] of o.offs) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || x >= W || !left.has(y * W + x)) { ok = false; break; }
          idx.push(y * W + x);
        }
        if (!ok || touchesSame(idx, o.type)) continue;
        for (const j of idx) { left.delete(j); typeAt.set(j, o.type); }
        out.push({ type: o.type, rot: o.rot, x: cx - o.ax, y: cy - o.ay, cells: idx.map((j) => [j % W, Math.floor(j / W)]) });
        if (rec(i + 1, skipsLeft)) return true;
        out.pop();
        for (const j of idx) { left.add(j); typeAt.delete(j); }
      }
      if (skipsLeft > 0 && cellDist([[cx, cy]], slot) > 1) {
        left.delete(c);
        if (rec(i + 1, skipsLeft - 1)) return true;
        left.add(c);
      }
      return false;
    }
    return rec(0, skips) ? out : null;
  }

  // Splits the stack above the garbage into real pieces with as few leftover (gray) cells as possible.
  function tileStack(board, keepBelowRow, slot) {
    const region = [];
    for (let y = 0; y < keepBelowRow; y++) for (let x = 0; x < W; x++) if (board.get(x, y)) region.push(y * W + x);
    for (let k = region.length % 4; k <= 10; k += 4) {
      const pieces = tileRegion(region, 3000, k, slot);
      if (pieces) return pieces;
    }
    return greedyTile(region, slot);
  }

  // Fallback: random greedy cover (scan order, first fitting piece), best of several runs by
  // covered cells, weighting cells near the slot higher.
  function greedyTile(region, slot) {
    const order = [...region].sort((a, b) => a - b);
    let best = null, bestScore = -1;
    for (let run = 0; run < 24; run++) {
      const left = new Set(region);
      const typeAt = new Map();
      const out = [];
      let score = 0;
      const orients = shuffle(ORIENTS.slice());
      for (const c of order) {
        if (!left.has(c)) continue;
        const cx = c % W, cy = Math.floor(c / W);
        for (const o of orients) {
          const idx = [];
          let ok = true;
          for (const [dx, dy] of o.offs) {
            const x = cx + dx, y = cy + dy;
            if (x < 0 || x >= W || !left.has(y * W + x)) { ok = false; break; }
            idx.push(y * W + x);
          }
          if (!ok) continue;
          const same = idx.some((j) => [j - 1, j + 1, j - W, j + W].some((n) => typeAt.get(n) === o.type && Math.abs((n % W) - (j % W)) <= 1));
          if (same) continue;
          for (const j of idx) { left.delete(j); typeAt.set(j, o.type); }
          const cells = idx.map((j) => [j % W, Math.floor(j / W)]);
          score += 4 + Math.max(0, 3 - cellDist(cells, slot));
          out.push({ type: o.type, rot: o.rot, x: cx - o.ax, y: cy - o.ay, cells });
          break;
        }
      }
      if (score > bestScore) { best = out; bestScore = score; }
    }
    return best;
  }

  function genSpin(goal, setupN) {
    for (let attempt = 0; attempt < 20000; attempt++) {
      const cand = buildSpinBoard(goal, setupN);
      if (!cand) continue;
      const res = TW.Search.search(cand.board, goal.piece);
      const hits = res.placements.filter((p) => goalMatches(goal, p.type, p.spin, p.lines));
      if (!hits.length) continue;
      const hit = hits.find((h) => TW.Search.sameCells(h, cand.target)) || hits[0];
      const goalStep = { type: hit.type, rot: hit.rot, x: hit.x, y: hit.y, path: res.pathTo(hit) };
      const slot = cellsOf(hit);
      const keepBelow = Math.max(...cellsOf(cand.target).map((c) => c[1])) + 1;
      const pieces = tileStack(cand.board, keepBelow, slot);

      // Setup pieces must help build the slot: they touch it, or touch another setup piece close to it.
      // Prefer pieces from the tiling so the colors match how the stack was built.
      const setupOpts = { exclude: [goal.piece], distinct: true, near: slot, reach: 1, radius: 2 };
      let dec = null;
      for (let d = 0; d < 4 && !dec && pieces; d++) dec = decompose(cand.board, setupN, keepBelow, { ...setupOpts, pieces });
      for (let d = 0; d < 3 && !dec; d++) dec = decompose(cand.board, setupN, keepBelow, setupOpts);
      if (!dec) continue;
      let board = dec.board.clone();
      if (pieces) {
        for (const pc of pieces) if (pc.cells.every(([x, y]) => board.get(x, y))) board.place(pc);
      } else {
        board = colorize(board, keepBelow, slot);
      }
      return {
        board,
        queue: [...dec.steps.map((s) => s.type), goal.piece],
        solution: [...dec.steps, goalStep],
        attempts: attempt + 1,
        tiled: !!pieces,
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

  // Returns a drill { board, queue, solution, goal, scenario, type, setup } or null.
  function generate(scenario, type, setup, opts) {
    if (scenario === 'OP') return TW.Openers.generate(type, !opts || opts.hold !== false);
    const goal = makeGoal(scenario, type);
    let drill;
    if (goal.kind === 'pc') {
      const n = Math.min(setup, MAX_SETUP.pc);
      drill = genPC(goal, 2 + n);
    } else {
      drill = genSpin(goal, Math.min(setup, MAX_SETUP.spin));
    }
    if (!drill) return null;
    return Object.assign(drill, { goal, scenario, type, setup });
  }

  TW.Generator = { SCENARIOS, MAX_SETUP, generate, makeGoal, goalMatches };
});
