// Canvas renderer: hold box, field (with 2 rows above the visible area), next queue, ghost, hint and messages,
// plus the effects the game emits (game.events): drop trails, board shake, lock and line clear flashes, particles
// and clear callouts.
(function (TW) {
  'use strict';

  const { W, H, VISIBLE } = TW.Board;
  const { SHAPES, COLORS, ID_TYPE, cellsOf } = TW.Pieces;
  const HIDDEN_SHOWN = 2;
  const FIRST_ROW = H - VISIBLE - HIDDEN_SHOWN;
  const ROWS = 23.5;
  const SIDE = 4.5, SIDE_NARROW = 3; // width of the hold / next boxes, in cells
  const cols = (side) => 2 * side + 12; // hold + field (10) + next + margins

  // Locked cells are a little darker and less saturated than the falling piece (and the hold / next previews).
  const LOCKED = {}, ACTIVE = {};
  for (const k of Object.keys(COLORS)) { LOCKED[k] = tone(COLORS[k], 0.72, 0.8); ACTIVE[k] = tone(COLORS[k], 1.05, 1.1); }
  const colorOf = (v) => ID_TYPE[v] || v;
  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Effect durations (ms).
  const TRAIL_MS = 260, LOCK_MS = 140, CLEAR_MS = 300, PC_MS = 800, CALLOUT_MS = 1600;
  const MAX_PARTICLES = 300;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.c = 24;
      this.side = SIDE;
      this.shakes = []; // { t, x, y, dur }: board offsets in cells
      this.trails = []; // { t, dur, color, cols: [{ x, y0, y1 }] }
      this.flashes = []; // { t, kind: 'lock' | 'clear' | 'pc', cells | rows }
      this.particles = []; // { x, y, vx, vy, age, life, size, color } in cells, relative to the field
      this.lastDraw = performance.now();
    }

    // Field row (board y) to canvas y.
    rowY(y) { return this.fy + (y - FIRST_ROW - HIDDEN_SHOWN) * this.c; }

    // Turns the game's events into effects.
    effect(e, g) {
      if ((e.kind === 'bump' || (e.kind === 'drop' && e.hard)) && g.shake && !REDUCED_MOTION) {
        if (e.kind === 'bump') this.shakes.push({ t: e.t, x: 0.09 * e.dir, y: 0, dur: 160 });
        else this.shakes.push({ t: e.t, x: 0, y: 0.08 + 0.1 * Math.min(1, e.dist / 12), dur: 220 });
      }
      if (!g.effects) return;
      if (e.kind === 'drop') {
        const top = new Map();
        for (const [x, y] of e.cells) top.set(x, Math.min(y, top.has(x) ? top.get(x) : Infinity));
        const cols = [...top].map(([x, y]) => ({ x, y0: y, y1: y + e.dist }));
        this.trails.push({ t: e.t, dur: e.hard ? TRAIL_MS : TRAIL_MS * 0.8, color: ACTIVE[e.type], cols });
      } else if (e.kind === 'lock') {
        this.flashes.push({ t: e.t, kind: 'lock', cells: e.cells });
      } else if (e.kind === 'clear') {
        this.flashes.push({ t: e.t, kind: 'clear', rows: e.rows.map((r) => r.y) });
        if (e.pc) this.flashes.push({ t: e.t, kind: 'pc' });
        const rate = e.pc ? 1 : e.rows.length >= 4 ? 0.6 : 0.25 + 0.08 * e.rows.length;
        for (const r of e.rows) {
          for (let x = 0; x < W; x++) {
            const v = r.cells[x];
            if (!v || Math.random() > rate || this.particles.length >= MAX_PARTICLES) continue;
            this.particles.push({
              x: x + Math.random(), y: r.y - FIRST_ROW - HIDDEN_SHOWN + Math.random(),
              vx: (x - 4.5) * 0.5 + (Math.random() - 0.5) * 6, vy: -3 - Math.random() * 7,
              age: 0, life: 450 + Math.random() * 450, size: 0.1 + Math.random() * 0.14, color: ACTIVE[colorOf(v)],
            });
          }
        }
      }
    }

    shakeOffset(now) {
      let x = 0, y = 0;
      this.shakes = this.shakes.filter((s) => now - s.t < s.dur);
      for (const s of this.shakes) {
        const k = Math.max(0, now - s.t) / s.dur, f = (1 - k) * (1 - k) * Math.cos(k * Math.PI * 3);
        x += s.x * f;
        y += s.y * f;
      }
      return [x * this.c, y * this.c];
    }

    // Fading streaks from where a dropped piece started to where it landed; they shrink toward the landing.
    drawTrails(now) {
      const ctx = this.ctx, c = this.c;
      this.trails = this.trails.filter((t) => now - t.t < t.dur);
      if (!this.trails.length) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.fx, this.fy - HIDDEN_SHOWN * c, W * c, (VISIBLE + HIDDEN_SHOWN) * c);
      ctx.clip();
      for (const t of this.trails) {
        const k = Math.max(0, now - t.t) / t.dur, ease = 1 - (1 - k) * (1 - k);
        for (const { x, y0, y1 } of t.cols) {
          const top = this.rowY(y0 + (y1 - y0) * ease), bottom = this.rowY(y1);
          if (bottom - top < 1) continue;
          const grad = ctx.createLinearGradient(0, top, 0, bottom);
          grad.addColorStop(0, 'rgba(255,255,255,0)');
          grad.addColorStop(1, t.color);
          ctx.globalAlpha = 0.45 * (1 - k);
          ctx.fillStyle = grad;
          ctx.fillRect(this.fx + (x + 0.12) * c, top, c * 0.76, bottom - top);
        }
      }
      ctx.restore();
    }

    // Lock flash on the piece's cells, a white bar over each cleared row, a gold wash for a perfect clear.
    drawFlashes(now) {
      const ctx = this.ctx, c = this.c;
      const dur = { lock: LOCK_MS, clear: CLEAR_MS, pc: PC_MS };
      this.flashes = this.flashes.filter((f) => now - f.t < dur[f.kind]);
      for (const f of this.flashes) {
        const k = Math.max(0, now - f.t) / dur[f.kind];
        if (f.kind === 'lock') {
          ctx.fillStyle = 'rgba(255,255,255,' + (0.45 * (1 - k)) + ')';
          for (const [x, y] of f.cells) if (y >= FIRST_ROW) ctx.fillRect(this.fx + x * c, this.rowY(y), c, c);
        } else if (f.kind === 'clear') {
          const h = c * (1 - 0.85 * k), spread = W * c * (0.5 + 0.5 * Math.min(1, k * 3));
          ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * (1 - k) * (1 - k)) + ')';
          for (const y of f.rows) ctx.fillRect(this.fx + (W * c - spread) / 2, this.rowY(y) + (c - h) / 2, spread, h);
        } else {
          ctx.fillStyle = 'rgba(255,215,90,' + (0.3 * (1 - k)) + ')';
          ctx.fillRect(this.fx, this.fy, W * c, VISIBLE * c);
        }
      }
    }

    drawParticles(dt) {
      const ctx = this.ctx, c = this.c, s = dt / 1000;
      this.particles = this.particles.filter((p) => (p.age += dt) < p.life);
      for (const p of this.particles) {
        p.vy += 30 * s;
        p.x += p.vx * s;
        p.y += p.vy * s;
        const size = p.size * c * (1 - 0.4 * p.age / p.life);
        ctx.globalAlpha = 1 - p.age / p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(this.fx + p.x * c - size / 2, this.fy + p.y * c - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }

    // Name of the last clear (spin, quad, perfect clear...) over the upper part of the field: pops in, rises, fades.
    drawCallout(game, now) {
      const lc = game.lastClear;
      if (!lc || game.flash || game.phase !== 'play') return;
      const age = now - lc.t;
      if (age > CALLOUT_MS || age < 0) return;
      const ctx = this.ctx, c = this.c;
      const spin = lc.spin !== 'none', big = lc.pc || spin || lc.lines >= 4;
      const title = lc.pc ? 'PERFECT CLEAR' : lc.text;
      const color = lc.pc ? '#ffd75a' : spin ? ACTIVE[lc.type] : lc.lines >= 4 ? ACTIVE.I : '#e8ebf1';
      const sub = (lc.pc && lc.text ? [lc.text] : []).concat(lc.notes).join(' · ');
      const pop = age < 160 ? 1 + 0.4 * Math.pow(1 - age / 160, 2) : 1;
      const alpha = age < 1000 ? 1 : 1 - (age - 1000) / (CALLOUT_MS - 1000);
      const font = (size, weight) => weight + ' ' + Math.round(size) + 'px system-ui, "Segoe UI", sans-serif';
      const line = (str, y, size, fill, weight, glow) => {
        ctx.font = font(size, weight);
        const w = ctx.measureText(str).width, max = W * c * 0.92;
        if (w > max) { size *= max / w; ctx.font = font(size, weight); }
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(3, size * 0.16);
        ctx.strokeStyle = 'rgba(8,9,12,0.85)';
        ctx.strokeText(str, 0, y);
        ctx.shadowColor = fill;
        ctx.shadowBlur = glow ? size * 0.5 : 0;
        ctx.fillStyle = fill;
        ctx.fillText(str, 0, y);
        ctx.shadowBlur = 0;
      };

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(this.fx + W * c / 2, this.fy + VISIBLE * c * 0.3 - c * 0.5 * (age / CALLOUT_MS));
      ctx.scale(pop, pop);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const size = c * (lc.pc ? 1.2 : big ? 1.05 : 0.75);
      let y = 0;
      if (title) { line(title, y, size, color, 900, big); y += size * 0.85; }
      if (sub) { line(sub, y, c * 0.5, '#e8ebf1', 700, false); y += c * 0.75; }
      if (lc.level) line('LEVEL ' + lc.level, y, c * 0.6, '#7fd1ff', 800, true);
      ctx.restore();
    }

    // On narrow screens (phones) the hold / next boxes get thinner so the field can be bigger.
    resize() {
      const parent = this.canvas.parentElement;
      const fit = (side) => Math.floor(Math.min(parent.clientWidth / cols(side), parent.clientHeight / ROWS));
      this.side = fit(SIDE_NARROW) > fit(SIDE) ? SIDE_NARROW : SIDE;
      const c = Math.max(12, fit(this.side));
      const COLS = cols(this.side);
      const dpr = window.devicePixelRatio || 1;
      this.c = c;
      this.canvas.style.width = COLS * c + 'px';
      this.canvas.style.height = ROWS * c + 'px';
      this.canvas.width = Math.round(COLS * c * dpr);
      this.canvas.height = Math.round(ROWS * c * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    get fx() { return (this.side + 1) * this.c; }
    get fy() { return 0.5 * this.c + HIDDEN_SHOWN * this.c; }

    cell(x, y, color, size, alpha) {
      const ctx = this.ctx;
      const s = size || this.c;
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, y, s, s * 0.14);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y + s * 0.86, s, s * 0.14);
      ctx.globalAlpha = 1;
    }

    fieldCell(x, y, color, alpha) {
      this.cell(this.fx + x * this.c, this.rowY(y), color, this.c, alpha);
    }

    outline(cells, color, dashed) {
      const ctx = this.ctx, c = this.c;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, c * 0.1);
      if (dashed) ctx.setLineDash([c * 0.25, c * 0.15]);
      for (const [x, y] of cells) {
        ctx.strokeRect(this.fx + x * c + ctx.lineWidth / 2, this.fy + (y - FIRST_ROW - HIDDEN_SHOWN) * c + ctx.lineWidth / 2, c - ctx.lineWidth, c - ctx.lineWidth);
      }
      ctx.restore();
    }

    // Piece preview centered in a box (x, y, w, h in pixels).
    mini(type, x, y, w, h, alpha) {
      const shape = SHAPES[type][0];
      const s = Math.min(this.c * 0.8, w / 4.6);
      const xs = shape.map((p) => p[0]), ys = shape.map((p) => p[1]);
      const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
      const ox = x + (w - (maxx - minx + 1) * s) / 2, oy = y + (h - (maxy - miny + 1) * s) / 2;
      for (const [cx, cy] of shape) this.cell(ox + (cx - minx) * s, oy + (cy - miny) * s, ACTIVE[type], s, alpha);
    }

    text(str, x, y, size, color, align, weight, maxWidth) {
      const ctx = this.ctx;
      ctx.font = (weight || 600) + ' ' + Math.round(size) + 'px system-ui, "Segoe UI", sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'middle';
      if (maxWidth) ctx.fillText(str, x, y, maxWidth);
      else ctx.fillText(str, x, y);
    }

    draw(game) {
      const ctx = this.ctx, c = this.c, fx = this.fx, fy = this.fy;
      const now = performance.now(), dt = Math.min(100, now - this.lastDraw);
      this.lastDraw = now;
      for (const e of game.events.splice(0)) this.effect(e, game.g);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const [sx, sy] = this.shakeOffset(now);
      ctx.save();
      ctx.translate(sx, sy);

      // Field background and grid.
      ctx.fillStyle = '#0c0d10';
      ctx.fillRect(fx, fy, W * c, VISIBLE * c);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < W; x++) { ctx.moveTo(fx + x * c + 0.5, fy); ctx.lineTo(fx + x * c + 0.5, fy + VISIBLE * c); }
      for (let y = 1; y < VISIBLE; y++) { ctx.moveTo(fx, fy + y * c + 0.5); ctx.lineTo(fx + W * c, fy + y * c + 0.5); }
      ctx.stroke();
      ctx.strokeStyle = '#3a3f4b';
      ctx.lineWidth = 2;
      ctx.strokeRect(fx - 1, fy - 1, W * c + 2, VISIBLE * c + 2);

      // Stack.
      const b = game.board;
      for (let y = FIRST_ROW; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const v = b.get(x, y);
          if (v) this.fieldCell(x, y, LOCKED[colorOf(v)], y < FIRST_ROW + HIDDEN_SHOWN ? 0.6 : 1);
        }
      }
      this.drawTrails(now);

      const goal = game.drill && game.drill.goal;
      if (goal && goal.kind === 'pc') {
        const ly = fy + (VISIBLE - goal.height) * c;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,215,90,0.7)';
        ctx.setLineDash([c * 0.3, c * 0.2]);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(fx, ly); ctx.lineTo(fx + W * c, ly); ctx.stroke();
        ctx.restore();
      }

      // Opener: remaining cells of the current phase's shape. Key pieces are brighter than the suggested
      // filler spots (fillers may go anywhere in the shape).
      const op = game.op;
      if (op && game.g.showTarget && game.phase === 'play') {
        for (const [t, tg] of op.targets) {
          for (const [x, y] of tg.cells) if (!b.get(x, y)) this.fieldCell(x, y, COLORS[t], 0.18);
        }
        for (const t of op.fillers) {
          for (const [x, y] of op.suggest.get(t)) if (!b.get(x, y)) this.fieldCell(x, y, COLORS[t], 0.09);
        }
      }

      // Hint.
      const hint = game.hint();
      if (hint && hint.offScript) {
        this.text('Off script — press Retry', fx + W * c / 2, fy + c, c * 0.6, '#ffd75a', 'center');
      } else if (hint) {
        this.outline(cellsOf(hint), COLORS[hint.type], true);
      }

      // Ghost and active piece.
      const p = game.piece;
      if (p) {
        if (game.g.ghost) {
          let gy = p.y;
          while (b.fits(p.type, p.rot, p.x, gy + 1)) gy++;
          for (const [x, y] of cellsOf({ ...p, y: gy })) this.fieldCell(x, y, ACTIVE[p.type], 0.25);
        }
        for (const [x, y] of cellsOf(p)) if (y >= FIRST_ROW) this.fieldCell(x, y, ACTIVE[p.type]);
      }
      this.drawFlashes(now);
      this.drawParticles(dt);

      // Walkthrough: T-spin corner markers and a label.
      const df = game.demoFrame();
      if (df) {
        if (df.marks) {
          for (const m of df.marks) {
            const cx = fx + (m.x + 0.5) * c, cy = fy + (m.y - FIRST_ROW - HIDDEN_SHOWN + 0.5) * c;
            ctx.beginPath();
            ctx.arc(cx, cy, c * 0.28, 0, Math.PI * 2);
            ctx.lineWidth = Math.max(2, c * 0.1);
            ctx.strokeStyle = m.filled ? (m.front ? '#ffd75a' : '#7fd1ff') : '#ff6b6b';
            if (m.filled) { ctx.fillStyle = ctx.strokeStyle; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1; }
            ctx.stroke();
          }
        }
        this.text(game.demo.playing ? '▶ SOLUTION' : '❚❚ SOLUTION', fx + W * c / 2, fy + 0.6 * c, c * 0.5, '#ffd75a', 'center', 700);
      }

      // Hold.
      this.text('HOLD', 0.5 * c, 0.9 * c, c * 0.55, '#8b93a3');
      ctx.fillStyle = '#15171c';
      const sw = this.side * c, mid = 0.5 * c + sw / 2;
      ctx.fillRect(0.5 * c, 1.4 * c, sw, 3 * c);
      if (game.hold) this.mini(game.hold, 0.5 * c, 1.4 * c, sw, 3 * c, game.holdUsed ? 0.35 : 1);
      if (!game.g.hold) this.text('off', mid, 2.9 * c, c * 0.5, '#555c69', 'center');

      // Next queue (the whole drill queue is finite).
      const nx = fx + W * c + 0.5 * c;
      this.text('NEXT', nx, 0.9 * c, c * 0.55, '#8b93a3');
      ctx.fillStyle = '#15171c';
      const shown = game.queue.slice(0, game.preview);
      ctx.fillRect(nx, 1.4 * c, sw, Math.max(1, shown.length) * 2.6 * c + 0.4 * c);
      shown.forEach((t, i) => this.mini(t, nx, 1.6 * c + i * 2.6 * c, sw, 2.4 * c));
      if (!shown.length && game.phase === 'play') this.text('—', nx + sw / 2, 2.7 * c, c * 0.6, '#555c69', 'center');
      if (!game.marathon && game.queue.length > 6) this.text('+' + (game.queue.length - 6) + ' more', nx, 1.4 * c + 6 * 2.6 * c + 1 * c, c * 0.45, '#8b93a3');

      // Marathon: level, lines, score and time under the hold box.
      const m = game.mara;
      if (m) {
        const rows = [
          ['LEVEL', String(m.level)],
          ['LINES', m.lines + (m.target ? '/' + m.target : '')],
          ['SCORE', m.score.toLocaleString('en-US')],
          ['TIME', formatTime(m.time)],
          ['PPS', m.time > 0 ? (m.pieces / (m.time / 1000)).toFixed(2) : '0.00'],
        ];
        rows.forEach(([label, value], i) => {
          const y = 7.4 * c + i * 1.7 * c;
          this.text(label, 0.5 * c, y, c * 0.42, '#8b93a3', 'left', 600, sw);
          this.text(value, 0.5 * c, y + 0.65 * c, c * 0.6, '#e8ebf1', 'left', 700, sw);
        });
      }

      // Drill goal under the field.
      if (goal) this.text(goal.text, fx + W * c / 2, fy + VISIBLE * c + 0.55 * c, c * 0.55, '#c9ced8', 'center');
      ctx.restore();

      this.drawCallout(game, now);

      // Result / status flash.
      const f = game.flash;
      if (f) {
        const cy = fy + VISIBLE * c * 0.4;
        ctx.fillStyle = 'rgba(8,9,12,0.82)';
        ctx.fillRect(fx, cy - 1.6 * c, W * c, (f.sub ? 3.4 : 2.4) * c);
        this.text(f.text, fx + W * c / 2, cy - 0.4 * c, c * (f.text.length > 14 ? 0.62 : 0.9), f.color, 'center', 800, W * c - c * 0.6);
        if (f.sub) this.text(f.sub, fx + W * c / 2, cy + 0.85 * c, c * 0.42, '#c9ced8', 'center', 500, W * c - c * 0.6);
      }
    }
  }

  // Scales a color's HSL saturation and lightness.
  function tone(hex, sat, light) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    }
    return 'hsl(' + Math.round(h * 60) + ',' + Math.round(Math.min(1, s * sat) * 100) + '%,' + Math.round(Math.min(0.95, l * light) * 100) + '%)';
  }

  // m:ss.d
  function formatTime(ms) {
    const s = ms / 1000;
    return Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');
  }

  Renderer.formatTime = formatTime;
  TW.Renderer = Renderer;
})(window.TW);
