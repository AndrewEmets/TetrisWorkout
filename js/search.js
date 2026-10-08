// Breadth-first search over every reachable piece state from spawn, using the same
// move/rotate rules as the game. Produces every lockable placement with the spin it can be locked with.
TW.module(function (TW) {
  'use strict';

  const XOFF = 3, YOFF = 4, XS = 16, YS = TW.Board.H + YOFF;
  // SD = sonic drop (soft drop to the floor without locking); listed before D so paths prefer it.
  const OPS = ['L', 'R', 'SD', 'D', 'CW', 'CCW', '180'];
  const SPIN_CODE = { none: 0, mini: 1, full: 2 };

  function encode(x, y, rot) { return ((y + YOFF) * XS + (x + XOFF)) * 4 + rot; }
  function decode(i) {
    const rot = i & 3, r = i >> 2;
    return { x: (r % XS) - XOFF, y: Math.floor(r / XS) - YOFF, rot };
  }

  // Applies one op to a piece; returns { piece, spin } or null. Shared with the self-test replay.
  function applyOp(board, p, op) {
    let n = null;
    switch (op) {
      case 'L': n = board.fits(p.type, p.rot, p.x - 1, p.y) ? { ...p, x: p.x - 1 } : null; break;
      case 'R': n = board.fits(p.type, p.rot, p.x + 1, p.y) ? { ...p, x: p.x + 1 } : null; break;
      case 'D': n = board.fits(p.type, p.rot, p.x, p.y + 1) ? { ...p, y: p.y + 1 } : null; break;
      case 'SD': {
        let y = p.y;
        while (board.fits(p.type, p.rot, p.x, y + 1)) y++;
        n = y > p.y ? { ...p, y } : null;
        break;
      }
      default: {
        const r = TW.SRS.tryRotate(board, p, op === 'CW' ? 1 : op === 'CCW' ? -1 : 2);
        if (!r) return null;
        return { piece: { type: r.type, rot: r.rot, x: r.x, y: r.y }, spin: TW.Spin.detect(board, r, r.tstKick) };
      }
    }
    return n ? { piece: n, spin: 'none' } : null;
  }

  function linesIfPlaced(board, p) {
    const cells = TW.Pieces.cellsOf(p);
    const rows = [...new Set(cells.map((c) => c[1]))];
    let lines = 0;
    for (const y of rows) {
      let full = true;
      for (let x = 0; x < TW.Board.W && full; x++) {
        if (!board.get(x, y) && !cells.some((c) => c[0] === x && c[1] === y)) full = false;
      }
      if (full) lines++;
    }
    return lines;
  }

  function spawnPiece(board, type) {
    const p = { type, rot: 0, x: TW.Pieces.SPAWN_X, y: TW.Pieces.SPAWN_Y };
    if (board.fitsPiece(p)) return p;
    p.y--;
    return board.fitsPiece(p) ? p : null;
  }

  // Returns { placements: [{ type, rot, x, y, spin, lines, prev, op }], pathTo(placement) }.
  function search(board, type) {
    const size = XS * YS * 4;
    const visited = new Uint8Array(size);
    const parent = new Int32Array(size).fill(-1);
    const parentOp = new Uint8Array(size);
    const results = new Map();
    const placements = [];
    const start = spawnPiece(board, type);
    if (!start) return { placements, pathTo: () => null };

    const record = (p, spin, prev, op) => {
      if (board.fits(p.type, p.rot, p.x, p.y + 1)) return;
      const key = encode(p.x, p.y, p.rot) * 3 + SPIN_CODE[spin];
      if (results.has(key)) return;
      const pl = { type, rot: p.rot, x: p.x, y: p.y, spin, lines: linesIfPlaced(board, p), prev, op };
      results.set(key, pl);
      placements.push(pl);
    };

    const s0 = encode(start.x, start.y, start.rot);
    visited[s0] = 1;
    record(start, 'none', -1, -1);
    const queue = [s0];
    for (let qi = 0; qi < queue.length; qi++) {
      const s = queue[qi];
      const d = decode(s);
      const p = { type, rot: d.rot, x: d.x, y: d.y };
      for (let o = 0; o < OPS.length; o++) {
        const res = applyOp(board, p, OPS[o]);
        if (!res) continue;
        const n = res.piece;
        const ni = encode(n.x, n.y, n.rot);
        if (!visited[ni]) {
          visited[ni] = 1;
          parent[ni] = s;
          parentOp[ni] = o;
          queue.push(ni);
        }
        record(n, res.spin, s, o);
      }
    }

    // Op sequence (ending with a hard drop) that reaches the placement with its recorded spin.
    function pathTo(pl) {
      const ops = [];
      if (pl.prev >= 0) {
        ops.push(OPS[pl.op]);
        for (let s = pl.prev; parent[s] >= 0; s = parent[s]) ops.push(OPS[parentOp[s]]);
        ops.reverse();
      }
      ops.push('HD');
      return ops;
    }

    return { placements, pathTo };
  }

  function sameCells(a, b) {
    const ca = TW.Pieces.cellsOf(a).map((c) => c.join(',')).sort().join(';');
    const cb = TW.Pieces.cellsOf(b).map((c) => c.join(',')).sort().join(';');
    return ca === cb;
  }

  TW.Search = { search, applyOp, linesIfPlaced, spawnPiece, sameCells, OPS };
});
