// Canvas renderer: hold box, field (with 2 rows above the visible area), next queue, ghost, hint and messages,
// plus the effects the game emits (effect(), from game.listen): drop trails, board shake, lock and line clear
// flashes, particles and clear callouts.
(function (TW) {
  'use strict';

  const { W, H, VISIBLE } = TW.Board;
  const { SHAPES, COLORS, ID_TYPE, cellsOf } = TW.Pieces;
  const HIDDEN_SHOWN = 2;
  const FIRST_ROW = H - VISIBLE - HIDDEN_SHOWN;
  const ROWS = 23.5;
  // Layouts (sizes in cells): 'side' has hold on the left and next on the right of the field (hold + field + next
  // + margins); 'right' puts next, stats and hold (at the bottom, apart from the queue) in one column on the right,
  // so on a narrow (phone) screen the field gets more of the width. resize() picks whichever gives the bigger field.
  const LAYOUTS = [
    { name: 'side', side: 4.5, cols: 2 * 4.5 + 12 },
    { name: 'side', side: 3, cols: 2 * 3 + 12 },
    { name: 'right', side: 2.6, cols: 0.4 + 10 + 0.4 + 2.6 + 0.4 },
  ];

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
      this.layout = LAYOUTS[0];
      this.skin = 'classic';
      this.skins = new Map(); // pre-rendered blocks: 'skin|color|size' -> canvas
      this.shakes = []; // { t, x, y, dur }: board offsets in cells
      this.trails = []; // { t, dur, color, cols: [{ x, y0, y1 }] }: one shape over the piece's columns
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
        const cols = [...top].map(([x, y]) => ({ x, y0: y, y1: y + e.dist })).sort((a, b) => a.x - b.x);
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

    // A fading streak from where a dropped piece started to where it landed, as wide as the piece: one shape whose
    // top and bottom edges follow the piece's top in each column. It shrinks toward the landing spot.
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
        const cols = t.cols, last = cols.length - 1;
        const left = (i) => this.fx + (cols[i].x + (i === 0 ? 0.08 : 0)) * c;
        const right = (i) => this.fx + (cols[i].x + (i === last ? 0.92 : 1)) * c;
        const tops = cols.map((col) => this.rowY(col.y0 + (col.y1 - col.y0) * ease));
        const bottoms = cols.map((col) => this.rowY(col.y1));
        const top = Math.min(...tops), bottom = Math.max(...bottoms);
        if (bottom - top < 1) continue;
        ctx.beginPath();
        cols.forEach((col, i) => { ctx.lineTo(left(i), tops[i]); ctx.lineTo(right(i), tops[i]); });
        for (let i = last; i >= 0; i--) { ctx.lineTo(right(i), bottoms[i]); ctx.lineTo(left(i), bottoms[i]); }
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, top, 0, bottom);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(1, t.color);
        ctx.globalAlpha = 0.45 * (1 - k);
        ctx.fillStyle = grad;
        ctx.fill();
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
      const fit = (l) => Math.floor(Math.min(parent.clientWidth / l.cols, parent.clientHeight / ROWS));
      this.layout = LAYOUTS.reduce((best, l) => (fit(l) > fit(best) ? l : best));
      const c = Math.max(12, fit(this.layout));
      const COLS = this.layout.cols;
      const dpr = window.devicePixelRatio || 1;
      this.c = c;
      this.skins.clear();
      this.canvas.style.width = COLS * c + 'px';
      this.canvas.style.height = ROWS * c + 'px';
      this.canvas.width = Math.round(COLS * c * dpr);
      this.canvas.height = Math.round(ROWS * c * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    get side() { return this.layout.side; }
    get fx() { return (this.layout.name === 'right' ? 0.4 : this.side + 1) * this.c; }
    get fy() { return 0.5 * this.c + HIDDEN_SHOWN * this.c; }

    // Where the hold box, next queue and marathon stats go (pixels).
    panels(game) {
      const c = this.c, sw = this.side * c;
      if (this.layout.name === 'right') {
        const x = this.fx + W * c + 0.4 * c, holdH = 2.4 * c, holdY = this.fy + VISIBLE * c - holdH;
        const p = { sw, holdX: x, holdLabelY: holdY - 0.5 * c, holdY, holdH, nextX: x, nextLabelY: 0.9 * c, nextY: 1.4 * c, slot: 1.9 * c, statsX: x, statsStep: 1.45 * c };
        p.statsY = p.nextY + game.preview * p.slot + 1.0 * c;
        return p;
      }
      return { sw, holdX: 0.5 * c, holdLabelY: 0.9 * c, holdY: 1.4 * c, holdH: 3 * c, nextX: this.fx + W * c + 0.5 * c, nextLabelY: 0.9 * c, nextY: 1.4 * c, slot: 2.6 * c, statsX: 0.5 * c, statsY: 7.4 * c, statsStep: 1.7 * c };
    }

    cell(x, y, color, size, alpha) {
      const ctx = this.ctx;
      const s = size || this.c;
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.drawImage(this.block(color, s), x, y, s, s);
      ctx.globalAlpha = 1;
    }

    // A block in the current skin, drawn once per color and size at device resolution.
    block(color, s) {
      const key = this.skin + '|' + color + '|' + s;
      let img = this.skins.get(key);
      if (!img) {
        const px = Math.max(1, Math.round(s * (window.devicePixelRatio || 1)));
        img = document.createElement('canvas');
        img.width = img.height = px;
        (SKINS[this.skin] || SKINS.classic)(img.getContext('2d'), px, color);
        this.skins.set(key, img);
      }
      return img;
    }

    fieldCell(x, y, color, alpha) {
      this.cell(this.fx + x * this.c, this.rowY(y), color, this.c, alpha);
    }

    // A dot on the piece's rotation center (the middle of its SRS box; for O, the middle of the O).
    center(p, y, alpha) {
      const ctx = this.ctx, c = this.c, n = p.type === 'I' ? 4 : 3;
      const cx = p.type === 'O' ? p.x + 2 : p.x + n / 2, cy = (p.type === 'O' ? y + 1 : y + n / 2) - FIRST_ROW - HIDDEN_SHOWN;
      if (cy < -HIDDEN_SHOWN) return;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(this.fx + cx * c, this.fy + cy * c, Math.max(2.5, c * 0.13), 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = Math.max(1, c * 0.05);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
      ctx.globalAlpha = 1;
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
      if (game.g.skin !== this.skin) { this.skin = game.g.skin; this.skins.clear(); }
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
        let gy = p.y;
        while (b.fits(p.type, p.rot, p.x, gy + 1)) gy++;
        if (game.g.ghost) {
          for (const [x, y] of cellsOf({ ...p, y: gy })) this.fieldCell(x, y, ACTIVE[p.type], 0.25);
        }
        for (const [x, y] of cellsOf(p)) if (y >= FIRST_ROW) this.fieldCell(x, y, ACTIVE[p.type]);
        if (game.g.showCenter) {
          if (game.g.ghost) this.center(p, gy, 0.4);
          this.center(p, p.y, 1);
        }
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
      const P = this.panels(game), sw = P.sw;
      this.text('HOLD', P.holdX, P.holdLabelY, c * 0.55, '#8b93a3');
      ctx.fillStyle = '#15171c';
      ctx.fillRect(P.holdX, P.holdY, sw, P.holdH);
      if (game.hold) this.mini(game.hold, P.holdX, P.holdY, sw, P.holdH, game.holdUsed ? 0.35 : 1);
      if (!game.g.hold) this.text('off', P.holdX + sw / 2, P.holdY + P.holdH / 2, c * 0.5, '#555c69', 'center');

      // Next queue (the whole drill queue is finite).
      const nx = P.nextX;
      this.text('NEXT', nx, P.nextLabelY, c * 0.55, '#8b93a3');
      ctx.fillStyle = '#15171c';
      const shown = game.queue.slice(0, game.preview);
      ctx.fillRect(nx, P.nextY, sw, Math.max(1, shown.length) * P.slot + 0.4 * c);
      shown.forEach((t, i) => this.mini(t, nx, P.nextY + 0.2 * c + i * P.slot, sw, P.slot - 0.2 * c));
      if (!shown.length && game.phase === 'play') this.text('—', nx + sw / 2, P.nextY + 1.3 * c, c * 0.6, '#555c69', 'center');
      if (!game.marathon && game.queue.length > 6) this.text('+' + (game.queue.length - 6) + ' more', nx, P.nextY + 6 * P.slot + 1 * c, c * 0.45, '#8b93a3', 'left', 600, sw);

      // Marathon: level, lines, score and time (under the hold box, or under the queue in the 'right' layout).
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
          const y = P.statsY + i * P.statsStep;
          this.text(label, P.statsX, y, c * 0.42, '#8b93a3', 'left', 600, sw);
          this.text(value, P.statsX, y + 0.65 * c, c * 0.6, '#e8ebf1', 'left', 700, sw);
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

  // Block skins: draw one block of `color` filling a p x p canvas.
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const SKINS = {
    // Flat with a light top edge and a dark bottom edge.
    classic(ctx, p, color) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, p, p);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(0, 0, p, p * 0.14);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, p * 0.86, p, p * 0.14);
    },
    // Plain squares with a thin gap between them.
    flat(ctx, p, color) {
      const g = Math.max(1, Math.round(p * 0.05));
      ctx.fillStyle = color;
      ctx.fillRect(g, g, p - 2 * g, p - 2 * g);
    },
    // Raised: light top and left bevels, dark right and bottom ones.
    bevel(ctx, p, color) {
      const b = p * 0.17;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, p, p);
      const side = (pts, fill) => {
        ctx.beginPath();
        pts.forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      };
      side([[0, 0], [p, 0], [p - b, b], [b, b]], 'rgba(255,255,255,0.4)');
      side([[0, 0], [b, b], [b, p - b], [0, p]], 'rgba(255,255,255,0.2)');
      side([[p, 0], [p, p], [p - b, p - b], [p - b, b]], 'rgba(0,0,0,0.25)');
      side([[0, p], [b, p - b], [p - b, p - b], [p, p]], 'rgba(0,0,0,0.42)');
    },
    // Rounded and shiny.
    glossy(ctx, p, color) {
      const g = p * 0.05, r = p * 0.2;
      roundRect(ctx, g, g, p - 2 * g, p - 2 * g, r);
      ctx.fillStyle = color;
      ctx.fill();
      const grad = ctx.createLinearGradient(0, 0, 0, p);
      grad.addColorStop(0, 'rgba(255,255,255,0.35)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = grad;
      ctx.fill();
      roundRect(ctx, p * 0.18, p * 0.12, p * 0.64, p * 0.26, p * 0.12);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();
    },
    // 8-bit: dark outline and a pixel highlight in the corner.
    retro(ctx, p, color) {
      const u = p / 8, q = (v) => Math.round(v);
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(0, 0, p, p);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, q(7 * u), q(7 * u));
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(q(u), q(u), q(u), q(u));
      ctx.fillRect(q(2 * u), q(u), q(2 * u), q(u));
      ctx.fillRect(q(u), q(2 * u), q(u), q(u));
    },
    // Glowing outline on a dim fill.
    neon(ctx, p, color) {
      const lw = Math.max(1.5, p * 0.09), g = p * 0.1;
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = color;
      ctx.fillRect(g, g, p - 2 * g, p - 2 * g);
      ctx.globalAlpha = 1;
      ctx.shadowColor = color;
      ctx.shadowBlur = p * 0.25;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      roundRect(ctx, g, g, p - 2 * g, p - 2 * g, p * 0.12);
      ctx.stroke();
      ctx.stroke();
    },
  };

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
