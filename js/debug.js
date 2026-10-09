// Debug helpers, available from the browser console as TW.debug.*
(function (TW) {
  'use strict';

  // Replays a drill's stored solution with the game's move/rotate/spin rules. Returns { ok, reason }.
  function replay(drill) {
    const board = drill.board.clone();
    const queue = drill.queue.slice();
    let cur = queue.shift();
    let hold = null;
    const op = drill.opener;
    const st = op ? TW.Openers.settle(op, TW.Openers.initState(op, 0)) : null;
    const placements = drill.solution.filter((a) => !a.hold).length;
    let placed = 0;
    for (const step of drill.solution) {
      if (step.hold) {
        if (hold) [cur, hold] = [hold, cur];
        else { hold = cur; cur = queue.shift(); }
        continue;
      }
      const i = placed++;
      if (step.type !== cur) return { ok: false, reason: 'queue/solution mismatch at step ' + i };
      let p = TW.Search.spawnPiece(board, step.type);
      if (!p) return { ok: false, reason: 'spawn blocked at step ' + i };
      let spin = 'none';
      for (const o of step.path) {
        if (o === 'HD') {
          let moved = false;
          while (board.fits(p.type, p.rot, p.x, p.y + 1)) { p = { ...p, y: p.y + 1 }; moved = true; }
          if (moved) spin = 'none';
          break;
        }
        const r = TW.Search.applyOp(board, p, o);
        if (!r) return { ok: false, reason: 'op ' + o + ' failed at step ' + i };
        p = r.piece;
        spin = r.spin;
      }
      if (p.x !== step.x || p.y !== step.y || p.rot !== step.rot) return { ok: false, reason: 'wrong placement at step ' + i };
      const cells = TW.Pieces.cellsOf(p);
      board.place(p);
      const lines = board.clearLines();
      const last = i === placements - 1;
      if (op) {
        const r = TW.Openers.applyLock(op, st, board, p.type, cells, spin, lines);
        if (r.error) return { ok: false, reason: r.error };
        if (last && !r.done) return { ok: false, reason: 'opener not finished' };
      } else if (drill.goal.kind === 'pc') {
        if (last && !board.isEmpty()) return { ok: false, reason: 'board not empty' };
        if (board.stackHeight() > drill.goal.height) return { ok: false, reason: 'too high at step ' + i };
      } else if (last) {
        if (!TW.Generator.goalMatches(drill.goal, p.type, spin, lines)) {
          return { ok: false, reason: 'goal not met: ' + TW.Spin.describe(p.type, spin, lines) };
        }
      } else if (lines) {
        return { ok: false, reason: 'setup step cleared lines' };
      }
      if (queue.length) cur = queue.shift();
      else if (hold) { cur = hold; hold = null; }
      else cur = null;
    }
    return { ok: true };
  }

  // Spin drills: every setup piece must be needed (no early spin, no hold shortcut). Returns true / false.
  function setupNeeded(drill) {
    if (drill.goal.kind !== 'spin') return true;
    const steps = drill.solution.filter((a) => !a.hold).slice(0, -1);
    const setups = steps.map((st) => ({ type: st.type, cells: TW.Pieces.cellsOf(st) }));
    return !!TW.Generator.validateSpin(drill.board, setups, drill.goal);
  }

  // Generates n drills for every scenario/type/setup combination and replays their solutions.
  // opts.shuffle: chance (%) of queues that need hold, opts.only: scenario keys to test, opts.side: opener side.
  function selfTest(n, setups, opts) {
    n = n || 3;
    setups = setups || [0, 1, 2, 3];
    opts = opts || {};
    const report = [];
    for (const [sc, def] of Object.entries(TW.Generator.SCENARIOS)) {
      if (opts.only && !opts.only.includes(sc)) continue;
      for (const [type] of def.types) {
        for (const setup of sc === 'OP' ? [0] : setups) {
          let ok = 0, fail = 0, gen = 0, ms = 0, tpl = 0, held = 0;
          const errors = [];
          for (let i = 0; i < n; i++) {
            const t0 = performance.now();
            const d = TW.Generator.generate(sc, type, setup, { hold: true, shuffle: opts.shuffle || 0, side: opts.side });
            ms += performance.now() - t0;
            if (!d) { gen++; continue; }
            if (d.well) tpl++;
            if (d.needsHold) held++;
            const r = replay(d);
            if (r.ok && !setupNeeded(d)) { r.ok = false; r.reason = 'setup piece not needed'; }
            if (r.ok) ok++; else { fail++; errors.push(r.reason); }
          }
          report.push({ scenario: sc, type, setup, ok, fail, genFail: gen, template: tpl, needsHold: held, avgMs: Math.round(ms / n), errors: errors.join(' | ') });
        }
      }
    }
    return report;
  }

  // Checks every well template at every setup count: how many random placements work (out of `tries`).
  function checkWells(tries) {
    tries = tries || 5;
    const out = [];
    for (const t of TW.Wells.all()) {
      const goal = { kind: 'spin', piece: t.piece, spin: t.spin, lines: t.lines };
      const row = { id: t.id, piece: t.piece };
      for (let s = 0; s <= t.setupMax; s++) {
        let ok = 0;
        for (let i = 0; i < tries; i++) {
          const e = TW.Wells.embed(t, s);
          if (e && TW.Generator.validateSpin(e.board, e.setups, goal, e.target)) ok++;
        }
        row['setup' + s] = ok + '/' + tries;
      }
      out.push(row);
    }
    return out;
  }

  // Loads a board from rows (top to bottom, letters/'#' = filled) into the running game, with an optional queue.
  function loadBoard(rows, queue) {
    const board = TW.Board.fromRows(rows);
    TW.game.loadCustom(board, typeof queue === 'string' ? queue.split('') : queue || ['T']);
  }

  // Plain-text snapshot of the drill and the current game state, for bug reports.
  function describe(game) {
    const d = game.drill;
    if (!d) return 'No drill loaded.';
    const s = game.settings.data.drill;
    const lines = [];
    lines.push('Tetris Workout — ' + d.goal.text + (d.setup ? ' (setup ' + d.setup + ')' : ''));
    lines.push('drill: ' + JSON.stringify({ scenario: d.scenario, type: d.type, setup: d.setup, well: d.well ? d.well.id : undefined, needsHold: d.needsHold || undefined }));
    if (d.opener) lines.push('opener step: ' + (game.op ? game.op.k + 1 : '?') + ' / ' + d.opener.phases.length + (game.opener && game.opener.mirrored ? ' (mirrored)' : ''));
    lines.push('', 'Start board (queue ' + d.queue.join('') + '):');
    lines.push(...d.board.toLetterRows());
    lines.push('', 'Now (phase ' + game.phase + (game.flash ? ', "' + game.flash.text + (game.flash.sub ? ': ' + game.flash.sub : '') + '"' : '') + '):');
    // Collapse runs of empty rows between the falling piece and the stack.
    let empty = 0;
    for (const row of game.board.toLetterRows(game.piece)) {
      if (row === '..........') { empty++; continue; }
      if (empty) lines.push(empty > 1 ? '.......... (x' + empty + ')' : '..........');
      empty = 0;
      lines.push(row);
    }
    const p = game.piece;
    lines.push('current: ' + (p ? p.type + ' rot ' + p.rot + ' x ' + p.x + ' y ' + p.y + ' spin ' + game.spin : '-') +
      ' | hold: ' + (game.hold || '-') + ' | next: ' + (game.queue.join('') || '-') + ' | locks: ' + (game.locks || 0));
    lines.push('solution: ' + d.solution.map((a) => (a.hold ? 'hold' : a.type + '[' + a.path.join(' ') + ']')).join(', '));
    lines.push('', 'Reload in the console: TW.debug.loadBoard(' + JSON.stringify(d.board.toLetterRows()) + ', ' + JSON.stringify(d.queue.join('')) + ')');
    lines.push('settings: ' + JSON.stringify({ handling: game.settings.data.handling, game: game.settings.data.game }));
    return lines.join('\n');
  }

  TW.debug = { replay, selfTest, setupNeeded, checkWells, loadBoard, describe };
})(window.TW);
