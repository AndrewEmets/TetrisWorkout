// Opener drills. Shapes come from four.lol (decoded fumen diagrams). An opener is a list of phases:
// each phase builds a fixed structure (one piece per letter) and then optionally finishes with a spin
// or a perfect clear. Queues are 7-bag orders that a solver has verified can build the opener.
TW.module(function (TW) {
  'use strict';

  const { W, H } = TW.Board;
  const { TYPES, cellsOf } = TW.Pieces;
  const ALL = TYPES;

  const TSS = { piece: 'T', spin: 'full', lines: 1, text: 'T-Spin Single' };
  const TSD = { piece: 'T', spin: 'full', lines: 2, text: 'T-Spin Double' };
  const TST = { piece: 'T', spin: 'full', lines: 3, text: 'T-Spin Triple' };

  // rows: top to bottom, aligned to the floor. Letters = pieces placed in this phase, X = already on the board.
  const OPENERS = {
    tki: {
      name: 'TKI',
      source: 'https://four.lol/openers/tki',
      phases: [
        {
          label: 'Build the TKI shape, then T-Spin Double',
          bag: ALL,
          rows: [
            '.......J..',
            'L..ZZ.SJJJ',
            'L...ZZSSOO',
            'LL.IIIISOO',
          ],
          finisher: TSD,
        },
      ],
    },
    dt: {
      name: 'DT Cannon',
      source: 'https://four.lol/methods/dt-cannon',
      phases: [
        {
          label: 'Bag 1: build the base',
          bag: ALL,
          rows: [
            '....T.....',
            '...TTTI...',
            '....SSIZZ.',
            'OO.SSLIJZZ',
            'OO.LLLIJJJ',
          ],
        },
        {
          label: 'Bag 2: build the cannon, then T-Spin Double',
          bag: ALL,
          rows: [
            '..LL....SS',
            '...LZZ.SSI',
            'JJ.LXZZOOI',
            'J..XXXXOOI',
            'J...XXXXXI',
            'XX.XXXXXXX',
            'XX.XXXXXXX',
          ],
          finisher: TSD,
        },
        {
          label: 'Finish with the T-Spin Triple',
          bag: ['T'],
          rows: [],
          finisher: TST,
        },
      ],
    },
    hachispin: {
      name: 'Hachispin',
      source: 'https://four.lol/openers/hachispin',
      phases: [
        {
          label: 'Bag 1: build the shape, then T-Spin Single',
          bag: ALL,
          rows: [
            '......Z...',
            'I....ZZ...',
            'I.JJJZ....',
            'ILLLJOO.SS',
            'IL...OOSS.',
          ],
          finisher: TSS,
        },
        {
          label: 'Bag 2: build the TST slot, then T-Spin Triple',
          bag: ALL,
          rows: [
            'JJ.....I..',
            'J....SSIOO',
            'J.ZZSSXIOO',
            'X..ZZXXILL',
            'X.XXXXXXXL',
            'XX...XXXXL',
          ],
          finisher: TST,
        },
      ],
    },
    pco: {
      name: 'PCO',
      source: 'https://four.lol/perfect-clears/opener',
      phases: [
        {
          label: 'Bag 1: build the PCO shape (keep the I)',
          bag: ALL,
          rows: [
            'LLL.....SS',
            'LOO....SST',
            'JOO...ZZTT',
            'JJJ....ZZT',
          ],
        },
        {
          label: 'Bag 2: perfect clear',
          bag: ALL,
          rows: [],
          finisher: { pc: 4, text: 'Perfect Clear' },
        },
      ],
    },
    mko: {
      name: 'MKO',
      source: 'https://four.lol/openers/mko',
      phases: [
        {
          label: 'Bag 1: build the MKO shape (keep the T)',
          bag: ALL,
          rows: [
            'S.....Z..I',
            'SS...ZZ..I',
            'JS...ZLOOI',
            'JJJ.LLLOOI',
          ],
        },
        {
          label: 'Bag 2: perfect clear',
          bag: ALL,
          rows: [],
          finisher: { pc: 4, text: 'Perfect Clear' },
        },
      ],
    },
  };

  // ---------- Helpers ----------

  const cellKey = (cells) => cells.map(([x, y]) => y * W + x).sort((a, b) => a - b).join(',');

  // Map type -> { key, cells } of the pieces placed in phase k (absolute board coordinates).
  function phaseTargets(op, k) {
    const ph = op.phases[k];
    const targets = new Map();
    if (!ph) return targets;
    const top = H - ph.rows.length;
    ph.rows.forEach((row, i) => {
      for (let x = 0; x < W; x++) {
        const ch = row[x];
        if (!TYPES.includes(ch)) continue;
        if (!targets.has(ch)) targets.set(ch, { cells: [] });
        targets.get(ch).cells.push([x, top + i]);
      }
    });
    for (const t of targets.values()) t.key = cellKey(t.cells);
    return targets;
  }

  function finisherText(f) { return f ? f.text : ''; }

  function boardKey(b) {
    let s = '';
    for (let y = H - 1; y >= 0; y--) {
      if (b.rowEmpty(y)) break;
      let m = 0;
      for (let x = 0; x < W; x++) if (b.get(x, y)) m |= 1 << x;
      s += m + ',';
    }
    return s;
  }

  // Every empty region inside the bottom h rows must be fillable by whole tetrominoes (size % 4 === 0).
  function pcPrune(b, h) {
    if (b.stackHeight() > h) return false;
    const seen = new Uint8Array(W * H);
    for (let y = H - h; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (b.get(x, y) || seen[y * W + x]) continue;
        let size = 0;
        const stack = [[x, y]];
        seen[y * W + x] = 1;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          size++;
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (nx < 0 || nx >= W || ny < H - h || ny >= H || seen[ny * W + nx] || b.get(nx, ny)) continue;
            seen[ny * W + nx] = 1;
            stack.push([nx, ny]);
          }
        }
        if (size % 4) return false;
      }
    }
    return true;
  }

  function initState(op, k) {
    const ph = op.phases[k];
    return { k, targets: phaseTargets(op, k), pcLeft: ph && ph.finisher && ph.finisher.pc ? ph.finisher.pc : 0 };
  }

  // Advances past phases that are already complete (structure placed and no finisher).
  function settle(op, st) {
    while (st.k < op.phases.length && st.targets.size === 0 && !op.phases[st.k].finisher) {
      Object.assign(st, initState(op, st.k + 1));
    }
    return st;
  }

  // Applies a lock to opener progress. Returns { error } | { done } | {} and mutates st.
  function applyLock(op, st, board, type, cells, spin, lines) {
    const ph = op.phases[st.k];
    if (st.targets.size) {
      const t = st.targets.get(type);
      if (!t || t.key !== cellKey(cells)) return { error: 'That ' + type + ' is not part of the ' + op.name + ' shape' };
      if (lines) return { error: 'Unexpected line clear' };
      st.targets.delete(type);
    } else if (ph.finisher && ph.finisher.pc) {
      st.pcLeft -= lines;
      if (!board.isEmpty()) {
        if (board.stackHeight() > st.pcLeft) return { error: 'Stack went above the perfect clear line' };
        return {};
      }
      Object.assign(st, initState(op, st.k + 1));
    } else if (ph.finisher) {
      if (!TW.Generator.goalMatches({ kind: 'spin', ...ph.finisher }, type, spin, lines)) {
        const got = TW.Spin.describe(type, spin, lines);
        return { error: (got ? got + ' — ' : '') + 'needed ' + ph.finisher.text };
      }
      Object.assign(st, initState(op, st.k + 1));
    }
    settle(op, st);
    return st.k >= op.phases.length ? { done: true } : {};
  }

  // ---------- Solver ----------

  const BUDGET = {};

  // Depth-first search for a way to finish the opener from `init`:
  // { board, st, cur, queue (pieces after cur), hold, holdUsed }. Returns { ok, actions } (ok null = budget hit).
  function solve(op, init, opts) {
    const budget = (opts && opts.budget) || 20000;
    const allowHold = !opts || opts.hold !== false;
    const failed = new Set();
    const cache = new Map();
    let nodes = 0;

    const search = (b, type) => {
      const key = boardKey(b) + type;
      let r = cache.get(key);
      if (!r) { r = TW.Search.search(b, type); cache.set(key, r); }
      return r;
    };

    function options(n) {
      const ph = op.phases[n.st.k];
      const res = search(n.board, n.cur);
      if (n.st.targets.size) {
        const t = n.st.targets.get(n.cur);
        if (!t) return [];
        const pl = res.placements.find((p) => p.lines === 0 && cellKey(cellsOf(p)) === t.key);
        return pl ? [{ pl, res }] : [];
      }
      const f = ph.finisher;
      if (f.pc) {
        const out = [];
        const seen = new Set();
        for (const pl of res.placements) {
          const k = cellKey(cellsOf(pl));
          if (seen.has(k)) continue;
          seen.add(k);
          const b = n.board.clone();
          b.place(pl);
          const lines = b.clearLines();
          if (!b.isEmpty() && !pcPrune(b, n.st.pcLeft - lines)) continue;
          out.push({ pl, res });
        }
        return out;
      }
      if (n.cur !== f.piece) return [];
      const pl = res.placements.find((p) => TW.Generator.goalMatches({ kind: 'spin', ...f }, p.type, p.spin, p.lines));
      return pl ? [{ pl, res }] : [];
    }

    function next(n, board, st, hold) {
      let cur = null, queue = n.queue;
      if (queue.length) { cur = queue[0]; queue = queue.slice(1); }
      else if (hold) { cur = hold; hold = null; }
      return { board, st, cur, queue, hold, holdUsed: false };
    }

    function dfs(n) {
      if (n.st.k >= op.phases.length) return [];
      if (!n.cur) return null;
      if (++nodes > budget) throw BUDGET;
      const key = n.st.k + '|' + [...n.st.targets.keys()].join('') + '|' + n.st.pcLeft + '|' + n.cur + n.hold + (n.holdUsed ? 1 : 0) + '|' + n.queue.join('') + '|' + boardKey(n.board);
      if (failed.has(key)) return null;
      for (const { pl, res } of options(n)) {
        const board = n.board.clone();
        const cells = cellsOf(pl);
        board.place(pl);
        const lines = board.clearLines();
        const st = { k: n.st.k, targets: new Map(n.st.targets), pcLeft: n.st.pcLeft };
        const r = applyLock(op, st, board, pl.type, cells, pl.spin, lines);
        if (r.error) continue;
        if (r.done) return [{ type: pl.type, rot: pl.rot, x: pl.x, y: pl.y, path: res.pathTo(pl) }];
        const rest = dfs(next(n, board, st, n.hold));
        if (rest) return [{ type: pl.type, rot: pl.rot, x: pl.x, y: pl.y, path: res.pathTo(pl) }, ...rest];
      }
      if (allowHold && !n.holdUsed) {
        let h;
        if (n.hold) h = { ...n, cur: n.hold, hold: n.cur, holdUsed: true };
        else if (n.queue.length) h = { ...n, cur: n.queue[0], queue: n.queue.slice(1), hold: n.cur, holdUsed: true };
        if (h) {
          const rest = dfs(h);
          if (rest) return [{ hold: true }, ...rest];
        }
      }
      failed.add(key);
      return null;
    }

    try {
      const actions = dfs(init);
      return { ok: !!actions, actions };
    } catch (e) {
      if (e === BUDGET) return { ok: null, actions: null };
      throw e;
    }
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Returns a drill with a solvable 7-bag queue, or null.
  function generate(id, allowHold) {
    const op = OPENERS[id];
    if (!op) return null;
    for (let attempt = 0; attempt < 300; attempt++) {
      const queue = [].concat(...op.phases.map((ph) => shuffle(ph.bag.slice())));
      const st = settle(op, initState(op, 0));
      const r = solve(op, { board: new TW.Board(), st, cur: queue[0], queue: queue.slice(1), hold: null, holdUsed: false }, { budget: 6000, hold: allowHold });
      if (!r.ok) continue;
      return {
        board: new TW.Board(),
        queue,
        solution: r.actions,
        goal: { kind: 'opener', text: op.name },
        opener: op,
        scenario: 'OP',
        type: id,
        setup: 0,
        attempts: attempt + 1,
      };
    }
    return null;
  }

  TW.Generator.SCENARIOS.OP = { label: 'Opener', types: Object.entries(OPENERS).map(([id, o]) => [id, o.name]) };
  TW.Generator.MAX_SETUP.op = 0;

  TW.Openers = { OPENERS, phaseTargets, initState, settle, applyLock, solve, generate, cellKey, finisherText };
});
