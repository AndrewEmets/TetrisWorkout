# Tetris Workout

A small trainer for practicing Tetris techniques: T-spins, S/Z/L/J/I spins, perfect clears and popular openers,
plus a classic Marathon.
Each drill gives you a board and a queue. Pull off the required clear and you get a new board; miss it and you retry the same one.

Plain HTML + JavaScript + canvas. No libraries and no build step.

**▶ Play: https://andrewemets.github.io/TetrisWorkout/**

## Run

Play online at the link above, or open `index.html` locally in a browser.

## Modes

Pick a **Mode** (Spin, Opener, Perfect Clear, Marathon) in the toolbar; the selects next to it are that mode's
options. Each mode remembers its last selection.

- **Spins:** T-spin Mini / Single / Double / Triple, plus S, Z, L, J and I spins (single to triple).
  Boards come from a library of wells: named setups (TSD, TSS, TST) plus a few hundred mined ones.
  The well is drawn in color and the rest of the stack in gray.
  **Setup pieces** (0–3) make you build the last pieces of the well yourself. Every setup piece is needed:
  the spin isn't possible before the last one is placed, or with any one of them kept in hold.
- **Perfect clear:** 2-line or 4-line, with 2–8 pieces.
- **PC openers** (under Perfect Clear, "2nd bag"): PCO and MKO. The first-bag shape is already built; finish the second-bag perfect clear.
  **Setup pieces** (0–3) set how many pieces are yours to place: 0 means only the last piece, 3 the whole
  perfect clear (the kept I or T plus three pieces). Any perfect clear counts, not just the one the solver found.
- **Openers:** TKI, DT Cannon, Hachispin, PCO and MKO. Bag orders are 7-bag sequences checked to be buildable.
  The shape is outlined on the board while you build it (toggle with **Outline** or T).
  Only the key pieces (the spin well and its overhangs) have a fixed spot. In the last building step, filler
  pieces can go anywhere, as long as the spin still works (for TKI: fill the two rows the TSD clears). In earlier
  steps the next bag builds on the exact shape, so fillers have to fill it, in any arrangement and order.
  After every piece a solver checks that the opener can still be finished, on either side; you only fail when
  it can't. Every opener can also be built mirrored: queues are checked to work on both sides, and the
  outline switches to the side you are building.

- **Marathon:** an endless 7-bag game for 150 or 300 lines, or endless, from a chosen start level. The level goes
  up every 10 lines and gravity grows by the same factor each level (a straight line on a log scale), from
  0.02 G at level 1 to 20 G at level 20. Lines per level and the speed curve are in ⚙ Settings → Game.
  **Garbage** keeps 1–12 gray rows on the board, each with 1–5 holes at random columns. Cleared rows come back
  after the next piece that doesn't clear a line. Guideline scoring (spins, back-to-back, combos, perfect
  clears); the best score, lines and time are kept for each setup.

Every drill board is checked by a solver before you see it.
Some queues come in an order that only works with **hold** (set how often under ⚙ Settings → Game).
Use **Hint** to see the next placement, or **Watch solution** for an animated walkthrough.
The walkthrough explains wall kicks and why a rotation counts as a spin.

**◀ Prev** goes back to earlier boards. **☆** saves a board to **Favorites** so you can replay it later; favorites are stored in your browser.

## Touch controls

On a phone or tablet, play on the board area:

- **Drag left / right:** move the piece. Slow drags take more finger travel per column (1.5 cells), so short
  moves are easy to stop on the right column; fast drags take less (0.6 cells), to cross the board quickly.
  Going back after a step takes only half a cell, so an overshoot is easy to fix.
  Optionally a fast sideways flick, released mid-motion, sends the piece to the wall.
- **Drag down and keep the finger down:** soft drop, like holding the soft drop key; move back up to stop.
  It also works in the middle of a sideways drag. Moving sideways while soft dropping slides the piece and
  pauses the drop (moving down again resumes it), so the piece never falls diagonally and you can slide it
  under an overhang without lifting the finger. The first sideways step there needs a little extra travel
  (a dead zone, adjustable in ⚙ Settings → Touch) so the piece doesn't shift by accident.
- **Swipe down fast and keep the finger down:** sonic drop. The piece falls straight to the floor but doesn't
  lock, so you can still slide or spin it (with gravity on it locks after the lock delay, once you lift).
- **Swipe down fast and let go:** hard drop. **Swipe up:** hold; after a sideways drag, swipe up and let go.
  Each movement counts only along its own direction (sideways, down or up, within 35°), so drift during a
  swipe doesn't move the piece and a diagonal drag does nothing.
- **Tap:** the play area is split like a Y around its center. Tap the top sector to rotate 180°, the lower
  left one to rotate CW and the lower right one CCW.
- **Haptics** (Android): moves, rotations, hold, soft drop, landing, hard drop and line clears vibrate.
- With gravity on, a landed piece doesn't lock while your finger is on the screen, so there is time to lift
  it and tap a spin (lock delay starts after you lift; it can be turned off in ⚙ Settings → Touch).
  All touch options (drag distances, taps, haptics…) are in ⚙ Settings → Touch.

The gestures are covered by tests: `node tools/test-touch.js` (the pre-commit hook runs them).

On a phone the toolbar folds under the ☰ button; retry and next stay next to it. The board area fills the
screen and takes gestures everywhere, even around the board; the goal, guide and stats open with the ℹ button.

## Mechanics

Mechanics follow TETR.IO:

- SRS+ rotation, including 180° kicks
- T-spins use the 3-corner rule, with TST/fin kicks counting as full
- other pieces use the all-spin (immobile) rule
- DAS / ARR / DCD / SDF handling

Gravity is off by default.

## Settings

Under ⚙ Settings you can:

- rebind the keyboard and gamepad
- adjust handling timings
- change game options
- import and export your settings as JSON

Settings are saved in the browser.

Default keys: ← → move, ↓ soft drop, Space hard drop, Z / X rotate, A 180°, C hold, R retry, B previous board, N next / new board, H hint, F favorite.

## Well library

`js/wells-data.js` is generated. To rebuild it (Node.js):

```
node tools/mine-wells.js [templates per drill type] [seconds per drill type]
```

## Cache busting

`index.html` loads every script with a `?v=<hash>` stamp so browsers pick up new versions.
`tools/stamp-versions.js` updates the stamps; enable the pre-commit hook that runs it with:

```
git config core.hooksPath tools
```

## Credits

- Opener shapes come from [four.lol](https://four.lol/openers/practical-openers).
- SRS+ kick data was checked against [Triangle.js](https://github.com/halp1/triangle).
