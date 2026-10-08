// Interactive solution walkthrough: turns a drill's stored solution into captioned animation frames.
// Rotation frames explain kicks and why a spin counts (T corners / immobility).
(function (TW) {
  'use strict';

  const DIR = { CW: 1, CCW: -1, 180: 2 };
  const ROT_NAME = { CW: 'Rotate clockwise', CCW: 'Rotate counter-clockwise', 180: 'Rotate 180°' };

  function kickText([dx, dy]) {
    if (!dx && !dy) return '';
    const parts = [];
    if (dx) parts.push(Math.abs(dx) + ' ' + (dx > 0 ? 'right' : 'left'));
    if (dy) parts.push(Math.abs(dy) + ' ' + (dy > 0 ? 'down' : 'up'));
    return ' — the wall kick shifts it ' + parts.join(' and ');
  }

  function tCorners(board, p) {
    return TW.Pieces.T_CORNERS.map((c) => ({
      x: p.x + c.x, y: p.y + c.y,
      filled: board.blocked(p.x + c.x, p.y + c.y),
      front: c.front.includes(p.rot),
    }));
  }

  function spinText(board, p, spin, tstKick) {
    if (spin === 'none') return '';
    if (p.type === 'T') {
      const cs = tCorners(board, p);
      const filled = cs.filter((c) => c.filled).length;
      const front = cs.filter((c) => c.filled && c.front).length;
      if (spin === 'full' && front < 2) return '. T-SPIN: ' + filled + ' corners filled, and the TST/fin kick upgrades it to a full T-spin';
      if (spin === 'full') return '. T-SPIN: ' + filled + ' of 4 corners filled, including both front corners';
      if (filled >= 3) return '. MINI T-SPIN: ' + filled + ' corners filled but only ' + front + ' front corner';
      return '. MINI T-SPIN: the T can\'t move left, right or up after rotating';
    }
    return '. ' + p.type + '-SPIN: the piece can\'t move left, right or up after rotating (all-spin rule)';
  }

  // Returns [{ board, piece, hold, queue, caption, dur, marks }].
  function buildFrames(drill) {
    const frames = [];
    const b = drill.board.clone();
    let queue = drill.queue.slice();
    let cur = queue.shift();
    let hold = null;
    const total = drill.solution.filter((a) => !a.hold).length;
    const push = (piece, caption, dur, marks) => frames.push({
      board: b.clone(), piece: piece ? { ...piece } : null, hold, queue: queue.slice(), caption, dur, marks: marks || null,
    });

    let n = 0;
    let p = TW.Search.spawnPiece(b, cur);
    push(p, 'Goal: ' + drill.goal.text + '. Use ← / → to step, Space to play or pause.', 1500);
    for (const a of drill.solution) {
      if (a.hold) {
        if (hold) { const t = hold; hold = cur; cur = t; }
        else { hold = cur; cur = queue.shift(); }
        p = TW.Search.spawnPiece(b, cur);
        push(p, 'Hold — the ' + hold + ' waits in the hold box for later', 900);
        continue;
      }
      n++;
      p = TW.Search.spawnPiece(b, cur);
      push(p, 'Piece ' + n + ' of ' + total + ': ' + cur, 600);
      let spin = 'none';
      for (const op of a.path) {
        if (op === 'HD') {
          let moved = false;
          while (b.fits(p.type, p.rot, p.x, p.y + 1)) { p = { ...p, y: p.y + 1 }; moved = true; }
          if (moved) spin = 'none';
          b.place(p);
          const lines = b.clearLines();
          const name = TW.Spin.describe(p.type, spin, lines) + (lines && b.isEmpty() ? ' — PERFECT CLEAR' : '');
          push(null, name ? 'Hard drop → ' + name : 'Hard drop', name ? 1600 : 500);
          break;
        }
        if (DIR[op] !== undefined) {
          const r = TW.SRS.tryRotate(b, p, DIR[op]);
          p = { type: r.type, rot: r.rot, x: r.x, y: r.y };
          spin = TW.Spin.detect(b, p, r.tstKick);
          const marks = spin !== 'none' && p.type === 'T' ? tCorners(b, p) : null;
          const legend = marks ? ' (markers: yellow = front corner, blue = back corner, red = empty)' : '';
          push(p, ROT_NAME[op] + kickText(r.kick) + spinText(b, p, spin, r.tstKick) + legend, spin !== 'none' ? 2600 : 700, marks);
        } else {
          p = TW.Search.applyOp(b, p, op).piece;
          spin = 'none';
          const cap = { L: 'Move left', R: 'Move right', SD: 'Soft drop to the bottom', D: 'Soft drop one row' }[op];
          push(p, cap, op === 'SD' ? 450 : op === 'D' ? 220 : 160);
        }
      }
      if (queue.length) cur = queue.shift();
      else if (hold) { cur = hold; hold = null; }
      else cur = null;
    }
    frames[frames.length - 1].dur = 2500;
    return frames;
  }

  TW.Demo = { buildFrames };
})(window.TW);
