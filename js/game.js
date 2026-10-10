// Game state machine: drill loop, piece control with TETR.IO-style handling, lock/clear and drill evaluation.
(function (TW) {
  'use strict';

  const FRAME = 1000 / 60;
  const STATS_KEY = 'tetris-workout-stats';
  const MARATHON_KEY = 'tetris-workout-marathon';
  const PREVIEW = 5; // next pieces shown in endless modes

  // Guideline scoring (multiplied by the level): plain clears, T-spins and mini / all-spins by lines cleared,
  // perfect clear bonus. Back-to-back quads and spins get x1.5; combos add 50 x combo x level.
  const SCORE_LINES = [0, 100, 300, 500, 800];
  const SCORE_SPIN = [400, 800, 1200, 1600, 1600];
  const SCORE_MINI = [100, 200, 400, 800, 800];
  const SCORE_PC = [0, 800, 1200, 1800, 2000];

  // Vibration patterns (ms on / off) for piece actions; line clears buzz once per line.
  const HAPTICS = {
    move: 6, rotate: 10, hold: [10, 40, 10], soft: 8, land: 12, lock: 15, hardDrop: 25,
    pc: [60, 40, 60, 40, 140],
  };
  // Phones and tablets that can vibrate (Android; iOS doesn't let web pages vibrate).
  const CAN_VIBRATE = typeof navigator !== 'undefined' && !!navigator.vibrate &&
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  function loadMarathon() {
    try {
      const s = JSON.parse(localStorage.getItem(MARATHON_KEY));
      if (s && typeof s === 'object') return s;
    } catch (e) { /* ignore */ }
    return {};
  }

  function shuffled(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem(STATS_KEY));
      if (s && s.per) return s;
    } catch (e) { /* ignore */ }
    return { attempts: 0, successes: 0, streak: 0, best: 0, per: {} };
  }

  class Game {
    constructor(settings, input) {
      this.settings = settings;
      this.input = input;
      this.drill = null;
      this.gen = new TW.GenService();
      this.pending = null; // { key, promise, drill } — the next drill, generated in the background
      this.history = []; // drills played so far (most recent last)
      this.histPos = -1; // index of the current drill in history
      this.genToken = 0;
      this.phase = 'idle';
      this.flash = null;
      this.lastClear = null;
      this.board = new TW.Board();
      this.queue = [];
      this.hold = null;
      this.holdUsed = false;
      this.piece = null;
      this.spin = 'none';
      this.dir = 0;
      this.dasCharge = 0;
      this.arrAcc = 0;
      this.hintVisible = false;
      this.stale = new Set(); // actions held from before the current piece appeared: ignored until released
      this.pieceId = 0; // counts spawned pieces (touch gestures that started before a new piece are dropped)
      this.touching = false; // a finger is on the play area
      this.stats = loadStats();
      this.marathonStats = loadMarathon(); // best results per marathon config: { games, score, lines, time }
      this.mara = null; // marathon run in progress: level, lines, score, ...
      this.changed = true; // tells the UI to refresh the info panel
      input.onPress = (a) => this.onPress(a);
      input.onRelease = (a) => this.onRelease(a);
    }

    get h() { return this.settings.data.handling; }
    get g() { return this.settings.data.game; }

    // ---------- Drill lifecycle ----------

    currentKey() {
      const s = this.settings.data.drill;
      if (s.scenario === 'MA') return 'MA|' + this.marathonKey();
      return s.scenario + '|' + s.type + '|' + s.setup;
    }

    drillKey(d) { return d.scenario + '|' + d.type + '|' + d.setup; }

    // Marathon options that make a different game (and keep a separate best score).
    marathonKey() {
      const m = this.settings.data.marathon;
      return [m.lines, m.startLevel, m.garbage, m.garbage ? m.holes : 0].join('|');
    }

    get marathon() { return !!this.drill && this.drill.goal.kind === 'marathon'; }

    // Next pieces shown: all of a drill's queue, a few in endless modes.
    get preview() { return this.marathon ? PREVIEW : 6; }

    // Gravity in cells per frame: the marathon level's, otherwise the setting.
    get gravity() {
      if (!this.mara) return this.g.gravity;
      return Game.levelGravity(this.settings.data.marathon, this.mara.level);
    }

    spec() {
      const s = this.settings.data.drill;
      return { scenario: s.scenario, type: s.type, setup: s.setup, hold: this.g.hold, shuffle: this.g.hold ? this.g.holdShuffle : 0 };
    }

    // Starts generating the next drill for the current selection (unless already ready or running).
    prefetch() {
      if (this.settings.data.drill.scenario === 'MA') return null;
      const spec = this.spec();
      const key = TW.genKey(spec);
      if (this.pending && this.pending.key === key) return this.pending;
      const entry = { key, drill: undefined };
      entry.promise = this.gen.generate(spec).then((d) => { entry.drill = d; return d; });
      this.pending = entry;
      return entry;
    }

    // Index of the nearest history entry for the current drill selection in direction dir (-1 / +1), or -1.
    historyIndex(dir) {
      const key = this.currentKey();
      for (let i = this.histPos + dir; i >= 0 && i < this.history.length; i += dir) {
        if (this.drillKey(this.history[i]) === key) return i;
      }
      return -1;
    }

    hasPrev() { return this.historyIndex(-1) >= 0; }

    // Plays a specific drill (e.g. a favorite) and keeps it in history.
    loadDrill(d) {
      ++this.genToken;
      this.setDrill(d);
      if (this.gen.background) this.prefetch();
    }

    // Goes back to the previous board of the same drill.
    prevDrill() {
      const i = this.historyIndex(-1);
      if (i < 0) return;
      ++this.genToken;
      this.histPos = i;
      this.setDrill(this.history[i], true);
    }

    // Next board: steps forward through history after going back, otherwise a freshly generated one.
    newDrill() {
      const token = ++this.genToken;
      this.piece = null;
      if (this.settings.data.drill.scenario === 'MA') { this.startMarathon(); return; }
      const fwd = this.historyIndex(1);
      if (fwd >= 0) {
        this.histPos = fwd;
        this.setDrill(this.history[fwd], true);
        return;
      }
      const entry = this.prefetch();
      this.pending = null;
      if (entry.drill !== undefined) { this.useDrill(entry.drill); return; }
      this.phase = 'generating';
      this.flash = { text: 'Generating…', color: '#9aa0aa' };
      this.changed = true;
      entry.promise.then((d) => { if (token === this.genToken) this.useDrill(d); });
    }

    useDrill(d) {
      if (!d) {
        this.phase = 'idle';
        this.flash = { text: 'No board found', sub: 'Try another drill or fewer setup pieces', color: '#e05050' };
        this.changed = true;
        return;
      }
      this.setDrill(d);
      // With a worker the next board is generated right away; otherwise only during the success pause.
      if (this.gen.background) this.prefetch();
    }

    setDrill(d, fromHistory) {
      this.drill = d;
      if (!fromHistory) {
        this.history.push(d);
        if (this.history.length > 100) this.history.shift();
        this.histPos = this.history.length - 1;
      }
      // Board before each solution step, used to decide whether the hint still applies.
      const b = d.board.clone();
      d.placements = d.solution.filter((a) => !a.hold);
      d.expected = [b.clone()];
      for (const step of d.placements) {
        b.place(step);
        b.clearLines();
        d.expected.push(b.clone());
      }
      this.hintVisible = false;
      this.startAttempt();
    }

    startAttempt() {
      if (!this.drill) return;
      this.demo = null;
      this.mara = null;
      if (this.marathon) { this.startMarathonRun(); return; }
      // Openers count on either side: one progress state per side that still fits, the drill's own side first.
      const d = this.drill;
      this.ops = d.opener
        ? [d.opener, TW.Openers.get(d.type, d.side === 'm' ? 'n' : 'm')].map((op) => ({ op, st: TW.Openers.settle(op, TW.Openers.initState(op, 0)) }))
        : null;
      this.hintCache = null;
      this.board = this.drill.board.clone();
      this.queue = this.drill.queue.slice();
      this.hold = null;
      this.locks = 0;
      this.hintUsed = this.hintVisible;
      this.phase = 'play';
      this.flash = null;
      this.lastClear = null;
      this.changed = true;
      this.spawnNext();
    }

    // Debug: play a custom board with the currently selected drill goal.
    loadCustom(board, queue) {
      const s = this.settings.data.drill;
      const opener = s.scenario === 'OP' ? TW.Openers.get(s.type, 'n') : null;
      const goal = opener ? { kind: 'opener', text: opener.name } : TW.Generator.makeGoal(s.scenario, s.type);
      this.genToken++;
      this.setDrill({ board, queue, solution: [], goal, opener, scenario: s.scenario, type: s.type, setup: s.setup });
    }

    success(name, sub) {
      this.phase = 'result';
      this.resultNext = 'new';
      this.resultTimer = this.g.successDelay;
      this.flash = { text: name, sub: this.hintUsed ? 'cleared with hint' : sub || 'Nice!', color: '#58c45a' };
      this.record(true);
      this.prefetch(); // no-op when the next drill is already ready or being generated
    }

    fail(reason) {
      this.phase = 'result';
      this.resultNext = 'retry';
      this.resultTimer = this.g.failDelay;
      this.flash = { text: 'MISS', sub: reason, color: '#e05050' };
      this.piece = null;
      this.record(false);
    }

    record(ok) {
      const st = this.stats;
      const key = this.drillKey(this.drill);
      const per = st.per[key] || (st.per[key] = { a: 0, s: 0 });
      st.attempts++; per.a++;
      if (ok) { st.successes++; per.s++; }
      if (ok && !this.hintUsed) st.streak++;
      else if (!ok) st.streak = 0;
      st.best = Math.max(st.best, st.streak);
      try { localStorage.setItem(STATS_KEY, JSON.stringify(st)); } catch (e) { /* ignore */ }
      this.changed = true;
    }

    resetStats() {
      this.stats = { attempts: 0, successes: 0, streak: 0, best: 0, per: {} };
      try { localStorage.removeItem(STATS_KEY); } catch (e) { /* ignore */ }
      this.changed = true;
    }

    // ---------- Pieces ----------

    spawnNext() {
      this.holdUsed = false;
      if (this.queue.length) this.spawn(this.queue.shift());
      else if (this.hold) { const t = this.hold; this.hold = null; this.spawn(t); }
    }

    spawn(type) {
      if (this.mara) this.fillQueue();
      const p = TW.Search.spawnPiece(this.board, type);
      this.changed = true;
      if (!p) { if (this.mara) this.marathonOver(false, 'Top out'); else this.fail('Top out'); return; }
      this.piece = p;
      this.pieceId++;
      // Input from the previous piece doesn't move or drop this one: held keys need a new press.
      if (!this.h.carryInput) {
        for (const a of ['left', 'right', 'softDrop']) if (this.input.isHeld(a)) this.stale.add(a);
        this.dir = 0;
        this.dasCharge = 0;
        this.arrAcc = 0;
      }
      this.spin = 'none';
      this.lockTimer = 0;
      this.lockResets = 0;
      this.lowestY = p.y;
      this.gravAcc = 0;
      this.softAcc = 0;
      this.guardUntil = performance.now() + this.h.hardDropGuard * FRAME;
      if (this.h.ihs === 'hold' && this.input.isHeld('hold') && this.canHold()) { this.doHold(); return; }
      if (this.h.irs === 'hold') {
        if (this.input.isHeld('rot180')) this.rotate(2);
        else if (this.input.isHeld('rotCW')) this.rotate(1);
        else if (this.input.isHeld('rotCCW')) this.rotate(-1);
      }
      this.applyDCD();
    }

    canHold() {
      return this.g.hold && !this.holdUsed && this.piece && (this.hold || this.queue.length);
    }

    doHold() {
      if (!this.canHold()) return;
      const cur = this.piece.type;
      const next = this.hold || this.queue.shift();
      this.hold = cur;
      this.holdUsed = true;
      this.haptic('hold');
      this.spawn(next);
    }

    // Vibrates for a piece action (touch devices, when enabled in Settings -> Touch).
    haptic(kind, lines) {
      if (!CAN_VIBRATE || !this.settings.data.controls.touchVibrate) return;
      let p = HAPTICS[kind];
      if (kind === 'clear') p = [].concat(...Array.from({ length: lines }, (_, i) => (i ? [40, 30] : [30])));
      try { navigator.vibrate(p); } catch (e) { /* not allowed yet */ }
    }

    grounded() {
      const p = this.piece;
      return !this.board.fits(p.type, p.rot, p.x, p.y + 1);
    }

    lockReset() {
      if (this.gravity > 0 && this.grounded() && this.lockResets < this.g.lockResets) {
        this.lockTimer = 0;
        this.lockResets++;
      }
    }

    move(d) {
      const p = this.piece;
      if (!p || !this.board.fits(p.type, p.rot, p.x + d, p.y)) return false;
      p.x += d;
      this.spin = 'none';
      this.lockReset();
      this.haptic('move');
      return true;
    }

    stepDown() {
      const p = this.piece;
      if (!p || !this.board.fits(p.type, p.rot, p.x, p.y + 1)) return false;
      p.y++;
      this.spin = 'none';
      if (p.y > this.lowestY) { this.lowestY = p.y; this.lockResets = 0; this.lockTimer = 0; }
      if (this.grounded()) this.haptic('land');
      return true;
    }

    rotate(dir) {
      const r = TW.SRS.tryRotate(this.board, this.piece, dir);
      if (!r) return false;
      this.piece = { type: r.type, rot: r.rot, x: r.x, y: r.y };
      this.spin = TW.Spin.detect(this.board, this.piece, r.tstKick);
      if (r.y > this.lowestY) { this.lowestY = r.y; this.lockResets = 0; }
      this.lockReset();
      this.applyDCD();
      this.haptic('rotate');
      return true;
    }

    // DAS cut delay: after a rotation or a new piece, a charged DAS waits `dcd` frames before shifting again.
    applyDCD() {
      if (!this.dir || this.h.dcd <= 0) return;
      const target = Math.max(0, (this.h.das - this.h.dcd) * FRAME);
      if (this.dasCharge > target) { this.dasCharge = target; this.arrAcc = 0; }
    }

    hardDrop() {
      let moved = 0;
      while (this.board.fits(this.piece.type, this.piece.rot, this.piece.x, this.piece.y + 1)) { this.piece.y++; moved++; }
      if (moved) this.spin = 'none';
      if (this.mara) this.mara.score += 2 * moved;
      this.lockPiece(true);
    }

    lockPiece(hard) {
      const p = this.piece;
      const spin = this.spin;
      const cells = TW.Pieces.cellsOf(p);
      this.piece = null;
      this.board.place(p);
      const lines = this.board.clearLines();
      this.locks++;
      this.changed = true;
      const pc = this.board.isEmpty();
      if (pc) this.haptic('pc');
      else if (lines) this.haptic('clear', lines);
      else this.haptic(hard ? 'hardDrop' : 'lock');
      const name = TW.Spin.describe(p.type, spin, lines);
      this.lastClear = { text: pc ? (name ? name + ' + PC' : 'PERFECT CLEAR') : name, t: performance.now() };

      const goal = this.drill.goal;
      if (goal.kind === 'marathon') return this.marathonLock(p, spin, lines, pc);
      if (goal.kind === 'opener') return this.openerLock(p, cells, spin, lines, name);
      if (goal.kind === 'pc') {
        if (pc) return this.success('PERFECT CLEAR');
        if (this.board.stackHeight() > goal.height) return this.fail('Stack went above ' + goal.height + ' lines');
      } else if (TW.Generator.goalMatches(goal, p.type, spin, lines)) {
        return this.success(name);
      }

      const remaining = this.queue.concat(this.hold ? [this.hold] : []);
      if (!remaining.length) {
        if (goal.kind === 'pc') return this.fail('Out of pieces');
        return this.fail(name ? name + ' — needed ' + goal.text : 'Needed ' + goal.text);
      }
      if (goal.kind === 'spin') {
        if (!remaining.includes(goal.piece)) return this.fail((name ? name + ' — ' : '') + 'needed ' + goal.text);
        if (remaining.length === 1) {
          const res = TW.Search.search(this.board, goal.piece);
          if (!res.placements.some((pl) => TW.Generator.goalMatches(goal, pl.type, pl.spin, pl.lines))) {
            return this.fail('Setup broken — ' + goal.text + ' no longer possible');
          }
        }
      }
      this.spawnNext();
    }

    // ---------- Marathon ----------

    startMarathon() {
      const m = this.settings.data.marathon;
      const text = 'Marathon' + (m.lines ? ' · ' + m.lines + ' lines' : ' · endless');
      this.drill = { scenario: 'MA', type: 'marathon', setup: 0, goal: { kind: 'marathon', text }, board: new TW.Board(), queue: [], solution: [], placements: [], expected: [] };
      this.hintVisible = false;
      this.startAttempt();
    }

    startMarathonRun() {
      const m = this.settings.data.marathon;
      this.ops = null;
      this.mara = {
        key: this.marathonKey(), target: m.lines, startLevel: m.startLevel, level: m.startLevel, lines: 0, score: 0,
        pieces: 0, time: 0, combo: -1, b2b: false, garbage: m.garbage, holes: Math.min(m.holes, 9),
      };
      this.board = new TW.Board();
      this.addGarbage();
      this.queue = [];
      this.fillQueue();
      this.hold = null;
      this.locks = 0;
      this.hintUsed = false;
      this.phase = 'play';
      this.flash = null;
      this.lastClear = null;
      this.changed = true;
      this.spawnNext();
    }

    // Endless 7-bag queue, always at least a full bag ahead.
    fillQueue() {
      while (this.queue.length < 7) this.queue.push(...shuffled(TW.Pieces.TYPES.slice()));
    }

    // Keeps `garbage` gray rows with random holes on the board, pushing new ones up from the floor.
    // Returns false when that pushes the stack out of the top.
    addGarbage() {
      const m = this.mara;
      if (!m.garbage) return true;
      const { W, H } = TW.Board;
      const cells = this.board.cells, GRAY = TW.Pieces.STACK_ID;
      let have = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) if (cells[y * W + x] === GRAY) { have++; break; }
      }
      const add = m.garbage - have;
      if (add <= 0) return true;
      for (let i = 0; i < add * W; i++) if (cells[i]) return false;
      cells.copyWithin(0, add * W);
      for (let y = H - add; y < H; y++) {
        const holes = new Set(shuffled([...Array(W).keys()]).slice(0, m.holes));
        for (let x = 0; x < W; x++) cells[y * W + x] = holes.has(x) ? 0 : GRAY;
      }
      return true;
    }

    marathonLock(p, spin, lines, pc) {
      const m = this.mara;
      m.pieces++;
      const level = m.level;
      let points = spin === 'full' && p.type === 'T' ? SCORE_SPIN[lines] : spin !== 'none' ? SCORE_MINI[lines] : SCORE_LINES[lines];
      const notes = [];
      if (lines) {
        const hard = lines >= 4 || spin !== 'none';
        if (hard && m.b2b) { points *= 1.5; notes.push('B2B'); }
        m.b2b = hard;
        m.combo++;
        if (m.combo > 0) { points += 50 * m.combo; notes.push(m.combo + ' COMBO'); }
        if (pc) points += SCORE_PC[lines];
      } else {
        m.combo = -1;
      }
      m.score += Math.round(points * level);
      m.lines += lines;
      m.level = m.startLevel + Math.floor(m.lines / this.settings.data.marathon.linesPerLevel);
      if (notes.length && this.lastClear.text) this.lastClear.text += ' · ' + notes.join(' · ');
      if (m.level > level) this.lastClear = { text: 'LEVEL ' + m.level, t: this.lastClear.t };
      if (m.target && m.lines >= m.target) return this.marathonOver(true);
      if (!lines && !this.addGarbage()) return this.marathonOver(false, 'Garbage pushed the stack out');
      this.spawnNext();
    }

    // End of a marathon run: the result stays up until Retry / Next. Keeps the best results per config.
    marathonOver(done, reason) {
      const m = this.mara;
      this.phase = 'over';
      this.piece = null;
      const best = this.marathonStats[m.key] || (this.marathonStats[m.key] = { games: 0, score: 0, lines: 0, time: 0 });
      const newBest = m.score > best.score;
      best.games++;
      best.score = Math.max(best.score, m.score);
      best.lines = Math.max(best.lines, m.lines);
      if (done && (!best.time || m.time < best.time)) best.time = m.time;
      try { localStorage.setItem(MARATHON_KEY, JSON.stringify(this.marathonStats)); } catch (e) { /* ignore */ }
      const sub = m.score.toLocaleString('en-US') + ' points · ' + m.lines + ' lines' + (newBest ? ' · new best!' : '');
      this.flash = done
        ? { text: 'COMPLETE', sub, color: '#58c45a' }
        : { text: 'GAME OVER', sub: (reason ? reason + ' · ' : '') + sub, color: '#e05050' };
      this.changed = true;
    }

    resetMarathonStats() {
      delete this.marathonStats[this.marathonKey()];
      try { localStorage.setItem(MARATHON_KEY, JSON.stringify(this.marathonStats)); } catch (e) { /* ignore */ }
      this.changed = true;
    }

    // Current opener progress (the first side that still fits) and its opener.
    get op() { return this.ops && this.ops.length ? this.ops[0].st : null; }
    get opener() { return this.ops && this.ops.length ? this.ops[0].op : this.drill && this.drill.opener; }

    openerLock(p, cells, spin, lines, name) {
      const name0 = this.ops[0].op.name;
      const live = [];
      let error = null;
      for (const side of this.ops) {
        const st = TW.Openers.copyState(side.st);
        const r = TW.Openers.applyLock(side.op, st, this.board, p.type, cells, spin, lines);
        if (r.error) { error = error || r.error; continue; }
        if (r.done) return this.success(name || name0, name0 + ' complete!');
        live.push({ op: side.op, st });
      }
      if (!live.length) return this.fail(error);
      // The side whose key pieces the player has placed is the one being built: show its outline.
      this.ops = live.sort((a, b) => (b.st.keyHits || 0) - (a.st.keyHits || 0));
      // Fail early when the remaining pieces can no longer finish the opener on any side (small search budget).
      let queue = this.queue.slice(), hold = this.hold, cur = null;
      if (queue.length) cur = queue.shift();
      else if (hold) { cur = hold; hold = null; }
      if (!cur) return this.fail('Out of pieces');
      // Quick check with fillers on their suggested spots, then a small flexible search.
      const solve = (side, strict, budget) => TW.Openers.solve(side.op,
        { board: this.board, st: TW.Openers.copyState(side.st), cur, queue, hold, holdUsed: false }, { budget, strict, hold: this.g.hold }).ok;
      const possible = live.some((side) => solve(side, true, 400)) || live.some((side) => solve(side, false, 150) !== false);
      if (!possible) return this.fail('The rest of the queue can\'t finish ' + name0 + ' from here');
      this.spawnNext();
    }

    // ---------- Solution walkthrough ----------

    startDemo() {
      if (!this.drill || !this.drill.solution.length || this.phase === 'generating') return;
      this.demo = { frames: TW.Demo.buildFrames(this.drill), i: 0, t: 0, playing: true };
      this.phase = 'demo';
      this.flash = null;
      this.lastClear = null;
      this.hintVisible = false;
      this.applyDemoFrame();
    }

    applyDemoFrame() {
      const f = this.demo.frames[this.demo.i];
      this.board = f.board;
      this.piece = f.piece;
      this.hold = f.hold;
      this.queue = f.queue;
      this.changed = true;
    }

    demoStep(d) {
      if (!this.demo) return;
      this.demo.playing = false;
      this.demo.i = Math.max(0, Math.min(this.demo.frames.length - 1, this.demo.i + d));
      this.demo.t = 0;
      this.applyDemoFrame();
    }

    demoToggle() {
      if (!this.demo) return;
      if (!this.demo.playing && this.demo.i === this.demo.frames.length - 1) { this.demo.i = 0; this.applyDemoFrame(); }
      this.demo.playing = !this.demo.playing;
      this.demo.t = 0;
      this.changed = true;
    }

    stopDemo() {
      if (!this.demo) return;
      this.demo = null;
      this.startAttempt();
    }

    demoFrame() { return this.demo ? this.demo.frames[this.demo.i] : null; }

    // Placement the hint shows for the current step, { offScript: true }, or null.
    hint() {
      if (!this.hintVisible || !this.drill || this.phase !== 'play') return null;
      const sol = this.drill.placements;
      if (this.locks < sol.length && this.board.equals(this.drill.expected[this.locks])) return sol[this.locks];
      if (!this.ops || !this.ops.length || !this.piece) return this.locks >= sol.length ? null : { offScript: true };
      // Opener off the recorded solution (fillers can go anywhere): solve again from here.
      const key = this.locks + '|' + this.piece.type + '|' + this.hold + '|' + this.holdUsed;
      if (!this.hintCache || this.hintCache.key !== key) {
        const { op, st } = this.ops[0];
        const solve = (strict, budget) => TW.Openers.solve(op, {
          board: this.board, st: TW.Openers.copyState(st), cur: this.piece.type, queue: this.queue.slice(), hold: this.hold, holdUsed: this.holdUsed,
        }, { budget, strict, hold: this.g.hold });
        let res = solve(true, 400);
        if (!res.ok) res = solve(false, 1500);
        const step = res.ok && res.actions.find((a) => !a.hold);
        this.hintCache = { key, hint: step || { offScript: true } };
      }
      return this.hintCache.hint;
    }

    // ---------- Input ----------

    onPress(a) {
      if (this.phase === 'demo') {
        if (a === 'left' || a === 'rotCCW') this.demoStep(-1);
        else if (a === 'right' || a === 'rotCW') this.demoStep(1);
        else if (a === 'hardDrop' || a === 'hold') this.demoToggle();
        else if (a === 'retry' || a === 'hint') this.stopDemo();
        else if (a === 'skip') this.newDrill();
        else if (a === 'prev') this.prevDrill();
        return;
      }
      if (a === 'retry') { if (this.drill && this.phase !== 'generating') this.startAttempt(); return; }
      if (a === 'skip') { this.newDrill(); return; }
      if (a === 'prev') { this.prevDrill(); return; }
      if (a === 'hint') {
        if (this.marathon) return;
        this.hintVisible = !this.hintVisible;
        this.changed = true;
        if (this.hintVisible && this.phase === 'play') this.hintUsed = true;
        return;
      }
      if (a === 'left' || a === 'right') {
        const d = a === 'left' ? -1 : 1;
        if (this.dir !== d && (this.h.cancelDasOnDirChange || this.dir === 0)) this.dasCharge = 0;
        this.dir = d;
        this.arrAcc = 0;
        if (this.phase === 'play' && this.piece) this.move(d);
        return;
      }
      if (this.phase !== 'play' || !this.piece) return;
      switch (a) {
        case 'rotCW': this.rotate(1); break;
        case 'rotCCW': this.rotate(-1); break;
        case 'rot180': this.rotate(2); break;
        case 'hold': this.doHold(); break;
        case 'hardDrop': if (performance.now() >= this.guardUntil) this.hardDrop(); break;
        case 'softDrop':
          this.haptic('soft');
          if (this.h.sdf >= 41) while (this.stepDown());
          else this.stepDown();
          this.softAcc = 0;
          break;
      }
    }

    // Touch drags: one column per step, no DAS. In the walkthrough a sideways drag steps through it.
    // Returns whether the piece moved.
    touchShift(d) {
      if (this.phase === 'demo') { this.demoStep(d); return false; }
      return this.phase === 'play' && !!this.piece && this.move(d);
    }

    onRelease(a) {
      this.stale.delete(a);
      if (a !== 'left' && a !== 'right') return;
      const d = a === 'left' ? -1 : 1;
      if (this.dir !== d) return;
      const other = d < 0 ? 'right' : 'left';
      if (this.input.isHeld(other) && !this.stale.has(other)) {
        this.dir = -d;
        if (this.h.cancelDasOnDirChange) this.dasCharge = 0;
        this.arrAcc = 0;
      } else {
        this.dir = 0;
        this.dasCharge = 0;
      }
    }

    // ---------- Frame update ----------

    update(dt) {
      if (this.phase === 'demo') {
        const d = this.demo;
        if (!d.playing) return;
        d.t += dt;
        while (d.t >= d.frames[d.i].dur) {
          d.t -= d.frames[d.i].dur;
          if (d.i >= d.frames.length - 1) { d.playing = false; this.changed = true; break; }
          d.i++;
          this.applyDemoFrame();
        }
        return;
      }
      if (this.phase === 'result') {
        this.resultTimer -= dt;
        if (this.resultTimer <= 0) {
          if (this.resultNext === 'new') this.newDrill();
          else this.startAttempt();
        }
        return;
      }
      if (this.phase !== 'play' || !this.piece) return;
      if (this.mara) {
        if (!this.input.enabled || this.menuOpen) return; // paused while a dialog or the phone menu is open
        this.mara.time += dt;
      }
      const sd = this.input.isHeld('softDrop') && !this.stale.has('softDrop');
      if (this.h.preferSoftDrop) { this.updateSoftDrop(dt, sd); this.updateShift(dt); }
      else { this.updateShift(dt); this.updateSoftDrop(dt, sd); }
      if (!this.piece) return;

      const grav = this.gravity;
      if (grav > 0) {
        if (!sd) {
          this.gravAcc += (dt / FRAME) * grav;
          while (this.gravAcc >= 1) {
            this.gravAcc -= 1;
            if (!this.stepDown()) { this.gravAcc = 0; break; }
          }
        }
        // A finger on the screen holds the lock delay: lifting it and tapping a rotation takes a moment.
        if (this.grounded() && !(this.touching && this.settings.data.controls.touchLockPause)) {
          this.lockTimer += dt;
          if (this.lockTimer >= this.g.lockDelay * FRAME) this.lockPiece();
        }
      }
    }

    updateShift(dt) {
      if (!this.dir || !this.piece) return;
      const das = this.h.das * FRAME - 0.01; // tolerance for float accumulation of frame times
      const before = this.dasCharge;
      this.dasCharge += dt;
      if (this.dasCharge < das) return;
      if (this.h.arr <= 0) { while (this.move(this.dir)); return; }
      const arr = this.h.arr * FRAME - 0.01;
      if (before < das) { this.move(this.dir); this.arrAcc = this.dasCharge - das; }
      else this.arrAcc += dt;
      while (this.arrAcc >= arr) {
        this.arrAcc -= arr;
        if (!this.move(this.dir)) { this.arrAcc = 0; break; }
      }
    }

    updateSoftDrop(dt, held) {
      if (!held || !this.piece) { this.softAcc = 0; return; }
      if (this.h.sdf >= 41) { while (this.stepDown()); return; }
      this.softAcc += (dt / FRAME) * this.h.sdf * Math.max(this.gravity, 1 / 12);
      while (this.softAcc >= 1) {
        this.softAcc -= 1;
        if (!this.stepDown()) { this.softAcc = 0; break; }
        if (this.mara) this.mara.score++;
      }
    }
  }

  // Marathon gravity for a level: multiplied by the same factor every level, from gStart at level 1 to gMax
  // at maxLevel (a straight line on a log scale), then stays at gMax.
  Game.levelGravity = (m, level) => {
    const t = Math.min(1, (level - 1) / Math.max(1, m.maxLevel - 1));
    return Math.min(m.gMax, m.gStart * Math.pow(Math.max(m.gMax, m.gStart) / m.gStart, t));
  };

  Game.FRAME = FRAME;
  TW.Game = Game;
})(window.TW);
