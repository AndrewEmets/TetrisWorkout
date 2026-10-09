// Touch controls on the play area:
//   drag left / right: move one column per cell of finger travel   drag down: soft drop, one row per cell
//   flick down (also in the middle of a sideways drag): hard drop   flick up: hold
//   tap left / right half of the screen: rotate CW / CCW (swappable)
(function (TW) {
  'use strict';

  const TAP_MS = 300; // longest touch that still counts as a tap
  const FLICK_WINDOW = 120; // ms of finger movement a flick is measured over
  const FLICK_CELLS = 2.5; // a flick covers at least this many cells within the window...
  const FLICK_SPEED = 1.2; // ...at this speed or faster (px per ms)

  // opts: { game, input, settings, cell: () => board cell size in CSS pixels }
  function attach(el, opts) {
    const { game, input, settings } = opts;
    let t = null; // the touch being tracked

    const unit = () => opts.cell() * settings.data.controls.touchSensitivity;
    const press = (a) => input.onPress(a);

    // Fast downward movement within the last FLICK_WINDOW ms? Measured from any recent point, so a flick right
    // after a sideways drag isn't slowed down by the sideways part.
    function flicked(g, time, y) {
      while (g.trail.length > 1 && time - g.trail[0][0] > FLICK_WINDOW) g.trail.shift();
      const dist = FLICK_CELLS * unit();
      return g.trail.some(([t1, y1]) => y - y1 >= dist && (y - y1) / Math.max(1, time - t1) >= FLICK_SPEED);
    }

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || t || !input.enabled) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      t = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, mode: null, held: false, done: false, trail: [[e.timeStamp, e.clientY]] };
    });

    el.addEventListener('pointermove', (e) => {
      if (!t || e.pointerId !== t.id) return;
      e.preventDefault();
      if (t.done) return; // hard dropped already: the rest of this touch is ignored
      const u = unit();
      t.trail.push([e.timeStamp, e.clientY]);
      if (flicked(t, e.timeStamp, e.clientY)) { t.done = true; press('hardDrop'); return; }
      // The first clear movement decides whether this touch moves the piece or drops / holds it.
      if (!t.mode) {
        const dx = e.clientX - t.x0, dy = e.clientY - t.y0;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < u * 0.5) return;
        t.mode = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      }
      if (t.mode === 'h') {
        while (Math.abs(e.clientX - t.x) >= u) {
          const d = Math.sign(e.clientX - t.x);
          t.x += d * u;
          game.touchShift(d);
        }
      } else {
        while (e.clientY - t.y >= u) { t.y += u; game.touchSoftDrop(); }
        if (e.clientY < t.y) t.y = e.clientY; // moving back up restarts the soft drop distance
        if (!t.held && e.clientY - t.y0 <= -1.5 * u) { t.held = true; press('hold'); }
      }
    });

    const end = (e, cancelled) => {
      if (!t || e.pointerId !== t.id) return;
      const g = t;
      t = null;
      if (cancelled || g.done) return;
      const u = unit();
      if (!g.mode && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < u * 0.5 && e.timeStamp - g.t0 < TAP_MS) {
        const left = e.clientX < window.innerWidth / 2;
        press(left !== settings.data.controls.touchRotateSwap ? 'rotCW' : 'rotCCW');
        return;
      }
      if (flicked(g, e.timeStamp, e.clientY)) press('hardDrop');
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    // Older iOS ignores touch-action for some gestures: keep the page from scrolling or zooming here.
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  // Short description for the keys panel.
  function help(settings) {
    const swap = settings.data.controls.touchRotateSwap;
    return 'Touch: drag ←/→ move · drag ↓ soft drop · flick ↓ hard drop · flick ↑ hold · tap left / right: rotate ' +
      (swap ? 'CCW / CW' : 'CW / CCW');
  }

  TW.Touch = { attach, help };
})(window.TW);
