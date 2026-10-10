// Touch controls on the play area (#stage: the whole screen under the toolbar on phones).
//
// One finger at a time. Every touch is one gesture: it can move the piece sideways, soft drop it, hold it,
// rotate it (a tap) and finally hard drop it (a fast swipe at release). Distances are in board cells (u = one
// cell in CSS px), so the feel is the same on every screen size.
//
// 1. Tap: lift within TAP_MS without moving 0.5 cells -> rotate. Left half of the screen CW, right half CCW
//    (swappable). Rotation happens on release, since only then is it clear the touch wasn't a drag.
//
// 2. Direction lock: the first 0.5 cells of travel decide the gesture's mode.
//    'h' (mostly sideways): a sideways drag. It can still turn into soft drop, hold or hard drop later.
//    'v' (mostly vertical): a drop / hold gesture. Sideways moves start only once soft drop is on (see 4).
//
// 3. Sideways moves. The finger's travel is scaled by its speed (gain) into vx; each time vx is one column
//    (touchSlow cells) away from the last step's anchor x, the piece moves one column. Slow drags take
//    1.5 cells per column, fast ones 0.6 (touchFast at touchFastSpeed), blended in between: careful short
//    moves land on the right column, a quick sweep crosses the board.
//    Going back the other way takes only REVERSE_CELLS (hysteresis): an overshoot is fixed with a small
//    move back, and a finger resting near a column edge doesn't make the piece jitter.
//    Movements that are mostly vertical (|dy| > 2|dx|) don't count, so sideways drift during a drop or
//    hold swipe doesn't move the piece. Each step vibrates on Android (touchVibrate).
//    e.g. drag 3 cells right slowly -> 2 columns; then 0.5 cells back -> 1 column back.
//    e.g. sweep 2 cells left in 50 ms -> 3 columns.
//
// 4. Soft drop: held while the finger stays below the point where the downward drag started, like holding
//    the soft drop key; moving the finger up one cell from its lowest point stops it. It starts after 1 cell
//    of downward travel ('v'), or 1.5 cells of steep downward travel in a sideways drag (drift during a
//    sideways drag resets the count, so a slanted drag doesn't start it).
//    While soft drop is on, sideways moves work too (slide a piece under an overhang without lifting the
//    finger); in a 'v' gesture the first such step needs touchSlideDeadzone extra cells.
//    e.g. drag down 3 cells and keep the finger there -> the piece falls at soft drop speed until you lift.
//    e.g. drag down to the floor, then right 2 cells -> the piece slides right under a roof.
//
// 5. Hold: a 'v' gesture going 1.5 cells up holds at once. In a sideways drag, a fast upward flick at
//    release holds (so an upward wobble mid-drag doesn't).
//
// 6. Release: lifting the finger during a fast swipe -
//    down (FLICK_CELLS within FLICK_WINDOW at FLICK_SPEED or faster) -> hard drop. Sideways steps made during
//      that swipe are undone first, so a slanted swipe drops where the swipe started;
//    up -> hold (see 5);
//    sideways, with touchWallFlick on -> the piece goes all the way to the wall.
//    A slow lift does nothing more: the piece stays where the drag left it.
//    e.g. drag right 2 columns, then swipe down and let go -> hard drop 2 columns to the right.
//
// 7. New piece: a gesture that started before the current piece appeared (the last one locked or was held)
//    is ignored until the finger lifts, so a swipe can't also hard drop the next piece. While a finger is
//    down, the game's lock delay waits (game.touching), so there is time to lift and tap a spin.
(function (TW) {
  'use strict';

  const TAP_MS = 300; // longest touch that still counts as a tap
  const FLICK_WINDOW = 120; // ms of finger movement a flick is measured over
  const FLICK_CELLS = 2.5; // a flick covers at least this many cells within the window...
  const FLICK_SPEED = 1.2; // ...at this speed or faster (px per ms)
  const WALL_CELLS = 2; // a sideways flick to the wall covers this many cells within the window, at FLICK_SPEED
  const SPEED_WINDOW = 60; // ms the sideways finger speed is measured over
  const REVERSE_CELLS = 0.5; // finger travel back (at slow speed) that undoes the last sideways step
  const SRC = 'touch'; // input source id for the held soft drop

  // opts: { game, input, settings, cell: () => board cell size in CSS pixels }
  function attach(el, opts) {
    const { game, input, settings } = opts;
    let t = null; // the touch being tracked

    const cfg = () => settings.data.controls;
    const press = (a) => input.onPress(a);

    function softDrop(g, on) {
      if (g.soft === on) return;
      g.soft = on;
      if (on) input.press('softDrop', SRC);
      else input.release('softDrop', SRC);
    }

    function buzz() {
      if (cfg().touchVibrate && navigator.vibrate) {
        try { navigator.vibrate(8); } catch (err) { /* not allowed yet */ }
      }
    }

    // Finger travel per column in px at this sideways finger speed (cells per second): slow drags travel more
    // per column, so small moves are easy to stop on the right column; fast drags less, to cross the board quickly.
    function stepPx(speed, c) {
      const s = cfg();
      const lo = s.touchFastSpeed * 0.2;
      const k = Math.min(1, Math.max(0, (speed - lo) / (s.touchFastSpeed - lo)));
      const f = k * k * (3 - 2 * k); // smooth blend
      return (s.touchSlow + (s.touchFast - s.touchSlow) * f) * c;
    }

    // Was the finger moving fast down (dir 1) or up (dir -1) when it left the screen? Returns when that swipe
    // started, or null. Measured from any point of the last FLICK_WINDOW ms, so a swipe right after a sideways
    // drag isn't slowed down by the sideways part.
    function flickStart(g, time, y, dir) {
      while (g.trail.length > 1 && time - g.trail[0][0] > FLICK_WINDOW) g.trail.shift();
      const dist = FLICK_CELLS * opts.cell();
      const p = g.trail.find(([t1, y1]) => dir * (y - y1) >= dist && dir * (y - y1) / Math.max(1, time - t1) >= FLICK_SPEED);
      return p ? p[0] : null;
    }

    // A fast, mostly sideways flick at release: its direction (-1 / 1), or 0.
    function wallFlick(g, time, x, y) {
      const dist = WALL_CELLS * opts.cell();
      const p = g.trail.find(([t1, y1, x1]) => time - t1 <= FLICK_WINDOW && Math.abs(x - x1) >= dist &&
        Math.abs(x - x1) > 2 * Math.abs(y - y1) && Math.abs(x - x1) / Math.max(1, time - t1) >= FLICK_SPEED);
      return p ? Math.sign(x - p[2]) : 0;
    }

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || t || !input.enabled) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      t = {
        id: e.pointerId, x0: e.clientX, y0: e.clientY, top: e.clientY, bottom: e.clientY,
        // vx: finger x with the speed-dependent gain applied; x: where the last sideways step happened (same
        // scale); dir: direction of that step (0 before the first one)
        vx: e.clientX, x: e.clientX, dir: 0,
        t0: e.timeStamp, mode: null, held: false, soft: false, slide: false, dead: 0, trail: [[e.timeStamp, e.clientY, e.clientX]],
        lastX: e.clientX, lastY: e.clientY, moves: [], // moves: [time, direction] of each sideways step
        piece: game.pieceId, // a new piece ends this gesture (it doesn't act on the next piece)
      };
      game.touching = true;
    });

    el.addEventListener('pointermove', (e) => {
      if (!t || e.pointerId !== t.id) return;
      e.preventDefault();
      // A new piece appeared during this touch (the last one locked, or was held): ignore the rest of it.
      if (t.piece !== game.pieceId) { softDrop(t, false); return; }
      const u = opts.cell(), y = e.clientY;
      let ddx = e.clientX - t.lastX;
      const ddy = y - t.lastY;
      t.lastX = e.clientX;
      t.lastY = y;
      t.trail.push([e.timeStamp, y, e.clientX]);
      while (t.trail.length > 1 && e.timeStamp - t.trail[0][0] > FLICK_WINDOW) t.trail.shift();
      // The first clear movement decides whether this touch moves the piece sideways or drops / holds it.
      if (!t.mode) {
        const dx = e.clientX - t.x0, dy = y - t.y0;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < u * 0.5) return;
        t.mode = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
        ddx = dx; // count the travel before the decision too
      }
      // Sideways moves: in a sideways drag, and after a downward drag started soft drop (slide the piece
      // into an overhang without lifting the finger).
      if (t.mode === 'h' || t.slide) {
        // While the finger heads mostly down or up (into a hard drop or hold swipe), sideways drift is ignored.
        if (Math.abs(ddy) <= 2 * Math.abs(ddx)) {
          const i = t.trail.findIndex((q) => e.timeStamp - q[0] <= SPEED_WINDOW);
          const p = t.trail[Math.min(i, t.trail.length - 2)] || t.trail[0];
          const speed = Math.abs(e.clientX - p[2]) / Math.max(8, e.timeStamp - p[0]) * 1000 / u; // cells per second
          const slow = cfg().touchSlow * u;
          t.vx += ddx * slow / stepPx(speed, u);
          // A step needs one column of travel; going back the other way needs only REVERSE_CELLS. During soft
          // drop the first step needs extra travel (dead zone), against accidental moves.
          for (;;) {
            const d = Math.sign(t.vx - t.x);
            const need = d === -t.dir ? REVERSE_CELLS * u : slow + t.dead;
            if (!d || Math.abs(t.vx - t.x) < need) break;
            t.x += d * need;
            t.dir = d;
            t.dead = 0;
            if (game.touchShift(d)) { t.moves.push([e.timeStamp, d]); buzz(); }
          }
        }
      }
      // Soft drop while the finger is held below where the downward drag started; moving back up stops it.
      // A sideways drag needs a bit more downward travel, so small wobbles don't drop the piece.
      if (t.soft) {
        t.bottom = Math.max(t.bottom, y);
        if (y < t.bottom - u) { softDrop(t, false); t.top = y; }
      } else {
        // In a sideways drag only steep downward travel counts: the finger drifting down while it moves
        // sideways doesn't start soft drop.
        if (t.mode === 'h' && Math.abs(ddx) >= Math.abs(ddy)) t.top = y;
        t.top = Math.min(t.top, y);
        if (y - t.top >= (t.mode === 'h' ? 1.5 : 1) * u) {
          softDrop(t, true);
          t.bottom = y;
          if (!t.slide) {
            t.slide = true;
            t.x = t.vx;
            t.dir = 0;
            if (t.mode === 'v') t.dead = cfg().touchSlideDeadzone * u;
          }
        }
      }
      if (t.mode === 'v' && !t.held && !t.soft && y - t.y0 <= -1.5 * u) { t.held = true; press('hold'); }
    });

    const end = (e, cancelled) => {
      if (!t || e.pointerId !== t.id) return;
      const g = t;
      t = null;
      game.touching = false;
      softDrop(g, false);
      if (cancelled || g.piece !== game.pieceId) return;
      const u = opts.cell();
      if (!g.mode && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < u * 0.5 && e.timeStamp - g.t0 < TAP_MS) {
        const left = e.clientX < window.innerWidth / 2;
        press(left !== cfg().touchRotateSwap ? 'rotCW' : 'rotCCW');
        return;
      }
      // Fast sideways flick and let go: all the way to the wall.
      if (cfg().touchWallFlick && g.mode === 'h' && !g.soft) {
        const d = wallFlick(g, e.timeStamp, e.clientX, e.clientY);
        if (d) {
          let moved = false;
          while (game.touchShift(d)) moved = true;
          if (moved) buzz();
          return;
        }
      }
      // Swipe up and let go during a sideways drag: hold (a vertical swipe up holds right away, see above).
      if (!g.held && flickStart(g, e.timeStamp, e.clientY, -1) !== null) { press('hold'); return; }
      const start = flickStart(g, e.timeStamp, e.clientY, 1);
      if (start === null) return;
      // Undo sideways steps made during the swipe itself, so a slanted swipe drops where it started.
      for (const [time, d] of g.moves.slice().reverse()) {
        if (time < start) break;
        if (!game.touchShift(-d)) break;
      }
      press('hardDrop');
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    // Older iOS ignores touch-action for some gestures: keep the page from scrolling or zooming here.
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  // Short description for the keys panel.
  function help(settings) {
    const s = settings.data.controls;
    return 'Touch: drag ←/→ move (slow = precise) · drag ↓ and hold: soft drop · swipe ↓ and let go: hard drop · swipe ↑ hold (or swipe ↑ and let go while dragging ←/→)' +
      (s.touchWallFlick ? ' · flick ←/→ and let go: to the wall' : '') +
      ' · tap left / right: rotate ' + (s.touchRotateSwap ? 'CCW / CW' : 'CW / CCW');
  }

  TW.Touch = { attach, help };
})(window.TW);
