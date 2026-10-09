// Short how-to guides shown next to the board for each drill and opener.
(function (TW) {
  'use strict';

  const ALL_SPIN = `
    <p>TETR.IO uses the <b>all-spin (immobile) rule</b> for every piece except T: the last move must be a
    rotation, and after it the piece must be unable to move left, right or up. TETR.IO shows these as mini
    spins, but they still clear lines with the spin bonus.</p>
    <p>Look for a gap shaped like the piece in its <i>rotated</i> state, with a roof over part of it. Bring the piece
    next to the gap (soft drop until it touches the stack), then rotate: the SRS+ kicks shift it sideways
    and down under the roof.</p>`;

  const SCENARIOS = {
    T: `
      <p>A <b>T-spin</b> needs two things: the last move was a rotation, and at least <b>3 of the 4 diagonal
      corners</b> around the T's center are blocked (walls and floor count).</p>
      <p>It is a <b>full</b> T-spin when both <b>front corners</b> (the two beside the T's pointy side) are
      blocked. With only one front corner it's a <b>mini</b>. The exception is the TST/fin kick (shifting 1 sideways
      and 2 down), which always counts as full.</p>
      <ul>
        <li><b>Single / Double:</b> the slot is a 3-wide gap with a 1-cell notch under its middle and an
        overhang over one side. Slide the T under the overhang flat, then rotate it into the notch.</li>
        <li><b>Triple:</b> the slot is a vertical 3-deep well with a roof on one side. Hold the T above the
        roof pointing up, then rotate toward the well. The kick drops it 2 rows down into the slot.</li>
        <li><b>Mini:</b> the T ends up spun in, but with only one front corner blocked.</li>
      </ul>
      <p>Press <b>Watch solution</b> to see it step by step. The 4 corners are marked on the rotation that makes the spin.</p>`,
    S: ALL_SPIN + '<p><b>S-spins</b> usually rotate the vertical S into a horizontal step under an overhang, or the other way round for doubles and triples.</p>',
    Z: ALL_SPIN + '<p><b>Z-spins</b> mirror S-spins: look for the Z-shaped step with a roof on the left side.</p>',
    L: ALL_SPIN + '<p><b>L-spins</b> often tuck the L\'s foot under an overhang. For triples, the L stands upright in a 3-deep well with a roof and kicks down into it.</p>',
    J: ALL_SPIN + '<p><b>J-spins</b> mirror L-spins: the foot tucks under an overhang on the left.</p>',
    I: ALL_SPIN + '<p><b>I-spins</b>: a horizontal I can rotate into a vertical well under a roof, or a vertical I can kick sideways into a 1-tall tunnel. SRS+ I kicks are symmetric, so both directions behave the same.</p>',
    PC: `
      <p>A <b>perfect clear</b> empties the whole board. Every piece must go below the dashed line.</p>
      <ul>
        <li>Count cells: each empty area under the line must be a multiple of 4 cells. Otherwise it can't be filled.</li>
        <li>Fill awkward spots first, such as the deepest columns and narrow gaps. Keep flat areas for O and I.</li>
        <li>Use hold to swap a piece that has no good spot right now.</li>
        <li>Rows can clear before the end. Pieces above a cleared row drop down, so plan with that in mind.</li>
      </ul>`,
  };

  const OPENERS = {
    tki: `
      <p><b>TKI</b> sends a T-Spin Double with your very first bag. It needs an early <b>I</b>: the I lies flat on the floor
      under the Z, and the Z/S overhang forms the TSD slot.</p>
      <ul>
        <li>The L stands on the far left, and the O and S go on the right.</li>
        <li>The I and Z can be hard dropped straight from spawn.</li>
        <li>Hold the T until the shape is done, then spin it into the slot.</li>
      </ul>`,
    dt: `
      <p><b>DT Cannon</b> builds over two bags and sends a <b>TSD followed by a TST</b> (11 lines with back-to-back).
      The first bag is easiest with an early <b>J/L</b>.</p>
      <ul>
        <li>Bag 1: a flat base with a 1-wide hole in column 3 and the T lying on top.</li>
        <li>Bag 2: build the left wall (J, L) and the overhang that makes the TSD slot. Then TSD.</li>
        <li>After the TSD the TST slot is already there. The L forms its roof. Rotate the T in from above.</li>
      </ul>`,
    hachispin: `
      <p><b>Hachispin</b> covers lots of bags (it mainly needs an early <b>O</b>). It goes
      <b>TSS → TST</b> and often leads into a perfect clear.</p>
      <ul>
        <li>Bag 1: the I stands upright on the left, and the Z/O/S build a small T-slot on the right for the TSS.</li>
        <li>Bag 2: the J and L wall off both sides and the Z/S stair forms the TST slot on the left.</li>
        <li>A misdrop is usually fatal, so place carefully.</li>
      </ul>`,
    pco: `
      <p><b>PCO</b> (Perfect Clear Opener) builds a 4-row shape with 6 pieces of the first bag. The <b>I</b> is kept
      for the perfect clear with the second bag. It works best with early <b>S/Z/T</b>.</p>
      <ul>
        <li>The L/O/J make the left block, and the S/T/Z make the stair on the right.</li>
        <li>The empty middle is filled with the kept I and pieces from bag 2.</li>
      </ul>`,
    mko: `
      <p><b>MKO</b> is an alternative to DT Cannon for an early <b>J/L</b>. The first bag builds a shape that can go for a
      perfect clear (about 1/3 of bags) or T-spin doubles. Here you practice the perfect clear route.</p>
      <ul>
        <li>Keep the T. The PC solutions here use it.</li>
        <li>The I stands on the far right, and the S and J make the left wall.</li>
      </ul>`,
  };

  // PC Opener drills: the first bag is already built; finish the second-bag perfect clear.
  const PC_OPENER = {
    pco: `
      <p>The <b>PCO</b> shape from the first bag is already built, and the <b>I</b> was kept. The second-bag
      perfect clear fills the 4-row hole in the middle. Setup N means the last N + 1 pieces of the
      perfect clear are yours to place.</p>
      <p>The usual solutions put the I <b>vertically</b>, flat in the <b>1st row</b>, or flat in the <b>3rd row</b>.
      The cell under the Z overhang has to be filled with a tuck or a spin.</p>`,
    mko: `
      <p>The <b>MKO</b> shape from the first bag is already built, and the <b>T</b> was kept. Finish the perfect
      clear with the T and the second bag. Setup N means the last N + 1 pieces are yours to place.</p>`,
  };

  const MARATHON = `
    <p><b>Marathon:</b> an endless 7-bag queue. Every few lines (10 by default) the level goes up and the
    pieces fall faster. Gravity is multiplied by the same factor each level, up to 20 G (pieces land
    instantly). Lock delay and the speed curve are under ⚙ Settings → Game.</p>
    <p><b>Garbage</b> keeps the chosen number of gray rows on the board. Each row has the chosen number of
    holes at random columns. Cleared garbage rows come back from the bottom after the next piece that
    doesn't clear a line.</p>
    <p><b>Score</b> follows the guideline, times the level: single / double / triple / quad 100 / 300 / 500 / 800,
    T-spins 400 – 1600, mini and other spins 100 – 400, back-to-back quads and spins ×1.5, combos
    +50 per step, perfect clears +800 – 2000. Soft drop scores 1 per row, hard drop 2.</p>
    <p>The game pauses while Settings, Favorites or the phone menu is open.</p>`;

  function forDrill(scenario, type) {
    if (scenario === 'MA') return MARATHON;
    if (scenario === 'OP') return OPENERS[type] || '';
    if (scenario === 'PO') return (PC_OPENER[type] || '') + SCENARIOS.PC;
    return SCENARIOS[scenario] || '';
  }

  TW.Guides = { forDrill };
})(window.TW);
