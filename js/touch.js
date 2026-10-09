// Touch controls on the play area:
//   drag left / right: move one column per cell of finger travel   drag down: soft drop
//   flick down: hard drop   flick up: hold   tap left / right half of the screen: rotate CW / CCW (swappable)
(function (TW) {
  'use strict';

  const TAP_MS = 300; // longest touch that still counts as a tap
  const FLICK_SPEED = 1; // px per ms, measured over the last FLICK_WINDOW ms
  const FLICK_WINDOW = 100;

  // opts: { game, input, settings, cell: () => board cell size in CSS pixels }
  function attach(el, opts) {
    const { game, input, settings } = opts;
    let t = null; // the touch being tracked

    const unit = () => opts.cell() * settings.data.controls.touchSensitivity;
    const press = (a) => input.onPress(a);

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || t || !input.enabled) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      t = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, mode: null, held: false, trail: [[e.timeStamp, e.clientY]] };
    });

    el.addEventListener('pointermove', (e) => {
      if (!t || e.pointerId !== t.id) return;
      e.preventDefault();
      const u = unit();
      t.trail.push([e.timeStamp, e.clientY]);
      while (t.trail.length > 2 && e.timeStamp - t.trail[0][0] > FLICK_WINDOW) t.trail.shift();
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
      if (cancelled) return;
      const u = unit();
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.mode && Math.hypot(dx, dy) < u * 0.5 && e.timeStamp - g.t0 < TAP_MS) {
        const left = e.clientX < window.innerWidth / 2;
        press(left !== settings.data.controls.touchRotateSwap ? 'rotCW' : 'rotCCW');
        return;
      }
      if (g.mode === 'v' && dy >= 1.5 * u) {
        const [t1, y1] = g.trail[0];
        const speed = (e.clientY - y1) / Math.max(1, e.timeStamp - t1);
        if (speed >= FLICK_SPEED) press('hardDrop');
      }
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
