// Touch gesture tests: plays recorded finger paths through TW.Touch.Gesture and checks what the piece did.
// Run: node tools/test-touch.js
'use strict';

const path = require('path');
global.window = { TW: {} };
require(path.join(__dirname, '..', 'js', 'touch.js'));
const { Gesture } = window.TW.Touch;

const DEFAULTS = {
  touchSlow: 1.5, touchFast: 0.6, touchFastSpeed: 20, touchVibrate: false, touchWallFlick: false,
  touchRotateSwap: false, touchSlideDeadzone: 1,
};

// A fake game: the piece's column (0..7 like a T), whether soft drop is held, and every action in order.
function setup(cfg) {
  const s = { col: 3, soft: false, softEver: false, piece: 1, log: [] };
  const conf = Object.assign({}, DEFAULTS, cfg);
  const env = {
    shift(d) {
      if (s.col + d < 0 || s.col + d > 7) return false;
      s.col += d;
      s.log.push(d < 0 ? 'L' : 'R');
      return true;
    },
    press(a) { s.log.push(a); },
    softDrop(on) { s.soft = on; s.softEver = s.softEver || on; s.log.push(on ? 'soft+' : 'soft-'); },
    buzz() {},
    pieceId() { return s.piece; },
  };
  return { s, conf, env };
}

// Plays a finger path: points [time ms, x, y] in cells, sampled every 8 ms along straight lines between them.
// opts.end: 'up' (default), 'cancel' or 'none'; opts.left: release on the left half; opts.at: { time: fn(s) }.
function play(points, opts = {}) {
  const { s, conf, env } = setup(opts.cfg);
  const [t0, x0, y0] = points[0];
  const g = new Gesture(() => conf, env, t0, x0, y0);
  const hooks = Object.assign({}, opts.at);
  let last = points[0];
  for (const p of points.slice(1)) {
    const [ta, xa, ya] = last, [tb, xb, yb] = p;
    for (let t = ta + 8; t < tb + 8; t += 8) {
      const k = Math.min(1, (t - ta) / (tb - ta || 1));
      const time = Math.min(t, tb);
      for (const ht of Object.keys(hooks)) if (+ht <= time) { hooks[ht](s); delete hooks[ht]; }
      g.move(time, xa + (xb - xa) * k, ya + (yb - ya) * k);
    }
    last = p;
  }
  const [te, xe, ye] = last;
  if (opts.end === 'cancel') g.cancel();
  else if (opts.end !== 'none') g.end(te + 1, xe, ye, opts.left !== false);
  s.moved = s.col - 3;
  return s;
}

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ': ' + e.message); }
}
function eq(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(what + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const has = (s, a) => s.log.includes(a);

console.log('Touch gestures');

test('tap on the left rotates CW, on the right CCW', () => {
  eq(play([[0, 5, 5], [100, 5.1, 5.1]]).log, ['rotCW'], 'left');
  eq(play([[0, 5, 5], [100, 5.1, 5.1]], { left: false }).log, ['rotCCW'], 'right');
  eq(play([[0, 5, 5], [100, 5, 5]], { cfg: { touchRotateSwap: true } }).log, ['rotCCW'], 'swapped');
});

test('a long press or a small drag is not a tap', () => {
  eq(play([[0, 5, 5], [400, 5, 5]]).log, [], 'long press');
  eq(play([[0, 5, 5], [100, 5.6, 5]]).log, [], 'drag');
});

test('slow drags take 1.5 cells per column', () => {
  eq(play([[0, 5, 5], [1000, 3.6, 5]]).moved, 0, '1.4 cells');
  eq(play([[0, 5, 5], [1000, 3.4, 5]]).moved, -1, '1.6 cells');
  eq(play([[0, 5, 5], [1500, 8.1, 5]]).moved, 2, '3.1 cells');
});

test('fast drags take 0.6 cells per column', () => {
  eq(play([[0, 5, 5], [50, 3.1, 5]]).moved, -3, '1.9 cells in 50 ms');
});

test('going back takes half a cell, without jitter', () => {
  const at = (t, x) => [t, x, 5];
  eq(play([at(0, 5), at(1500, 8.1), at(1800, 7.7)]).moved, 2, '0.4 back');
  eq(play([at(0, 5), at(1500, 8.1), at(1900, 7.45)]).moved, 1, '0.65 back');
  eq(play([at(0, 5), at(1500, 8.1), at(1900, 7.45), at(2100, 7.75)]).moved, 1, '0.3 forward again');
  eq(play([at(0, 5), at(1500, 8.1), at(1900, 7.45), at(2100, 8.0)]).moved, 2, '0.55 forward again');
});

test('a slanted sideways drag moves but does not soft drop', () => {
  const s = play([[0, 5, 5], [1500, 10, 7.5]]);
  eq(s.moved, 3, 'columns');
  eq(s.softEver, false, 'soft drop');
});

test('a diagonal drag does nothing', () => {
  const s = play([[0, 5, 5], [1000, 8, 8]]);
  eq(s.log, [], 'actions');
  const then = play([[0, 5, 5], [1000, 8, 8], [1500, 9.2, 8]]);
  eq(then.moved, 1, 'then sideways: only half a cell of the diagonal counts (0.5 + 1.2 cells)');
});

test('a wobbly sideways drag counts its travel once', () => {
  const s = play([[0, 5, 5], [500, 6.5, 5], [560, 6.8, 5.35], [620, 7.1, 5], [1000, 8.1, 5]]);
  eq(s.moved, 2, 'columns (3.1 cells)');
});

test('dragging down holds soft drop until lifted', () => {
  const s = play([[0, 5, 5], [400, 5, 8], [1400, 5, 8]], { end: 'none' });
  eq(s.soft, true, 'soft drop held');
  const lifted = play([[0, 5, 5], [400, 5, 8], [1400, 5, 8]]);
  eq(lifted.log, ['soft+', 'soft-'], 'lifted slowly: no hard drop');
});

test('moving the finger back up stops soft drop', () => {
  const s = play([[0, 5, 5], [400, 5, 8], [700, 5, 6.9]], { end: 'none' });
  eq(s.soft, false, 'soft drop');
});

test('a fast swipe down hard drops at release', () => {
  const s = play([[0, 5, 5], [40, 5, 8.5]]);
  eq(s.log[s.log.length - 1], 'hardDrop', 'last action');
});

test('drift during a hard drop swipe does not move the piece', () => {
  const s = play([[0, 5, 5], [40, 6, 8.5]]);
  eq(s.moved, 0, 'columns');
  eq(has(s, 'hardDrop'), true, 'hard drop');
});

test('drag sideways, then swipe down: hard drop where the drag left it', () => {
  const s = play([[0, 5, 5], [1000, 8.1, 5], [1040, 8.1, 8.5]]);
  eq(s.moved, 2, 'columns');
  eq(s.log[s.log.length - 1], 'hardDrop', 'last action');
});

test('sideways during soft drop slides the piece and pauses the drop (no diagonal fall)', () => {
  // Down to the floor, then right: the dead zone makes the first step take 2.5 cells.
  const s = play([[0, 5, 5], [400, 5, 8], [1400, 8.1, 8]], { end: 'none' });
  eq(s.moved, 1, 'columns');
  eq(s.soft, false, 'soft drop paused while moving sideways');
  const resumed = play([[0, 5, 5], [400, 5, 8], [1400, 8.1, 8], [1700, 8.1, 9]], { end: 'none' });
  eq(resumed.soft, true, 'soft drop resumes when moving down again');
});

test('a sideways drag that turns down needs no dead zone', () => {
  const s = play([[0, 5, 5], [1000, 8.1, 5], [1300, 8.1, 7], [2300, 11.2, 7]], { end: 'none' });
  eq(s.moved, 4, 'columns');
});

test('swipe up holds at once', () => {
  eq(play([[0, 5, 8], [200, 5, 6.3]], { end: 'none' }).log, ['hold'], 'hold');
});

test('swipe up and let go after a sideways drag holds', () => {
  const slowUp = play([[0, 5, 8], [1000, 8.1, 8], [1300, 8.1, 6]]);
  eq(has(slowUp, 'hold'), false, 'slow move up: no hold');
  const flick = play([[0, 5, 8], [1000, 8.1, 8], [1040, 8.1, 5]]);
  eq(flick.log, ['R', 'R', 'hold'], 'flick up');
});

test('a new piece ends the gesture', () => {
  const s = play([[0, 5, 5], [400, 5, 8], [500, 5, 8], [580, 5, 11.5]], { at: { 450: (st) => { st.piece = 2; } } });
  eq(s.soft, false, 'soft drop released');
  eq(has(s, 'hardDrop'), false, 'no hard drop on the new piece');
});

test('flick to the wall (when on)', () => {
  const off = play([[0, 3, 5], [60, 5.5, 5]]);
  eq(off.moved, 4, 'off: drag steps only');
  const on = play([[0, 3, 5], [30, 5.2, 5]], { cfg: { touchWallFlick: true } });
  eq(on.col, 7, 'on: at the wall');
});

test('cancelled touch releases soft drop', () => {
  const s = play([[0, 5, 5], [400, 5, 8]], { end: 'cancel' });
  eq(s.soft, false, 'soft drop');
});

console.log(failed ? failed + ' failed' : 'all passed');
process.exitCode = failed ? 1 : 0;
