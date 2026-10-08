# Tetris Workout

A small trainer for practicing Tetris techniques: T-spins, S/Z/L/J/I spins, perfect clears and popular openers.
Each drill gives you a board and a queue. Pull off the required clear and you get a new board; miss it and you retry the same one.

Plain HTML + JavaScript + canvas. No libraries and no build step.

## Run

Open `index.html` in a browser. That's it.

## Drills

- **Spins:** T-spin Mini / Single / Double / Triple, plus S, Z, L, J and I spins (single to triple).
  **Setup pieces** (0–3) make you place pieces next to the slot before the spin, so you practice building the slot too.
- **Perfect clear:** 2-line or 4-line, with 2–8 pieces.
- **Openers:** TKI, DT Cannon, Hachispin, PCO and MKO. Bag orders are 7-bag sequences checked to be buildable.
  The shape is outlined on the board while you build it.

Every board is generated procedurally, and a solver confirms it can be solved before you see it.
Use **Hint** to see the next placement, or **Watch solution** for an animated walkthrough. The walkthrough explains wall kicks and why a rotation counts as a spin.

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

Default keys: ← → move, ↓ soft drop, Space hard drop, Z / X rotate, A 180°, C hold, R retry, N new board, H hint.

## Credits

- Opener shapes come from [four.lol](https://four.lol/openers/practical-openers).
- SRS+ kick data was checked against [Triangle.js](https://github.com/halp1/triangle).
