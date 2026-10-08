// Piece definitions. Coordinates are y-down (row 0 is the top of the board).
window.TW = window.TW || {};
// Core modules register through TW.module so their source can also run in the background
// generation worker (built from a Blob, so it works from file:// without fetching files).
TW.sources = TW.sources || [];
TW.module = TW.module || function (fn) { TW.sources.push(fn.toString()); fn(TW); };

TW.module(function (TW) {
  'use strict';

  // State-0 cells inside each piece's SRS bounding box (size N).
  const BASE = {
    I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
    O: { n: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
    S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  };

  const TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

  // Cell value stored on the board for each piece type; 8 = pre-built stack.
  const TYPE_ID = { I: 1, J: 2, L: 3, O: 4, S: 5, T: 6, Z: 7 };
  const ID_TYPE = [null, 'I', 'J', 'L', 'O', 'S', 'T', 'Z'];
  const STACK_ID = 8;

  const COLORS = {
    I: '#2fc0d6', J: '#3c5ce0', L: '#e5781e', O: '#e6c022',
    S: '#5cbf1a', T: '#b34ad0', Z: '#e0393e', 8: '#6b6f78',
  };

  // SHAPES[type][rot] = [[x, y], ...] (clockwise rotation inside the N box).
  const SHAPES = {};
  for (const t of TYPES) {
    const { n, cells } = BASE[t];
    const rots = [cells];
    for (let r = 1; r < 4; r++) {
      rots.push(t === 'O' ? cells : rots[r - 1].map(([x, y]) => [n - 1 - y, x]));
    }
    SHAPES[t] = rots;
  }

  // Spawn position of the bounding box (TETR.IO spawns just above the visible 20 rows).
  const SPAWN_X = 3;
  const SPAWN_Y = 18;

  // T-piece corners relative to the box (center at 1,1) and the rotations for which each is a "front" corner.
  const T_CORNERS = [
    { x: 0, y: 0, front: [3, 0] },
    { x: 2, y: 0, front: [0, 1] },
    { x: 2, y: 2, front: [1, 2] },
    { x: 0, y: 2, front: [2, 3] },
  ];

  function cellsOf(p) {
    return SHAPES[p.type][p.rot].map(([cx, cy]) => [p.x + cx, p.y + cy]);
  }

  TW.Pieces = { SHAPES, TYPES, TYPE_ID, ID_TYPE, STACK_ID, COLORS, SPAWN_X, SPAWN_Y, T_CORNERS, cellsOf };
});
