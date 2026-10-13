// Opener drills. Shapes come from four.lol (decoded fumen diagrams). An opener is a list of phases:
// each phase builds a structure (one piece per letter) and then optionally finishes with a spin
// or a perfect clear. Queues are 7-bag orders that a solver has verified can build the opener.
// Every opener can also be played mirrored.
TW.module(function (TW) {
  'use strict';

  const { W, H } = TW.Board;
  const { TYPES, TYPE_ID, cellsOf } = TW.Pieces;
  const ALL = TYPES;

  const TSS = { piece: 'T', spin: 'full', lines: 1, text: 'T-Spin Single' };
  const TSD = { piece: 'T', spin: 'full', lines: 2, text: 'T-Spin Double' };
  const TST = { piece: 'T', spin: 'full', lines: 3, text: 'T-Spin Triple' };

  // rows: top to bottom, aligned to the floor. X = already on the board.
  //   Uppercase letter: key piece (the spin well, overhangs); it must go exactly there.
  //   Lowercase letter: filler, shown at a suggested spot. Fillers can be placed in any order.
  // In the last building phase (only the spin finisher follows) fillers can go anywhere: the player only has to
  // keep the spin possible, e.g. fill the rows a TSD clears. In earlier phases the next phase builds on the
  // exact shape, so fillers must cover the lowercase cells, in any arrangement.
  // A piece off the shape doesn't fail the drill by itself: the opener goes on "off the shape", where only the
  // spins (or the perfect clear) count, until the rest of the queue can't make them anymore (see toLoose).
  // stage: the phase's name in the Start select (default "Bag n").
  const OPENERS = {
    tki: {
      name: 'TKI',
      source: 'https://four.lol/openers/tki',
      phases: [
        {
          label: 'Build the TKI shape, then T-Spin Double',
          bag: ALL,
          rows: [
            '.......j..',
            'L..ZZ.sjjj',
            'L...ZZssoo',
            'LL.IIIIsoo',
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
            '....t.....',
            '...ttti...',
            '....ssizz.',
            'oo.sslijzz',
            'oo.lllijjj',
          ],
        },
        {
          label: 'Bag 2: build the cannon, then T-Spin Double',
          bag: ALL,
          rows: [
            '..LL....ss',
            '...LZZ.ssi',
            'JJ.LXZZooi',
            'J..XXXXooi',
            'J...XXXXXi',
            'XX.XXXXXXX',
            'XX.XXXXXXX',
          ],
          finisher: TSD,
        },
        {
          label: 'Finish with the T-Spin Triple',
          stage: 'T-Spin Triple',
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
            'i....ZZ...',
            'i.JJJZ....',
            'iLLLJoo.ss',
            'iL...ooss.',
          ],
          finisher: TSS,
        },
        {
          label: 'Bag 2: build the TST slot, then T-Spin Triple',
          bag: ALL,
          rows: [
            'JJ.....i..',
            'J....SSioo',
            'J.ZZSSXioo',
            'X..ZZXXill',
            'X.XXXXXXXl',
            'XX...XXXXl',
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
            'lll.....ss',
            'loo....sst',
            'joo...zztt',
            'jjj....zzt',
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
            's.....z..i',
            'ss...zz..i',
            'js...zlooi',
            'jjj.lllooi',
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

  // Mirrored opener: rows reversed, S <-> Z and L <-> J (both cases).
  const SWAP = { S: 'Z', Z: 'S', L: 'J', J: 'L', s: 'z', z: 's', l: 'j', j: 'l' };
  function mirrorOpener(op) {
    return Object.assign({}, op, {
      mirrored: true,
      phases: op.phases.map((ph) => Object.assign({}, ph, {
        rows: ph.rows.map((r) => r.split('').reverse().map((c) => SWAP[c] || c).join('')),
      })),
    });
  }
  const mirrors = {};
  // side: 'n' (as on four.lol) or 'm' (mirrored).
  function get(id, side) {
    const op = OPENERS[id];
    if (!op || side !== 'm') return op;
    return mirrors[id] || (mirrors[id] = mirrorOpener(op));
  }

  // Phase k, computed once per opener and side:
  //   targets: key pieces (type -> { cells, key }); suggest: filler types -> suggested cells;
  //   free: fillers may go anywhere (last building phase with a spin finisher), otherwise they must fill `zone`;
  //   top: highest row fillers may use; slot: the finisher's cells, which must stay empty;
  //   need: cells the finisher's line clear needs filled (used to prune the solver);
  //   cells: all the shape's cells (off the shape, placements there are tried first);
  //   looseTop: highest row a piece may use off the shape; pcH: height of a perfect clear right after this phase.
  const shapeCache = new WeakMap();
  function phaseShape(op, k) {
    if (!shapeCache.has(op)) shapeCache.set(op, []);
    const cache = shapeCache.get(op);
    if (cache[k]) return cache[k];
    const ph = op.phases[k];
    const targets = new Map(), suggest = new Map(), zone = new Set(), slot = new Set(), need = new Set(), cells = new Set();
    let free = false, top = 0;
    if (ph && ph.rows.length) {
      top = H - ph.rows.length;
      const full = new TW.Board();
      ph.rows.forEach((row, i) => {
        for (let x = 0; x < W; x++) {
          const ch = row[x], up = ch.toUpperCase(), y = top + i;
          if (ch !== '.') full.set(x, y, 1);
          if (!TYPES.includes(up)) continue;
          cells.add(y * W + x);
          const map = ch === up ? targets : suggest;
          if (!map.has(up)) map.set(up, []);
          map.get(up).push([x, y]);
          if (ch !== up) zone.add(y * W + x);
        }
      });
      const f = ph.finisher;
      free = !!(f && !f.pc) && op.phases.slice(k + 1).every((p) => !p.rows.length);
      if (free) {
        // The finisher's slot in the finished shape (only when there is exactly one).
        const goal = { kind: 'spin', ...f };
        const hits = TW.Search.search(full, f.piece).placements.filter((p) => TW.Generator.goalMatches(goal, p.type, p.spin, p.lines));
        if (new Set(hits.map((p) => cellKey(cellsOf(p)))).size === 1) {
          const cells = cellsOf(hits[0]);
          for (const [x, y] of cells) slot.add(y * W + x);
          const b = full.clone();
          b.place(hits[0]);
          for (const y of new Set(cells.map((c) => c[1]))) {
            if (b.rowFull(y)) for (let x = 0; x < W; x++) if (!slot.has(y * W + x)) need.add(y * W + x);
          }
        }
        top = Math.max(0, top - 2); // a little room above the shape
      }
    }
    for (const [t, c] of targets) targets.set(t, { cells: c, key: cellKey(c) });
    const next = op.phases.slice(k + 1).find((p) => p.rows.length || p.finisher);
    const pcH = ph && !ph.finisher && next && !next.rows.length && next.finisher.pc || 0;
    const ref = op.phases.slice(0, k + 1).reverse().find((p) => p.rows.length); // a phase without rows: the last shape
    const looseTop = pcH ? H - pcH : H - (ref ? ref.rows.length : 4) - 2;
    return (cache[k] = { targets, suggest, zone, free, top, slot, need, cells, looseTop, pcH });
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

  // Progress through an opener: phase k, key pieces still to place, filler types still to place, the phase's
  // shape (see phaseShape), and the lines left for a perfect clear finisher.
  function initState(op, k, loose) {
    const ph = op.phases[k];
    const shape = phaseShape(op, k);
    const st = {
      k, shape, targets: new Map(shape.targets), fillers: new Set(shape.suggest.keys()), suggest: shape.suggest,
      pcLeft: ph && ph.finisher && ph.finisher.pc ? ph.finisher.pc : 0, loose: false,
    };
    return loose ? toLoose(st) : st;
  }

  // Off the shape: the phase's remaining pieces can go anywhere (below looseTop, without clearing lines), and so
  // can the later phases' pieces. Only the finishers (spins, perfect clear) still have to work.
  function toLoose(st) {
    st.loose = true;
    for (const t of st.targets.keys()) st.fillers.add(t);
    st.targets = new Map();
    return st;
  }

  function copyState(st) {
    return Object.assign({}, st, { targets: new Map(st.targets), fillers: new Set(st.fillers) });
  }

  const building = (st) => st.targets.size > 0 || st.fillers.size > 0;
  // Why a filler can't go there, or null.
  function fillerError(op, st, type, cells) {
    const sh = st.shape;
    if (st.loose) return cells.some((c) => c[1] < sh.looseTop) ? 'That ' + type + ' is too high for ' + op.name : null;
    if (!sh.free) return cells.every(([x, y]) => sh.zone.has(y * W + x)) ? null : 'That ' + type + ' is outside the ' + op.name + ' shape';
    if (cells.some(([x, y]) => sh.slot.has(y * W + x))) return 'That ' + type + ' fills the ' + op.phases[st.k].finisher.text + ' slot';
    if (cells.some((c) => c[1] < sh.top)) return 'That ' + type + ' is too high for ' + op.name;
    return null;
  }

  // Can the remaining fillers still fill the cells the finisher's line clear needs?
  function needsCoverable(st, board) {
    const sh = st.shape;
    if (!sh.need.size || st.loose) return true;
    const keyCells = new Set();
    for (const t of st.targets.values()) for (const [x, y] of t.cells) keyCells.add(y * W + x);
    let open = 0;
    for (const i of sh.need) if (!board.get(i % W, Math.floor(i / W)) && !keyCells.has(i)) open++;
    return open <= 4 * st.fillers.size;
  }

  // Advances past phases that are already complete (structure placed and no finisher).
  function settle(op, st) {
    while (st.k < op.phases.length && !building(st) && !op.phases[st.k].finisher) {
      Object.assign(st, initState(op, st.k + 1, st.loose));
    }
    return st;
  }

  // Is this the phase's spin finisher, made before the shape is done?
  function earlyFinisher(ph, st, type) {
    const f = ph.finisher;
    return !!f && !f.pc && f.piece === type && !st.targets.has(type) && !st.fillers.has(type);
  }

  // Applies a lock to opener progress. Returns { error } | { done } | {} and mutates st. A piece off the shape
  // switches to off-the-shape progress (st.loose) instead of an error.
  function applyLock(op, st, board, type, cells, spin, lines) {
    const ph = op.phases[st.k];
    if (building(st) && earlyFinisher(ph, st, type)) {
      if (!TW.Generator.goalMatches({ kind: 'spin', ...ph.finisher }, type, spin, lines)) return { error: 'Keep the ' + type + ' for the ' + ph.finisher.text };
      // The spin before the shape is done: the phase's other pieces carry over to the next phase, off the shape.
      const left = [...st.targets.keys(), ...st.fillers];
      Object.assign(st, initState(op, st.k + 1, true));
      for (const t of left) st.fillers.add(t);
    } else if (building(st)) {
      const t = st.targets.get(type);
      if (t && t.key === cellKey(cells)) {
        st.targets.delete(type);
        st.keyHits = (st.keyHits || 0) + 1;
      } else if (t || st.fillers.has(type)) {
        if (t || fillerError(op, st, type, cells)) toLoose(st);
        const err = fillerError(op, st, type, cells);
        if (err) return { error: err };
        st.fillers.delete(type);
      } else {
        return { error: 'The ' + type + ' is not part of this ' + op.name + ' step' };
      }
      if (lines) return { error: 'Unexpected line clear' };
    } else if (ph.finisher && ph.finisher.pc) {
      st.pcLeft -= lines;
      if (!board.isEmpty()) {
        if (board.stackHeight() > st.pcLeft) return { error: 'Stack went above the perfect clear line' };
        return {};
      }
      Object.assign(st, initState(op, st.k + 1, st.loose));
    } else if (ph.finisher) {
      if (!TW.Generator.goalMatches({ kind: 'spin', ...ph.finisher }, type, spin, lines)) {
        const got = TW.Spin.describe(type, spin, lines);
        return { error: (got ? got + ' — ' : '') + 'needed ' + ph.finisher.text };
      }
      Object.assign(st, initState(op, st.k + 1, st.loose));
    }
    settle(op, st);
    return st.k >= op.phases.length ? { done: true } : {};
  }

  // ---------- Solver ----------

  const BUDGET = {};

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Depth-first search for a way to finish the opener from `init`:
  // { board, st, cur, queue (pieces after cur), hold, holdUsed }. Returns { ok, actions } (ok null = budget hit).
  // opts: budget, hold (allowed), random (try placements in random order), strict (fillers only on their
  // suggested spots: much faster, used to verify generated queues).
  function solve(op, init, opts) {
    const budget = (opts && opts.budget) || 20000;
    const allowHold = !opts || opts.hold !== false;
    const random = !!(opts && opts.random);
    const strict = !!(opts && opts.strict);
    const failed = new Set();
    const cache = new Map();
    let nodes = 0;

    const search = (b, type) => {
      const key = boardKey(b) + type;
      let r = cache.get(key);
      if (!r) { r = TW.Search.search(b, type); cache.set(key, r); }
      return r;
    };

    // Placements with distinct cells that pass `keep`.
    function distinct(res, keep) {
      const out = [];
      const seen = new Set();
      for (const pl of res.placements) {
        const cells = cellsOf(pl);
        const k = cellKey(cells);
        if (seen.has(k) || !keep(pl, cells)) continue;
        seen.add(k);
        out.push({ pl, res });
      }
      return random ? shuffle(out) : out;
    }

    function options(n) {
      const ph = op.phases[n.st.k];
      const res = search(n.board, n.cur);
      if (building(n.st) && earlyFinisher(ph, n.st, n.cur)) {
        if (strict) return [];
        const pl = res.placements.find((p) => TW.Generator.goalMatches({ kind: 'spin', ...ph.finisher }, p.type, p.spin, p.lines));
        return pl ? [{ pl, res }] : [];
      }
      if (building(n.st) && n.st.loose) {
        if (!n.st.fillers.has(n.cur)) return [];
        const sh = n.st.shape;
        const out = distinct(res, (pl, cells) => {
          if (pl.lines || fillerError(op, n.st, pl.type, cells)) return false;
          if (!sh.pcH) return true;
          const b = n.board.clone();
          b.place(pl);
          return pcPrune(b, sh.pcH);
        });
        // Placements on the shape's cells first, then low ones.
        const score = (o) => cellsOf(o.pl).reduce((s, [x, y]) => s + (sh.cells.has(y * W + x) ? 100 : 0) + y, 0);
        return random ? out : out.sort((a, b) => score(b) - score(a));
      }
      if (building(n.st)) {
        const t = n.st.targets.get(n.cur);
        if (t) {
          const pl = res.placements.find((p) => p.lines === 0 && cellKey(cellsOf(p)) === t.key);
          return pl ? [{ pl, res }] : [];
        }
        if (!n.st.fillers.has(n.cur)) return [];
        // The suggested spot first: when it still works, the search finds a solution right away.
        const spot = cellKey(n.st.suggest.get(n.cur));
        const out = distinct(res, (pl, cells) => pl.lines === 0 && (strict ? cellKey(cells) === spot : !fillerError(op, n.st, pl.type, cells)));
        const i = out.findIndex((o) => cellKey(cellsOf(o.pl)) === spot);
        if (i > 0) out.unshift(out.splice(i, 1)[0]);
        return out;
      }
      const f = ph.finisher;
      if (f.pc) {
        return distinct(res, (pl) => {
          const b = n.board.clone();
          b.place(pl);
          const lines = b.clearLines();
          return b.isEmpty() || pcPrune(b, n.st.pcLeft - lines);
        });
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
      const key = n.st.k + (n.st.loose ? 'L' : '') + '|' + [...n.st.targets.keys()].join('') + '/' + [...n.st.fillers].join('') + '|' + n.st.pcLeft +
        '|' + n.cur + n.hold + (n.holdUsed ? 1 : 0) + '|' + n.queue.join('') + '|' + boardKey(n.board);
      if (failed.has(key)) return null;
      if (building(n.st) && !needsCoverable(n.st, n.board)) { failed.add(key); return null; }
      for (const { pl, res } of options(n)) {
        const board = n.board.clone();
        const cells = cellsOf(pl);
        board.place(pl);
        const lines = board.clearLines();
        const st = copyState(n.st);
        const r = applyLock(op, st, board, pl.type, cells, pl.spin, lines);
        if (r.error) continue;
        const step = { type: pl.type, rot: pl.rot, x: pl.x, y: pl.y, path: res.pathTo(pl), phase: n.st.k };
        if (r.done) return [step];
        const rest = dfs(next(n, board, st, n.hold));
        if (rest) return [step, ...rest];
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

  // Where an opener drill can start (the `setup` key of opener drills): each phase, with the earlier ones already
  // built, then for PC openers the last 3 / 2 / 1 pieces of the perfect clear.
  function stages(id) {
    const op = OPENERS[id];
    if (!op) return [];
    const out = op.phases.map((ph, k) => ph.stage || 'Bag ' + (k + 1));
    if (PC_OPENERS.includes(id)) out.push('Last 3 pieces', 'Last 2 pieces', 'Last piece');
    return out;
  }

  // Replays a solution from the empty board up to phase k: the board then and the pieces still to come (a held
  // piece first, so it is the first one to play or hold).
  function replayTo(queue, actions, k) {
    const board = new TW.Board();
    let i = 0, cur = queue[i++], hold = null;
    for (const a of actions) {
      if (!a.hold && a.phase >= k) break;
      if (a.hold) {
        if (hold) [cur, hold] = [hold, cur];
        else { hold = cur; cur = queue[i++]; }
        continue;
      }
      board.place(a);
      board.clearLines();
      if (i < queue.length) cur = queue[i++];
      else { cur = hold; hold = null; }
    }
    return { board, queue: [hold, cur].filter(Boolean).concat(queue.slice(i)) };
  }

  // The finishers still to make, as text: "T-Spin Double, then T-Spin Triple" (only the next one with `next`).
  function finishersLeft(op, st, next) {
    const texts = op.phases.slice(st.k).filter((ph) => ph.finisher).map((ph) => ph.finisher.text);
    return next ? texts[0] || '' : texts.join(', then ');
  }

  // The opener up to its next finisher from phase k. Off the shape, the next spin is checked on its own: the
  // player gets to make it even when a later one is no longer possible.
  const truncated = new WeakMap();
  function untilNextFinisher(op, k) {
    let j = op.phases.findIndex((ph, i) => i >= k && ph.finisher);
    if (j < 0 || j === op.phases.length - 1) return op;
    if (!truncated.has(op)) truncated.set(op, []);
    const cache = truncated.get(op);
    return cache[j] || (cache[j] = Object.assign({}, op, { phases: op.phases.slice(0, j + 1) }));
  }

  // Returns a drill with a 7-bag queue that can build the opener on both sides, or null. Without hold such
  // queues are rare, so a queue that works on the normal side only is the fallback.
  // The recorded solution (hints, walkthrough) is for the normal side.
  // stage > 0 (see stages): the earlier phases are already built, on a random side.
  function generate(id, allowHold, stage) {
    const op = get(id, 'n');
    if (!op) return null;
    stage = stage | 0;
    const build = (o, queue) => solve(o, { board: new TW.Board(), st: settle(o, initState(o, 0)), cur: queue[0], queue: queue.slice(1), hold: null, holdUsed: false },
      { budget: 6000, hold: allowHold, strict: true });
    if (stage >= op.phases.length) {
      const d = genPCOpener(id, op.phases.length + 2 - stage, Math.random() < 0.5 ? 'n' : 'm');
      return d && Object.assign(d, { scenario: 'OP', type: id, setup: stage });
    }
    if (stage > 0) {
      const side = Math.random() < 0.5 ? 'n' : 'm';
      const o = get(id, side);
      for (let attempt = 0; attempt < 300; attempt++) {
        const queue = [].concat(...o.phases.map((ph) => shuffle(ph.bag.slice())));
        const r = build(o, queue);
        if (!r.ok) continue;
        const at = replayTo(queue, r.actions, stage);
        const st = settle(o, initState(o, stage));
        const r2 = solve(o, { board: at.board, st, cur: at.queue[0], queue: at.queue.slice(1), hold: null, holdUsed: false },
          { budget: 6000, hold: allowHold, strict: true });
        if (!r2.ok) continue;
        return {
          board: at.board, queue: at.queue, solution: r2.actions, goal: { kind: 'opener', text: o.name }, opener: o, side,
          start: stage, scenario: 'OP', type: id, setup: stage, attempts: attempt + 1,
        };
      }
      return null;
    }
    const drill = (queue, r, attempts) => ({
      board: new TW.Board(), queue, solution: r.actions, goal: { kind: 'opener', text: op.name }, opener: op, side: 'n',
      scenario: 'OP', type: id, setup: 0, attempts,
    });
    let fallback = null;
    for (let attempt = 0; attempt < 300; attempt++) {
      const queue = [].concat(...op.phases.map((ph) => shuffle(ph.bag.slice())));
      const r = build(op, queue);
      if (!r.ok) continue;
      if (build(get(id, 'm'), queue).ok) return drill(queue, r, attempt + 1);
      fallback = fallback || drill(queue, r, attempt + 1);
    }
    return fallback;
  }

  // ---------- Perfect clear openers ----------

  const PC_OPENERS = ['pco', 'mko'];

  // The finished first-bag shape, then the last setupN + 1 pieces of a second-bag perfect clear to place.
  // The solver picks the solution from a random second bag, so all the usual solutions come up.
  function genPCOpener(id, setupN, side) {
    const op = get(id, side);
    if (!op) return null;
    const k = op.phases.findIndex((ph) => ph.finisher && ph.finisher.pc);
    const shape = op.phases[0];
    const board = new TW.Board();
    const top = H - shape.rows.length;
    const used = new Set();
    shape.rows.forEach((row, i) => {
      for (let x = 0; x < W; x++) {
        const t = row[x].toUpperCase();
        if (TYPE_ID[t]) { board.set(x, top + i, TYPE_ID[t]); used.add(t); }
      }
    });
    const kept = TYPES.filter((t) => !used.has(t)); // held through the first bag
    for (let attempt = 0; attempt < 40; attempt++) {
      const queue = kept.concat(shuffle(TYPES.slice()));
      const st = initState(op, k);
      const r = solve(op, { board, st, cur: queue[0], queue: queue.slice(1), hold: null, holdUsed: false }, { budget: 3000, hold: true, random: true });
      if (!r.ok) continue;
      const steps = r.actions.filter((a) => !a.hold);
      const pre = steps.length - (setupN + 1);
      if (pre < 0) continue;
      const b = board.clone();
      let height = st.pcLeft;
      for (const s of steps.slice(0, pre)) { b.place(s); height -= b.clearLines(); }
      const rest = steps.slice(pre);
      return {
        board: b,
        queue: rest.map((s) => s.type),
        solution: rest,
        goal: { kind: 'pc', height, text: 'Perfect Clear (' + op.name + ')' },
        well: { id: id + (op.mirrored ? '-m' : ''), name: op.name + (op.mirrored ? ' (mirrored)' : '') },
        side: op.mirrored ? 'm' : 'n',
        attempts: attempt + 1,
      };
    }
    return null;
  }

  TW.Generator.SCENARIOS.OP = { label: 'Opener', types: Object.entries(OPENERS).map(([id, o]) => [id, o.name]) };

  TW.Openers = {
    OPENERS, get, initState, copyState, settle, toLoose, applyLock, solve, generate, genPCOpener, stages, finishersLeft, untilNextFinisher, cellKey, finisherText,
  };
});
