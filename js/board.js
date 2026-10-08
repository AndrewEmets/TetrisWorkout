// Board: 10 x 40 grid, y-down. The bottom 20 rows (20..39) are the visible field.
TW.module(function (TW) {
  'use strict';

  const W = 10;
  const H = 40;
  const VISIBLE = 20;

  class Board {
    constructor(cells) {
      this.cells = cells || new Uint8Array(W * H);
    }

    clone() {
      return new Board(new Uint8Array(this.cells));
    }

    get(x, y) {
      return this.cells[y * W + x];
    }

    set(x, y, v) {
      this.cells[y * W + x] = v;
    }

    // True if (x, y) is a wall, floor, ceiling or filled cell.
    blocked(x, y) {
      if (x < 0 || x >= W || y < 0 || y >= H) return true;
      return this.cells[y * W + x] !== 0;
    }

    fits(type, rot, x, y) {
      const shape = TW.Pieces.SHAPES[type][rot];
      for (let i = 0; i < 4; i++) {
        if (this.blocked(x + shape[i][0], y + shape[i][1])) return false;
      }
      return true;
    }

    fitsPiece(p) {
      return this.fits(p.type, p.rot, p.x, p.y);
    }

    place(p, value) {
      const v = value || TW.Pieces.TYPE_ID[p.type];
      for (const [x, y] of TW.Pieces.cellsOf(p)) this.set(x, y, v);
    }

    rowFull(y) {
      for (let x = 0; x < W; x++) if (!this.cells[y * W + x]) return false;
      return true;
    }

    rowEmpty(y) {
      for (let x = 0; x < W; x++) if (this.cells[y * W + x]) return false;
      return true;
    }

    fullRows() {
      const rows = [];
      for (let y = 0; y < H; y++) if (this.rowFull(y)) rows.push(y);
      return rows;
    }

    // Removes full rows, shifting everything above down. Returns the number cleared.
    clearLines() {
      let write = H - 1;
      let cleared = 0;
      for (let y = H - 1; y >= 0; y--) {
        if (this.rowFull(y)) { cleared++; continue; }
        if (write !== y) this.cells.copyWithin(write * W, y * W, y * W + W);
        write--;
      }
      for (let y = write; y >= 0; y--) this.cells.fill(0, y * W, y * W + W);
      return cleared;
    }

    isEmpty() {
      for (let i = 0; i < this.cells.length; i++) if (this.cells[i]) return false;
      return true;
    }

    // Number of rows from the floor up to the highest filled cell.
    stackHeight() {
      for (let y = 0; y < H; y++) if (!this.rowEmpty(y)) return H - y;
      return 0;
    }

    equals(other) {
      const a = this.cells, b = other.cells;
      for (let i = 0; i < a.length; i++) if ((a[i] !== 0) !== (b[i] !== 0)) return false;
      return true;
    }

    // Rows given top-to-bottom and aligned to the floor: piece letters (IJLOSTZ) keep their color,
    // '#'/'X' are gray stack cells, anything else is empty.
    static fromRows(rows) {
      const b = new Board();
      const top = H - rows.length;
      rows.forEach((row, i) => {
        for (let x = 0; x < W; x++) {
          const ch = (row[x] || '.').toUpperCase();
          if (TW.Pieces.TYPE_ID[ch]) b.set(x, top + i, TW.Pieces.TYPE_ID[ch]);
          else if (ch === '#' || ch === 'X') b.set(x, top + i, TW.Pieces.STACK_ID);
        }
      });
      return b;
    }

    // Rows top-to-bottom from the highest filled cell: piece letters, '#' gray, '.' empty.
    // An optional piece is drawn in lowercase.
    toLetterRows(piece) {
      const pc = new Set(piece ? TW.Pieces.cellsOf(piece).map(([x, y]) => y * W + x) : []);
      let top = H - this.stackHeight();
      if (piece) top = Math.min(top, ...TW.Pieces.cellsOf(piece).map((c) => c[1]));
      const out = [];
      for (let y = Math.min(top, H - 1); y < H; y++) {
        let s = '';
        for (let x = 0; x < W; x++) {
          const v = this.get(x, y);
          s += pc.has(y * W + x) ? piece.type.toLowerCase() : v === 0 ? '.' : v === TW.Pieces.STACK_ID ? '#' : TW.Pieces.ID_TYPE[v];
        }
        out.push(s);
      }
      return out;
    }

    toRows() {
      const out = [];
      for (let y = H - this.stackHeight(); y < H; y++) {
        let s = '';
        for (let x = 0; x < W; x++) s += this.get(x, y) ? '#' : '.';
        out.push(s);
      }
      return out;
    }
  }

  Board.W = W;
  Board.H = H;
  Board.VISIBLE = VISIBLE;
  TW.Board = Board;
});
