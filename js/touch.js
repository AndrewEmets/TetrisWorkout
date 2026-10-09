// Touch controls on the play area:
//   drag left / right: move one column per cell of finger travel
//   drag down and keep the finger down: soft drop, like holding the soft drop key (move back up to stop);
//   dragging sideways then still moves the piece, e.g. to slide it under an overhang
//   release during a fast downward swipe: hard drop   swipe up: hold
//   tap left / right half of the screen: rotate CW / CCW (swappable)
(function (TW) {
  'use strict';

  const TAP_MS = 300; // longest touch that still counts as a tap
  const FLICK_WINDOW = 120; // ms of finger movement a flick is measured over
  const FLICK_CELLS = 2.5; // a flick covers at least this many cells within the window...
  const FLICK_SPEED = 1.2; // ...at this speed or faster (px per ms)
  const SRC = 'touch'; // input source id for the held soft drop

  // opts: { game, input, settings, cell: () => board cell size in CSS pixels }
  function attach(el, opts) {
    const { game, input, settings } = opts;
    let t = null; // the touch being tracked

    const unit = () => opts.cell() * settings.data.controls.touchSensitivity;
    const press = (a) => input.onPress(a);

    function softDrop(g, on) {
      if (g.soft === on) return;
      g.soft = on;
      if (on) input.press('softDrop', SRC);
      else input.release('softDrop', SRC);
    }

    // Was the finger moving fast down (dir 1) or up (dir -1) when it left the screen? Returns when that swipe
    // started, or null. Measured from any point of the last FLICK_WINDOW ms, so a swipe right after a sideways
    // drag isn't slowed down by the sideways part.
    function flickStart(g, time, y, dir) {
      while (g.trail.length > 1 && time - g.trail[0][0] > FLICK_WINDOW) g.trail.shift();
      const dist = FLICK_CELLS * unit();
      const p = g.trail.find(([t1, y1]) => dir * (y - y1) >= dist && dir * (y - y1) / Math.max(1, time - t1) >= FLICK_SPEED);
      return p ? p[0] : null;
    }

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || t || !input.enabled) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      t = {
        id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, top: e.clientY, bottom: e.clientY,
        t0: e.timeStamp, mode: null, held: false, soft: false, slide: false, dead: 0, trail: [[e.timeStamp, e.clientY]],
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
      const u = unit(), y = e.clientY;
      const ddx = e.clientX - t.lastX, ddy = y - t.lastY;
      t.lastX = e.clientX;
      t.lastY = y;
      t.trail.push([e.timeStamp, y]);
      while (t.trail.length > 1 && e.timeStamp - t.trail[0][0] > FLICK_WINDOW) t.trail.shift();
      // The first clear movement decides whether this touch moves the piece sideways or drops / holds it.
      if (!t.mode) {
        const dx = e.clientX - t.x0, dy = y - t.y0;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < u * 0.5) return;
        t.mode = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      }
      // Sideways moves: in a sideways drag, and after a downward drag started soft drop (slide the piece
      // into an overhang without lifting the finger).
      if (t.mode === 'h' || t.slide) {
        // While the finger heads mostly down or up (into a hard drop or hold swipe), sideways drift is ignored.
        if (Math.abs(ddy) > 2 * Math.abs(ddx)) t.x += ddx;
        // During soft drop the first sideways step needs extra travel (dead zone), against accidental moves.
        while (Math.abs(e.clientX - t.x) >= u + t.dead) {
          const d = Math.sign(e.clientX - t.x);
          t.x += d * (u + t.dead);
          t.dead = 0;
          if (game.touchShift(d)) t.moves.push([e.timeStamp, d]);
        }
      }
      // Soft drop while the finger is held below where the downward drag started; moving back up stops it.
      // A sideways drag needs a bit more downward travel, so small wobbles don't drop the piece.
      if (t.soft) {
        t.bottom = Math.max(t.bottom, y);
        if (y < t.bottom - u) { softDrop(t, false); t.top = y; }
      } else {
        t.top = Math.min(t.top, y);
        if (y - t.top >= (t.mode === 'h' ? 1.5 : 1) * u) {
          softDrop(t, true);
          t.bottom = y;
          if (!t.slide) {
            t.slide = true;
            t.x = e.clientX;
            if (t.mode === 'v') t.dead = settings.data.controls.touchSlideDeadzone * u;
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
      const u = unit();
      if (!g.mode && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < u * 0.5 && e.timeStamp - g.t0 < TAP_MS) {
        const left = e.clientX < window.innerWidth / 2;
        press(left !== settings.data.controls.touchRotateSwap ? 'rotCW' : 'rotCCW');
        return;
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
    const swap = settings.data.controls.touchRotateSwap;
    return 'Touch: drag ←/→ move · drag ↓ and hold: soft drop · swipe ↓ and let go: hard drop · swipe ↑ hold (or swipe ↑ and let go while dragging ←/→) · tap left / right: rotate ' +
      (swap ? 'CCW / CW' : 'CW / CCW');
  }

  TW.Touch = { attach, help };
})(window.TW);
