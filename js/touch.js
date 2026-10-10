// Touch controls on the play area (#stage: the whole screen under the toolbar on phones).
//
// One finger at a time; every touch is one Gesture. It can move the piece sideways, soft drop it, hold it,
// rotate it (a tap) and finally hard drop it (a fast swipe at release). Gesture works in board cells and
// milliseconds and knows nothing about the page: attach() feeds it pointer events and gives it the game
// actions, and tools/test-touch.js feeds it recorded gestures.
//
// The finger's movement is classified as it goes, over its last DIR_CELLS of travel: sideways (within 35° of
// horizontal), down or up (within 35° of vertical), or diagonal. Each kind drives one thing:
//
//   sideways -> moves the piece. The travel is scaled by finger speed: slow drags take touchSlow (1.5) cells
//     per column, fast ones touchFast (0.6), blended in between, so careful short moves land on the right
//     column and a quick sweep crosses the board. Going back after a step takes only REVERSE_CELLS (0.5):
//     an overshoot is quick to fix, and a finger resting near a column edge doesn't make the piece jitter.
//     Sideways movement pauses soft drop, so the piece never falls diagonally.
//     e.g. drag 3 cells right slowly -> 2 columns; then half a cell back -> 1 column back.
//     e.g. sweep 2 cells left in 50 ms -> 3 columns.
//   down -> soft drop, once the finger has gone SOFT_START cells down in a row. It stays on while the finger
//     stays down (like holding the soft drop key) and stops when the finger moves SOFT_STOP cells up from its
//     lowest point. After a sideways pause, moving down again resumes it.
//     e.g. drag down 3 cells and keep the finger there -> the piece falls at soft drop speed until you lift.
//     e.g. drag down to the floor, then right -> the piece slides along the floor under a roof.
//   up -> hold, after HOLD_CELLS cells up in a gesture that hasn't moved or dropped the piece yet.
//   diagonal -> nothing: a slanted drag neither moves nor drops the piece.
//
// Lifting the finger:
//   - without having moved TAP_CELLS, within TAP_MS: a tap -> rotate. The play area is split like a Y around
//     its center: the top sector (within TOP_HALF_ANGLE of straight up) rotates 180°, the lower left one CW,
//     the lower right one CCW (left / right swappable; the 180° sector can be turned off). It happens on
//     release, since only then is it clear the touch wasn't a drag.
//   - during a fast swipe (FLICK_CELLS within FLICK_WINDOW, at FLICK_SPEED or faster):
//       down -> hard drop. Sideways steps made during the swipe are undone first, so it drops where it started.
//       up -> hold (also after sideways moves, e.g. drag right, then swipe up and let go).
//       sideways, with touchWallFlick on -> the piece goes all the way to the wall.
//   - otherwise nothing more: the piece stays where the drag left it.
//   e.g. drag right 2 columns, then swipe down and let go -> hard drop 2 columns to the right.
//
// Also:
//   - The first sideways step after soft drop starts, in a gesture that hadn't moved sideways, needs
//     touchSlideDeadzone extra cells, against accidental moves while dropping.
//   - A gesture that started before the current piece appeared (the last one locked or was held) is ignored
//     until the finger lifts, so a swipe can't also hard drop the next piece.
//   - While a finger is down the game's lock delay waits (game.touching), so there is time to lift and tap a spin.
//   - Vibration for moves, rotations, drops and line clears comes from the game (game.haptic).
(function (TW) {
  'use strict';

  const TAP_MS = 300; // longest touch that still counts as a tap...
  const TAP_CELLS = 0.5; // ...and the farthest it may move
  const TRAIL_MS = 400; // finger path kept for direction, speed and swipe checks
  const DIR_CELLS = 0.35; // path length the movement direction is measured over
  const CONE = 0.7; // tan(35°): movement within 35° of an axis counts as along it
  const SPEED_WINDOW = 60; // ms the sideways speed (for the drag gain) is measured over
  const REVERSE_CELLS = 0.5; // travel back (at slow speed) that undoes the last sideways step
  const SOFT_START = 1; // cells down in a row that start soft drop
  const SOFT_STOP = 1; // cells up from the lowest point that stop it
  const HOLD_CELLS = 1.5; // cells up that hold
  const FLICK_WINDOW = 120; // ms a release swipe is measured over
  const FLICK_CELLS = 2.5; // a down / up swipe covers at least this many cells within the window...
  const WALL_CELLS = 2; // ...a sideways one at least this many...
  const FLICK_SPEED = 0.06; // ...at this speed or faster (cells per ms)
  const TOP_HALF_ANGLE = 60; // degrees: the 180° tap sector spans 60° either side of straight up from the center
  const SRC = 'touch'; // input source id for the held soft drop

  // Which tap sector (dx, dy) from the center of the play area is in: 'top', 'left' or 'right'.
  function tapZone(dx, dy) {
    if (dy < 0 && Math.abs(dx) <= -dy * Math.tan(TOP_HALF_ANGLE * Math.PI / 180)) return 'top';
    return dx < 0 ? 'left' : 'right';
  }

  class Gesture {
    // cfg(): the touch settings (settings.data.controls).
    // env: { shift(d) -> whether the piece moved, press(action), softDrop(on), pieceId() }
    constructor(cfg, env, time, x, y) {
      this.cfg = cfg;
      this.env = env;
      this.t0 = time;
      this.x0 = x;
      this.y0 = y;
      this.trail = [[time, x, y]];
      this.sx = x; // finger x / y up to which sideways / vertical travel has been counted
      this.sy = y;
      this.piece = env.pieceId();
      this.moved = false; // left the tap radius
      this.dir = null; // current movement: 'side' | 'down' | 'up' | 'diag' (null until clear)
      // Sideways: vx is the sideways travel with the speed gain applied, anchor where the last step happened,
      // stepDir that step's direction (0 before the first), dead the extra travel the next step needs.
      this.vx = 0;
      this.anchor = 0;
      this.stepDir = 0;
      this.dead = 0;
      this.steps = []; // [time, direction] of each sideways step
      this.sideSeen = false;
      // Vertical: travel down / up in a row, soft drop engaged (may be paused) and pressed, lowest point.
      this.fall = 0;
      this.rise = 0;
      this.drop = false;
      this.dropSeen = false;
      this.softOn = false;
      this.bottom = y;
      this.held = false;
    }

    get stale() { return this.piece !== this.env.pieceId(); }

    move(time, x, y) {
      if (this.stale) { this.setSoft(false); return; }
      this.trail.push([time, x, y]);
      while (this.trail.length > 1 && time - this.trail[0][0] > TRAIL_MS) this.trail.shift();
      if (Math.hypot(x - this.x0, y - this.y0) >= TAP_CELLS) this.moved = true;
      const dir = this.direction(x, y);
      if (!dir) return;
      this.dir = dir;
      // Sideways movement counts only sideways travel and vertical movement only vertical travel, so drift
      // along the other axis is dropped. Travel while the direction is unclear (the start of a gesture, a
      // corner, a diagonal stretch: up to half a cell) counts for whichever direction comes next.
      let dx = 0, dy = 0;
      if (dir === 'side') { dx = x - this.sx; this.sx = x; this.sy = y; }
      else if (dir !== 'diag') { dy = y - this.sy; this.sy = y; this.sx = x; }
      else {
        this.sx = Math.min(x + 0.5, Math.max(x - 0.5, this.sx));
        this.sy = Math.min(y + 0.5, Math.max(y - 0.5, this.sy));
      }
      if (dir === 'side') this.sideways(time, x, dx);
      this.vertical(dir, y, dy);
    }

    // Direction of the last DIR_CELLS of travel; while the finger is (nearly) still, the previous one.
    direction(x, y) {
      for (let i = this.trail.length - 2; i >= 0; i--) {
        const [, px, py] = this.trail[i];
        const ax = Math.abs(x - px), ay = Math.abs(y - py);
        if (Math.hypot(ax, ay) < DIR_CELLS) continue;
        if (ay <= ax * CONE) return 'side';
        if (ax <= ay * CONE) return y > py ? 'down' : 'up';
        return 'diag';
      }
      return this.dir;
    }

    sideways(time, x, dx) {
      const c = this.cfg();
      this.sideSeen = true;
      this.setSoft(false); // no diagonal falls: soft drop pauses while the finger moves sideways
      this.vx += dx * c.touchSlow / this.cellsPerColumn(this.speed(time, x));
      for (;;) {
        const d = Math.sign(this.vx - this.anchor);
        const need = d === -this.stepDir ? REVERSE_CELLS : c.touchSlow + this.dead;
        if (!d || Math.abs(this.vx - this.anchor) < need) break;
        this.anchor += d * need;
        this.stepDir = d;
        this.dead = 0;
        if (this.env.shift(d)) this.steps.push([time, d]);
      }
    }

    vertical(dir, y, dy) {
      if (dir === 'down') { this.fall += Math.max(0, dy); this.rise = 0; }
      else if (dir === 'up') { this.rise += Math.max(0, -dy); this.fall = 0; }
      else if (dir === 'side') { this.fall = 0; this.rise = 0; }
      if (this.drop) {
        this.bottom = Math.max(this.bottom, y);
        if (y <= this.bottom - SOFT_STOP) { this.drop = false; this.fall = 0; this.setSoft(false); }
        else if (dir === 'down') this.setSoft(true); // resumes after a sideways pause
      } else if (this.fall >= SOFT_START) {
        this.drop = true;
        this.bottom = y;
        this.setSoft(true);
        if (!this.dropSeen && !this.sideSeen) { this.anchor = this.vx; this.stepDir = 0; this.dead = this.cfg().touchSlideDeadzone; }
        this.dropSeen = true;
      }
      if (!this.held && !this.sideSeen && !this.dropSeen && this.rise >= HOLD_CELLS) { this.held = true; this.env.press('hold'); }
    }

    // zone: the tap sector the touch ended in ('top' | 'left' | 'right', see tapZone).
    end(time, x, y, zone) {
      this.setSoft(false);
      if (this.stale) return;
      const c = this.cfg();
      if (!this.moved && time - this.t0 < TAP_MS) {
        if (zone === 'top' && c.touchTap180) this.env.press('rot180');
        else this.env.press((zone === 'right') === c.touchRotateSwap ? 'rotCW' : 'rotCCW');
        return;
      }
      if (c.touchWallFlick) {
        for (const d of [-1, 1]) {
          if (this.swipe(time, x, y, 'x', d, WALL_CELLS, 0.5) === null) continue;
          while (this.env.shift(d));
          return;
        }
      }
      if (!this.held && this.swipe(time, x, y, 'y', -1, FLICK_CELLS) !== null) { this.env.press('hold'); return; }
      const start = this.swipe(time, x, y, 'y', 1, FLICK_CELLS);
      if (start === null) return;
      for (const [t, d] of this.steps.slice().reverse()) {
        if (t < start) break;
        if (!this.env.shift(-d)) break;
      }
      this.env.press('hardDrop');
    }

    cancel() { this.setSoft(false); }

    setSoft(on) {
      if (this.softOn === on) return;
      this.softOn = on;
      this.env.softDrop(on);
    }

    // Sideways finger speed over the last SPEED_WINDOW ms, in cells per second.
    speed(time, x) {
      const i = this.trail.findIndex((q) => time - q[0] <= SPEED_WINDOW);
      const p = this.trail[Math.min(i, this.trail.length - 2)] || this.trail[0];
      return Math.abs(x - p[1]) / Math.max(8, time - p[0]) * 1000;
    }

    // Finger travel per column at this speed: touchSlow for slow drags, touchFast from touchFastSpeed up.
    cellsPerColumn(speed) {
      const c = this.cfg();
      const lo = c.touchFastSpeed * 0.2;
      const k = Math.min(1, Math.max(0, (speed - lo) / (c.touchFastSpeed - lo)));
      return c.touchSlow + (c.touchFast - c.touchSlow) * k * k * (3 - 2 * k);
    }

    // Start time of a fast swipe that ends at (x, y) now, or null: a point of the last FLICK_WINDOW ms at
    // least `dist` cells back along `axis` in direction `dir`, covered at FLICK_SPEED or faster, with at most
    // `ratio` times as much movement across.
    swipe(time, x, y, axis, dir, dist, ratio = Infinity) {
      const p = this.trail.find(([t1, x1, y1]) => {
        if (time - t1 > FLICK_WINDOW) return false;
        const along = dir * (axis === 'x' ? x - x1 : y - y1);
        const across = Math.abs(axis === 'x' ? y - y1 : x - x1);
        return along >= dist && along / Math.max(1, time - t1) >= FLICK_SPEED && across <= along * ratio;
      });
      return p ? p[0] : null;
    }
  }

  // opts: { game, input, settings, cell: () => board cell size in CSS pixels }
  function attach(el, opts) {
    const { game, input, settings } = opts;
    const cfg = () => settings.data.controls;
    const env = {
      shift: (d) => game.touchShift(d),
      press: (a) => input.onPress(a),
      softDrop: (on) => (on ? input.press('softDrop', SRC) : input.release('softDrop', SRC)),
      pieceId: () => game.pieceId,
    };
    let g = null, id = null; // the gesture being tracked and its pointer
    const pos = (e) => [e.clientX / opts.cell(), e.clientY / opts.cell()];

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || g || !input.enabled) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      g = new Gesture(cfg, env, e.timeStamp, ...pos(e));
      id = e.pointerId;
      game.touching = true;
    });
    el.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== id) return;
      e.preventDefault();
      g.move(e.timeStamp, ...pos(e));
    });
    const end = (e, cancelled) => {
      if (!g || e.pointerId !== id) return;
      const gesture = g;
      g = null;
      game.touching = false;
      if (cancelled) gesture.cancel();
      else {
        const r = el.getBoundingClientRect();
        gesture.end(e.timeStamp, ...pos(e), tapZone(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)));
      }
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    // Older iOS ignores touch-action for some gestures: keep the page from scrolling or zooming here.
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  // Short description for the keys panel.
  function help(settings) {
    const s = settings.data.controls;
    return 'Touch: drag ←/→ move (slow = precise) · drag ↓ and hold: soft drop · swipe ↓ and let go: hard drop · swipe ↑ hold (or swipe ↑ and let go after dragging ←/→)' +
      (s.touchWallFlick ? ' · flick ←/→ and let go: to the wall' : '') +
      ' · tap lower left / lower right' + (s.touchTap180 ? ' / top' : '') + ': rotate ' + (s.touchRotateSwap ? 'CCW / CW' : 'CW / CCW') +
      (s.touchTap180 ? ' / 180°' : '');
  }

  TW.Touch = { attach, help, Gesture, tapZone };
})(window.TW);
