// SRS+ (TETR.IO) rotation with wall kicks. Offsets are y-down; the (0,0) test is implicit and tried first.
TW.module(function (TW) {
  'use strict';

  const KICKS = {
    '01': [[-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '10': [[1, 0], [1, 1], [0, -2], [1, -2]],
    '12': [[1, 0], [1, 1], [0, -2], [1, -2]],
    '21': [[-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '23': [[1, 0], [1, -1], [0, 2], [1, 2]],
    '32': [[-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '30': [[-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '03': [[1, 0], [1, -1], [0, 2], [1, 2]],
    '02': [[0, -1], [1, -1], [-1, -1], [1, 0], [-1, 0]],
    '13': [[1, 0], [1, -2], [1, -1], [0, -2], [0, -1]],
    '20': [[0, 1], [-1, 1], [1, 1], [-1, 0], [1, 0]],
    '31': [[-1, 0], [-1, -2], [-1, -1], [0, -2], [0, -1]],
  };

  // SRS+ I kicks are symmetric (left side mirrored), unlike guideline SRS.
  const I_KICKS = {
    '01': [[1, 0], [-2, 0], [-2, 1], [1, -2]],
    '10': [[-1, 0], [2, 0], [-1, 2], [2, -1]],
    '12': [[-1, 0], [2, 0], [-1, -2], [2, 1]],
    '21': [[-2, 0], [1, 0], [-2, -1], [1, 2]],
    '23': [[2, 0], [-1, 0], [2, -1], [-1, 2]],
    '32': [[1, 0], [-2, 0], [1, -2], [-2, 1]],
    '30': [[1, 0], [-2, 0], [1, 2], [-2, -1]],
    '03': [[-1, 0], [2, 0], [2, 1], [-1, -2]],
    '02': [[0, -1]],
    '13': [[1, 0]],
    '20': [[0, 1]],
    '31': [[-1, 0]],
  };

  // dir: 1 = CW, -1 = CCW, 2 = 180. Returns the rotated piece or null.
  // Result carries `kick` ([dx, dy]) and `tstKick` (T fin/TST kick that upgrades a mini to a full T-spin).
  function tryRotate(board, p, dir) {
    const to = (p.rot + dir + 4) % 4;
    if (p.type === 'O') {
      return board.fits(p.type, to, p.x, p.y) ? { type: p.type, rot: to, x: p.x, y: p.y, kick: [0, 0], tstKick: false } : null;
    }
    const id = '' + p.rot + to;
    const table = (p.type === 'I' ? I_KICKS : KICKS)[id];
    for (let i = -1; i < table.length; i++) {
      const [dx, dy] = i < 0 ? [0, 0] : table[i];
      if (board.fits(p.type, to, p.x + dx, p.y + dy)) {
        const tstKick = p.type === 'T' && dy === 2 &&
          (((id === '01' || id === '21') && dx === -1) || ((id === '03' || id === '23') && dx === 1));
        return { type: p.type, rot: to, x: p.x + dx, y: p.y + dy, kick: [dx, dy], tstKick };
      }
    }
    return null;
  }

  TW.SRS = { KICKS, I_KICKS, tryRotate };
});
