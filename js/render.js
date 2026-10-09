// Canvas renderer: hold box, field (with 2 rows above the visible area), next queue, ghost, hint and messages.
(function (TW) {
  'use strict';

  const { W, H, VISIBLE } = TW.Board;
  const { SHAPES, COLORS, ID_TYPE, cellsOf } = TW.Pieces;
  const HIDDEN_SHOWN = 2;
  const FIRST_ROW = H - VISIBLE - HIDDEN_SHOWN;
  const COLS = 21; // 5 (hold) + 10 (field) + 5 (next) + margins
  const ROWS = 23.5;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.c = 24;
    }

    resize() {
      const parent = this.canvas.parentElement;
      const c = Math.max(12, Math.floor(Math.min(parent.clientWidth / COLS, parent.clientHeight / ROWS)));
      const dpr = window.devicePixelRatio || 1;
      this.c = c;
      this.canvas.style.width = COLS * c + 'px';
      this.canvas.style.height = ROWS * c + 'px';
      this.canvas.width = Math.round(COLS * c * dpr);
      this.canvas.height = Math.round(ROWS * c * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    get fx() { return 5.5 * this.c; }
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
      this.cell(this.fx + x * this.c, this.fy + (y - FIRST_ROW - HIDDEN_SHOWN) * this.c, color, this.c, alpha);
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
      const s = this.c * 0.8;
      const xs = shape.map((p) => p[0]), ys = shape.map((p) => p[1]);
      const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
      const ox = x + (w - (maxx - minx + 1) * s) / 2, oy = y + (h - (maxy - miny + 1) * s) / 2;
      for (const [cx, cy] of shape) this.cell(ox + (cx - minx) * s, oy + (cy - miny) * s, COLORS[type], s, alpha);
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
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

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
          if (v) this.fieldCell(x, y, COLORS[ID_TYPE[v] || v], y < FIRST_ROW + HIDDEN_SHOWN ? 0.6 : 1);
        }
      }

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
          for (const [x, y] of cellsOf({ ...p, y: gy })) this.fieldCell(x, y, COLORS[p.type], 0.25);
        }
        for (const [x, y] of cellsOf(p)) if (y >= FIRST_ROW) this.fieldCell(x, y, COLORS[p.type]);
      }

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
      ctx.fillRect(0.5 * c, 1.4 * c, 4.5 * c, 3 * c);
      if (game.hold) this.mini(game.hold, 0.5 * c, 1.4 * c, 4.5 * c, 3 * c, game.holdUsed ? 0.35 : 1);
      if (!game.g.hold) this.text('off', 2.75 * c, 2.9 * c, c * 0.5, '#555c69', 'center');

      // Next queue (the whole drill queue is finite).
      const nx = fx + W * c + 0.5 * c;
      this.text('NEXT', nx, 0.9 * c, c * 0.55, '#8b93a3');
      ctx.fillStyle = '#15171c';
      const shown = game.queue.slice(0, 6);
      ctx.fillRect(nx, 1.4 * c, 4.5 * c, Math.max(1, shown.length) * 2.6 * c + 0.4 * c);
      shown.forEach((t, i) => this.mini(t, nx, 1.6 * c + i * 2.6 * c, 4.5 * c, 2.4 * c));
      if (!shown.length && game.phase === 'play') this.text('—', nx + 2.25 * c, 2.7 * c, c * 0.6, '#555c69', 'center');
      if (game.queue.length > 6) this.text('+' + (game.queue.length - 6) + ' more', nx, 1.4 * c + 6 * 2.6 * c + 1 * c, c * 0.45, '#8b93a3');

      // Last clear name.
      const lc = game.lastClear;
      if (lc && lc.text && performance.now() - lc.t < 1500) {
        this.text(lc.text, 2.75 * c, 6 * c, c * 0.5, '#e8ebf1', 'center', 700, 4.6 * c);
      }

      // Drill goal under the field.
      if (goal) this.text(goal.text, fx + W * c / 2, fy + VISIBLE * c + 0.55 * c, c * 0.55, '#c9ced8', 'center');

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

  TW.Renderer = Renderer;
})(window.TW);
