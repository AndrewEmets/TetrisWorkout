// Spin detection following TETR.IO's default "all-mini+" rules:
//  - T: 3-corner rule; mini unless both front corners are filled or the TST/fin kick was used.
//  - Any piece (T included) that is immobile after rotating counts at least as a mini spin.
TW.module(function (TW) {
  'use strict';

  function immobile(board, p) {
    return !board.fits(p.type, p.rot, p.x - 1, p.y) &&
      !board.fits(p.type, p.rot, p.x + 1, p.y) &&
      !board.fits(p.type, p.rot, p.x, p.y - 1) &&
      !board.fits(p.type, p.rot, p.x, p.y + 1);
  }

  function tCornerSpin(board, p, tstKick) {
    if (board.fits(p.type, p.rot, p.x, p.y + 1)) return 'none';
    let corners = 0, front = 0;
    for (const c of TW.Pieces.T_CORNERS) {
      if (board.blocked(p.x + c.x, p.y + c.y)) {
        corners++;
        if (c.front.includes(p.rot)) front++;
      }
    }
    if (corners < 3) return 'none';
    return front === 2 || tstKick ? 'full' : 'mini';
  }

  // Evaluated right after a successful rotation. Returns 'none' | 'mini' | 'full'.
  function detect(board, p, tstKick) {
    const t = p.type === 'T' ? tCornerSpin(board, p, tstKick) : 'none';
    if (t === 'full') return 'full';
    if (immobile(board, p)) return 'mini';
    return t;
  }

  const LINE_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'];

  // Display name of a lock result, e.g. "T-SPIN DOUBLE", "MINI T-SPIN SINGLE", "S-SPIN DOUBLE".
  function describe(type, spin, lines) {
    let name = '';
    if (spin !== 'none') {
      name = (type === 'T' && spin === 'mini' ? 'MINI ' : '') + type + '-SPIN';
      if (lines) name += ' ' + LINE_NAMES[lines];
    } else if (lines) {
      name = LINE_NAMES[lines];
    }
    return name;
  }

  TW.Spin = { detect, immobile, describe, LINE_NAMES };
});
