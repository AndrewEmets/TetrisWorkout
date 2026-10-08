// Keyboard + gamepad input mapped to abstract actions. Both sources feed one press/release stream,
// so DAS/ARR handling in the game is identical for keyboard and controller.
(function (TW) {
  'use strict';

  class Input {
    constructor(settings) {
      this.settings = settings;
      this.held = new Map(); // action -> Set of source ids
      this.padPrev = new Map(); // gamepad index -> Set of active control ids
      this.onPress = () => {};
      this.onRelease = () => {};
      this.enabled = true;
      this.capturing = null; // { kind, cb }
    }

    attach() {
      window.addEventListener('keydown', (e) => this.keyDown(e));
      window.addEventListener('keyup', (e) => this.keyUp(e));
      window.addEventListener('blur', () => this.releaseAll());
    }

    isHeld(action) {
      const s = this.held.get(action);
      return !!s && s.size > 0;
    }

    press(action, src) {
      let s = this.held.get(action);
      if (!s) this.held.set(action, (s = new Set()));
      if (s.has(src)) return;
      s.add(src);
      if (s.size === 1) this.onPress(action);
    }

    release(action, src) {
      const s = this.held.get(action);
      if (!s || !s.delete(src)) return;
      if (s.size === 0) this.onRelease(action);
    }

    releaseAll() {
      for (const [action, s] of this.held) {
        if (s.size) { s.clear(); this.onRelease(action); }
      }
    }

    actionsFor(kind, code) {
      const map = this.settings.data.controls[kind];
      return Object.keys(map).filter((a) => map[a].includes(code));
    }

    // Next key / gamepad control is passed to cb instead of the game. cb(null) on Esc.
    capture(kind, cb) {
      this.releaseAll();
      this.capturing = { kind, cb };
    }

    cancelCapture() {
      this.capturing = null;
    }

    finishCapture(code) {
      const c = this.capturing;
      this.capturing = null;
      c.cb(code);
    }

    keyDown(e) {
      if (this.capturing) {
        e.preventDefault();
        if (e.code === 'Escape') this.finishCapture(null);
        else if (this.capturing.kind === 'keyboard') this.finishCapture(e.code);
        return;
      }
      const tag = e.target && e.target.tagName;
      if (!this.enabled || tag === 'INPUT' || tag === 'TEXTAREA') return;
      const actions = this.actionsFor('keyboard', e.code);
      if (!actions.length) return;
      e.preventDefault();
      if (e.repeat) return;
      if (tag === 'SELECT' || tag === 'BUTTON') e.target.blur();
      for (const a of actions) this.press(a, 'k:' + e.code);
    }

    keyUp(e) {
      for (const a of this.actionsFor('keyboard', e.code)) this.release(a, 'k:' + e.code);
    }

    // Called once per frame.
    pollGamepads() {
      if (!navigator.getGamepads) return;
      const dz = this.settings.data.controls.deadzone;
      const pads = navigator.getGamepads();
      for (let pi = 0; pi < pads.length; pi++) {
        const pad = pads[pi];
        const prev = this.padPrev.get(pi) || new Set();
        const now = new Set();
        if (pad && pad.connected) {
          pad.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) now.add('b' + i); });
          pad.axes.forEach((v, i) => {
            if (v < -dz) now.add('a' + i + '-');
            else if (v > dz) now.add('a' + i + '+');
          });
        }
        for (const id of now) {
          if (prev.has(id)) continue;
          if (this.capturing) {
            if (this.capturing.kind === 'gamepad') this.finishCapture(id);
            continue;
          }
          if (!this.enabled) continue;
          for (const a of this.actionsFor('gamepad', id)) this.press(a, 'p' + pi + ':' + id);
        }
        for (const id of prev) {
          if (now.has(id)) continue;
          for (const a of this.actionsFor('gamepad', id)) this.release(a, 'p' + pi + ':' + id);
        }
        this.padPrev.set(pi, now);
      }
    }
  }

  TW.Input = Input;
})(window.TW);
