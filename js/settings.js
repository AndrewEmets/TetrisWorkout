// Settings: defaults, persistence (localStorage), import/export, and the settings modal UI.
(function (TW) {
  'use strict';

  const STORAGE_KEY = 'tetris-workout-settings';
  const VERSION = 1;

  const ACTIONS = [
    ['left', 'Move left'], ['right', 'Move right'], ['softDrop', 'Soft drop'], ['hardDrop', 'Hard drop'],
    ['rotCCW', 'Rotate CCW'], ['rotCW', 'Rotate CW'], ['rot180', 'Rotate 180'], ['hold', 'Hold'],
    ['retry', 'Retry board'], ['prev', 'Previous board'], ['skip', 'Next / new board'], ['hint', 'Show hint'],
    ['favorite', 'Favorite board'], ['target', 'Show / hide opener outline'],
  ];

  const DEFAULTS = {
    version: VERSION,
    controls: {
      keyboard: {
        left: ['ArrowLeft'], right: ['ArrowRight'], softDrop: ['ArrowDown'], hardDrop: ['Space'],
        rotCCW: ['KeyZ', 'ControlLeft'], rotCW: ['KeyX', 'ArrowUp'], rot180: ['KeyA'], hold: ['KeyC', 'ShiftLeft'],
        retry: ['KeyR'], prev: ['KeyB'], skip: ['KeyN'], hint: ['KeyH'], favorite: ['KeyF'], target: ['KeyT'],
      },
      gamepad: {
        left: ['b14', 'a0-'], right: ['b15', 'a0+'], softDrop: ['b13', 'a1+'], hardDrop: ['b12'],
        rotCCW: ['b0'], rotCW: ['b1'], rot180: ['b3'], hold: ['b4', 'b5'],
        retry: ['b8'], prev: [], skip: ['b9'], hint: [], favorite: [], target: [],
      },
      deadzone: 0.5,
      touchSensitivity: 1, touchRotateSwap: false, touchSlideDeadzone: 1, touchLockPause: true,
    },
    handling: {
      das: 10, arr: 2, dcd: 1, sdf: 6,
      cancelDasOnDirChange: true, preferSoftDrop: true,
      irs: 'off', ihs: 'off', hardDropGuard: 0, carryInput: false,
    },
    game: {
      gravity: 0, lockDelay: 30, lockResets: 15,
      hold: true, holdShuffle: 30, ghost: true, showTarget: true, successDelay: 500, failDelay: 800,
    },
    drill: { scenario: 'T', type: 'double', setup: 0 },
    // Last selection in each mode, restored when switching back to it.
    modes: {
      spin: { scenario: 'T', type: 'double', setup: 0 },
      opener: { scenario: 'OP', type: 'tki', setup: 0 },
      pc: { scenario: 'PC', type: '4', setup: 2 },
      marathon: { scenario: 'MA', type: 'marathon', setup: 0 },
    },
    // Marathon: lines = goal (0 = endless); garbage = rows kept on the board (0 = off), each with `holes` holes.
    // Gravity grows by the same factor every level, from gStart (level 1) to gMax (maxLevel and up).
    marathon: { lines: 150, startLevel: 1, garbage: 0, holes: 1, linesPerLevel: 10, gStart: 0.02, gMax: 20, maxLevel: 20 },
  };

  // Field specs for the Handling and Game tabs.
  const FIELDS = {
    handling: [
      { path: 'handling.das', label: 'DAS', hint: 'Delayed auto shift', min: 1, max: 20, step: 0.1, unit: 'f' },
      { path: 'handling.arr', label: 'ARR', hint: 'Auto repeat rate (0 = instant)', min: 0, max: 5, step: 0.1, unit: 'f' },
      { path: 'handling.dcd', label: 'DCD', hint: 'DAS cut delay after rotate / new piece', min: 0, max: 20, step: 0.1, unit: 'f' },
      { path: 'handling.sdf', label: 'SDF', hint: 'Soft drop factor (41 = instant)', min: 5, max: 41, step: 1, unit: 'x' },
      { path: 'handling.hardDropGuard', label: 'Hard drop guard', hint: 'Ignore hard drop for N frames after a new piece (0 = off)', min: 0, max: 20, step: 1, unit: 'f' },
      { path: 'handling.cancelDasOnDirChange', label: 'Cancel DAS when changing directions', type: 'bool' },
      { path: 'handling.preferSoftDrop', label: 'Prefer soft drop over movement', type: 'bool' },
      { path: 'handling.carryInput', label: 'Held moves carry over to the next piece', hint: 'Off: a held move or soft drop stops when a new piece appears; press it again. On: like TETR.IO (a charged DAS moves the new piece right away).', type: 'bool' },
      { path: 'handling.irs', label: 'Initial rotation (IRS)', type: 'select', options: [['off', 'Off'], ['hold', 'Hold']] },
      { path: 'handling.ihs', label: 'Initial hold (IHS)', type: 'select', options: [['off', 'Off'], ['hold', 'Hold']] },
    ],
    game: [
      { path: 'game.gravity', label: 'Gravity', hint: 'Cells per frame in drills (0 = off; pieces only lock on hard drop). Marathon has its own speed curve below.', min: 0, max: 20, step: 0.01, unit: 'G' },
      { path: 'game.lockDelay', label: 'Lock delay', hint: 'Only used when gravity is on', min: 1, max: 120, step: 1, unit: 'f' },
      { path: 'game.lockResets', label: 'Lock resets', min: 0, max: 30, step: 1, unit: '' },
      { path: 'game.hold', label: 'Allow hold', type: 'bool' },
      { path: 'game.holdShuffle', label: 'Queues that need hold', hint: 'Chance that a new board comes with a queue order that only works with hold', min: 0, max: 100, step: 5, unit: '%' },
      { path: 'game.ghost', label: 'Show ghost piece', type: 'bool' },
      { path: 'game.showTarget', label: 'Show opener shape outline', type: 'bool' },
      { path: 'game.successDelay', label: 'Pause after success', min: 0, max: 3000, step: 50, unit: 'ms' },
      { path: 'game.failDelay', label: 'Pause after miss', min: 0, max: 3000, step: 50, unit: 'ms' },
      { path: 'controls.deadzone', label: 'Gamepad stick deadzone', min: 0.1, max: 0.9, step: 0.05, unit: '' },
      { path: 'controls.touchSensitivity', label: 'Touch drag per move', hint: 'Finger travel for one column, in board cells', min: 0.5, max: 2, step: 0.1, unit: 'cells' },
      { path: 'controls.touchSlideDeadzone', label: 'Touch: sideways dead zone in soft drop', hint: 'Extra finger travel before the first sideways move while soft dropping', min: 0, max: 3, step: 0.25, unit: 'cells' },
      { path: 'controls.touchRotateSwap', label: 'Swap touch rotation (tap left = CCW, right = CW)', type: 'bool' },
      { path: 'controls.touchLockPause', label: 'Touch: lock delay waits while a finger is down', hint: 'With gravity, a landed piece doesn\'t lock while you touch the screen, so there is time to lift the finger and tap a spin', type: 'bool' },
      { heading: 'Marathon' },
      { path: 'marathon.linesPerLevel', label: 'Lines per level', min: 1, max: 50, step: 1, unit: '' },
      { path: 'marathon.gStart', label: 'Gravity at level 1', hint: 'Cells per frame (0.0167 G = 1 row per second)', min: 0.005, max: 1, step: 0.005, unit: 'G' },
      { path: 'marathon.gMax', label: 'Top gravity', hint: '20 G drops pieces to the floor instantly', min: 0.1, max: 20, step: 0.1, unit: 'G' },
      { path: 'marathon.maxLevel', label: 'Level with top gravity', hint: 'Gravity is multiplied by the same factor every level until this one (even steps on a log scale)', min: 2, max: 40, step: 1, unit: '' },
    ],
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));

  // Deep-merges `src` over `def`, keeping only keys/types known in the defaults.
  function merge(def, src) {
    if (Array.isArray(def)) return Array.isArray(src) ? src.filter((v) => typeof v === 'string') : clone(def);
    if (def && typeof def === 'object') {
      const out = {};
      for (const k of Object.keys(def)) out[k] = merge(def[k], src && typeof src === 'object' ? src[k] : undefined);
      return out;
    }
    return typeof src === typeof def ? src : def;
  }

  function getPath(obj, path) { return path.split('.').reduce((o, k) => o[k], obj); }
  function setPath(obj, path, v) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = v;
  }

  const Settings = {
    ACTIONS, DEFAULTS, FIELDS,
    data: clone(DEFAULTS),
    listeners: [],

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        this.data = merge(DEFAULTS, raw ? JSON.parse(raw) : null);
      } catch (e) {
        this.data = clone(DEFAULTS);
      }
      return this.data;
    },
    save() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (e) { /* storage unavailable */ }
      this.listeners.forEach((fn) => fn(this.data));
    },
    onChange(fn) { this.listeners.push(fn); },
    get(path) { return getPath(this.data, path); },
    set(path, v) { setPath(this.data, path, v); this.save(); },
    exportJSON() { return JSON.stringify(this.data, null, 2); },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('Not a settings object');
      this.data = merge(DEFAULTS, parsed);
      this.save();
    },
    reset() { this.data = clone(DEFAULTS); this.save(); },

    // Binds `code` to `action` (kind: 'keyboard' | 'gamepad'), removing it from other actions.
    bind(kind, action, code) {
      const map = this.data.controls[kind];
      for (const a of Object.keys(map)) map[a] = map[a].filter((c) => c !== code);
      map[action].push(code);
      this.save();
    },
    unbind(kind, action, code) {
      const map = this.data.controls[kind];
      map[action] = map[action].filter((c) => c !== code);
      this.save();
    },
  };

  // ---------- Display names ----------

  const KEY_NAMES = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', Enter: 'Enter', Backspace: 'Bksp', Tab: 'Tab',
  };
  function keyName(code) {
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    return code;
  }
  const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home'];
  const AXIS_NAMES = { 'a0-': 'LS ←', 'a0+': 'LS →', 'a1-': 'LS ↑', 'a1+': 'LS ↓', 'a2-': 'RS ←', 'a2+': 'RS →', 'a3-': 'RS ↑', 'a3+': 'RS ↓' };
  function padName(id) {
    if (id[0] === 'a') return AXIS_NAMES[id] || 'Axis ' + id.slice(1);
    const i = +id.slice(1);
    return (PAD_BUTTONS[i] || 'Button') + ' (' + i + ')';
  }

  // ---------- Modal UI ----------

  const SettingsUI = {
    open: false,

    init(input) {
      this.input = input;
      this.modal = document.getElementById('settings-modal');
      document.getElementById('btn-settings').addEventListener('click', () => this.show());
      document.getElementById('settings-close').addEventListener('click', () => this.hide());
      this.modal.addEventListener('mousedown', (e) => { if (e.target === this.modal) this.hide(); });
      document.addEventListener('keydown', (e) => {
        if (this.open && e.code === 'Escape' && !input.capturing) this.hide();
      });
      this.modal.querySelectorAll('.tabs button').forEach((b) => {
        b.addEventListener('click', () => this.tab(b.dataset.tab));
      });
      this.initIO();
      Settings.onChange(() => { if (this.open) this.renderAll(); });
    },

    show() {
      this.open = true;
      this.input.releaseAll();
      this.input.enabled = false;
      this.modal.classList.remove('hidden');
      this.renderAll();
    },
    hide() {
      this.input.cancelCapture();
      this.input.enabled = true;
      this.open = false;
      this.modal.classList.add('hidden');
    },
    tab(name) {
      this.modal.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
      this.modal.querySelectorAll('.tab').forEach((s) => s.classList.toggle('hidden', s.dataset.tab !== name));
    },

    renderAll() {
      this.renderControls();
      this.renderFields('handling');
      this.renderFields('game');
      document.getElementById('io-text').value = Settings.exportJSON();
    },

    renderControls() {
      const tbody = document.getElementById('bindings');
      tbody.innerHTML = '';
      for (const [action, label] of ACTIONS) {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.textContent = label;
        tr.appendChild(th);
        for (const kind of ['keyboard', 'gamepad']) {
          const td = document.createElement('td');
          for (const code of Settings.data.controls[kind][action]) {
            const chip = document.createElement('button');
            chip.className = 'chip';
            chip.title = 'Remove';
            chip.textContent = (kind === 'keyboard' ? keyName(code) : padName(code)) + ' ×';
            chip.addEventListener('click', () => Settings.unbind(kind, action, code));
            td.appendChild(chip);
          }
          const add = document.createElement('button');
          add.className = 'chip add';
          add.textContent = '+';
          add.title = kind === 'keyboard' ? 'Press a key (Esc to cancel)' : 'Press a gamepad button or move a stick (Esc to cancel)';
          add.addEventListener('click', () => {
            this.input.cancelCapture();
            add.textContent = kind === 'keyboard' ? 'Press a key…' : 'Press a button…';
            add.classList.add('capturing');
            this.input.capture(kind, (code) => {
              if (code) Settings.bind(kind, action, code);
              else this.renderControls();
            });
          });
          td.appendChild(add);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
      document.getElementById('pad-status').textContent = pads.length
        ? 'Gamepad: ' + pads.map((p) => p.id).join(', ')
        : 'No gamepad detected — press any button on your controller.';
    },

    renderFields(group) {
      const root = document.getElementById('fields-' + group);
      root.innerHTML = '';
      for (const f of FIELDS[group]) {
        if (f.heading) {
          const h = document.createElement('h3');
          h.className = 'fields-heading';
          h.textContent = f.heading;
          root.appendChild(h);
          continue;
        }
        const row = document.createElement('label');
        row.className = 'field';
        const name = document.createElement('span');
        name.className = 'field-name';
        name.textContent = f.label;
        if (f.hint) name.title = f.hint;
        row.appendChild(name);
        const value = Settings.get(f.path);
        if (f.type === 'bool') {
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = value;
          cb.addEventListener('change', () => Settings.set(f.path, cb.checked));
          row.appendChild(cb);
        } else if (f.type === 'select') {
          const sel = document.createElement('select');
          for (const [v, l] of f.options) sel.add(new Option(l, v, false, v === value));
          sel.addEventListener('change', () => Settings.set(f.path, sel.value));
          row.appendChild(sel);
        } else {
          const range = document.createElement('input');
          range.type = 'range';
          Object.assign(range, { min: f.min, max: f.max, step: f.step, value });
          const num = document.createElement('input');
          num.type = 'number';
          Object.assign(num, { min: f.min, max: f.max, step: f.step, value });
          const unit = document.createElement('span');
          unit.className = 'unit';
          const showUnit = (v) => {
            unit.textContent = f.unit === 'f' ? 'f (' + Math.round(v * 1000 / 60) + ' ms)'
              : f.path === 'handling.sdf' && v >= 41 ? '∞' : f.path === 'game.gravity' && v === 0 ? 'off' : f.unit;
          };
          showUnit(value);
          const commit = (v) => {
            v = Math.min(f.max, Math.max(f.min, Number(v)));
            if (Number.isNaN(v)) return;
            range.value = num.value = v;
            showUnit(v);
            Settings.set(f.path, v);
          };
          range.addEventListener('input', () => { num.value = range.value; showUnit(+range.value); });
          range.addEventListener('change', () => commit(range.value));
          num.addEventListener('change', () => commit(num.value));
          row.append(range, num, unit);
        }
        if (f.hint) {
          const h = document.createElement('small');
          h.textContent = f.hint;
          row.appendChild(h);
        }
        root.appendChild(row);
      }
    },

    initIO() {
      const text = document.getElementById('io-text');
      const msg = document.getElementById('io-msg');
      const say = (m, bad) => { msg.textContent = m; msg.className = bad ? 'bad' : 'good'; };
      document.getElementById('io-download').addEventListener('click', () => {
        const blob = new Blob([Settings.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'tetris-workout-settings.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
      document.getElementById('io-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(Settings.exportJSON())
          .then(() => say('Copied to clipboard.'), () => { text.select(); say('Clipboard blocked — text selected, copy it manually.', true); });
      });
      const file = document.getElementById('io-file');
      document.getElementById('io-upload').addEventListener('click', () => file.click());
      file.addEventListener('change', () => {
        const f = file.files[0];
        if (!f) return;
        f.text().then((t) => {
          try { Settings.importJSON(t); say('Imported ' + f.name + '.'); } catch (e) { say('Import failed: ' + e.message, true); }
          file.value = '';
        });
      });
      document.getElementById('io-apply').addEventListener('click', () => {
        try { Settings.importJSON(text.value); say('Settings applied.'); } catch (e) { say('Invalid JSON: ' + e.message, true); }
      });
      document.getElementById('io-reset').addEventListener('click', () => {
        if (confirm('Reset all settings to defaults?')) { Settings.reset(); say('Defaults restored.'); }
      });
    },
  };

  TW.Settings = Settings;
  TW.SettingsUI = SettingsUI;
})(window.TW);
