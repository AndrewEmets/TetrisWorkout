# Tetris Workout

A small trainer for practicing Tetris techniques: T-spins, S/Z/L/J/I spins, perfect clears and popular openers.
Each drill gives you a board and a queue. Pull off the required clear and you get a new board; miss it and you retry the same one.

Plain HTML + JavaScript + canvas. No libraries and no build step.

**▶ Play: https://andrewemets.github.io/TetrisWorkout/**

## Run

Play online at the link above, or open `index.html` locally in a browser.

## Drills

- **Spins:** T-spin Mini / Single / Double / Triple, plus S, Z, L, J and I spins (single to triple).
  Boards come from a library of wells: named setups (TSD, TSS, TST) plus a few hundred mined ones.
  The well is drawn in color and the rest of the stack in gray.
  **Setup pieces** (0–3) make you build the last pieces of the well yourself. Every setup piece is needed:
  the spin isn't possible before the last one is placed, or with any one of them kept in hold.
- **Perfect clear:** 2-line or 4-line, with 2–8 pieces.
- **Openers:** TKI, DT Cannon, Hachispin, PCO and MKO. Bag orders are 7-bag sequences checked to be buildable.
  The shape is outlined on the board while you build it.

Every board is checked by a solver before you see it.
Some queues come in an order that only works with **hold** (set how often under ⚙ Settings → Game).
Use **Hint** to see the next placement, or **Watch solution** for an animated walkthrough.
The walkthrough explains wall kicks and why a rotation counts as a spin.

**◀ Prev** goes back to earlier boards. **☆** saves a board to **Favorites** so you can replay it later; favorites are stored in your browser.

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
