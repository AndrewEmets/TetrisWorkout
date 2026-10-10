// Bootstrap: wires settings, input, game, renderer and the page UI, then runs the frame loop.
(function (TW) {
  'use strict';

  const settings = TW.Settings;
  settings.load();

  const input = new TW.Input(settings);
  input.attach();
  const game = new TW.Game(settings, input);
  TW.game = game;
  const renderer = new TW.Renderer(document.getElementById('canvas'));
  TW.SettingsUI.init(input);

  // Favorites: the F action toggles the current board; the modal plays a saved one.
  TW.Favorites.load();
  const gamePress = input.onPress;
  input.onPress = (a) => {
    if (a === 'favorite') { if (game.drill && !game.marathon) TW.Favorites.toggle(game.drill); }
    else if (a === 'target') settings.set('game.showTarget', !settings.data.game.showTarget);
    else gamePress(a);
  };
  TW.Favorites.onChange(() => { game.changed = true; });

  // Foldable side panels remember whether they are open.
  const PANELS_KEY = 'tetris-workout-panels';
  let panelState = {};
  try {
    panelState = JSON.parse(localStorage.getItem(PANELS_KEY)) || {};
    if (localStorage.getItem('tetris-workout-debug-open') === '1') panelState.debug = true; // older key
  } catch (e) { /* ignore */ }
  for (const el of document.querySelectorAll('details.panel')) {
    const key = el.dataset.panel;
    if (typeof panelState[key] === 'boolean') el.open = panelState[key];
    el.addEventListener('toggle', () => {
      panelState[key] = el.open;
      try { localStorage.setItem(PANELS_KEY, JSON.stringify(panelState)); } catch (e) { /* ignore */ }
    });
  }

  // ---------- Mode selectors ----------
  // Mode (spin / opener / perfect clear / marathon), then that mode's own options. Drills keep their
  // scenario / type / setup keys underneath; the last selection of each mode is remembered.

  const { SCENARIOS, MAX_SETUP } = TW.Generator;
  const MODES = [['spin', 'Spin'], ['opener', 'Opener'], ['pc', 'Perfect Clear'], ['marathon', 'Marathon']];
  const SPIN_PIECES = ['T', 'S', 'Z', 'L', 'J', 'I'];
  const modeOf = (sc) => (sc === 'MA' ? 'marathon' : sc === 'OP' ? 'opener' : sc === 'PC' || sc === 'PO' ? 'pc' : 'spin');
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const selMode = document.getElementById('sel-mode');
  const subOpts = document.getElementById('sub-opts');
  for (const [k, label] of MODES) selMode.add(new Option(label, k));

  // Makes the selection valid: known scenario, a type of that scenario, setup in range.
  function normalize(d) {
    if (d.scenario === 'MA') { d.type = 'marathon'; d.setup = 0; return d; }
    if (!SCENARIOS[d.scenario]) { d.scenario = 'T'; d.type = 'double'; }
    const sc = SCENARIOS[d.scenario];
    if (!sc.types.some((t) => t[0] === d.type)) d.type = sc.types[0][0];
    const max = d.scenario === 'PC' ? MAX_SETUP.pc : d.scenario === 'OP' ? 0 : d.scenario === 'PO' ? MAX_SETUP.po : MAX_SETUP.spin;
    d.setup = Math.min(Math.max(0, d.setup | 0), max);
    return d;
  }

  // The option selects for the current mode: { label, options: [[value, text]], value, set(value) }.
  function subOptions(d) {
    const mode = modeOf(d.scenario);
    const setupOpt = (max, text) => ({ label: 'Setup pieces', options: range(0, max).map((i) => [i, text ? text(i) : String(i)]), value: d.setup, set: (v) => { d.setup = +v; } });
    if (mode === 'spin') {
      return [
        { label: 'Piece', options: SPIN_PIECES.map((p) => [p, p]), value: d.scenario, set: (v) => { d.scenario = v; } },
        { label: 'Type', options: SCENARIOS[d.scenario].types.map((t) => [t[0], t[1]]), value: d.type, set: (v) => { d.type = v; } },
        setupOpt(MAX_SETUP.spin),
      ];
    }
    if (mode === 'opener') {
      return [{ label: 'Opener', options: SCENARIOS.OP.types, value: d.type, set: (v) => { d.type = v; } }];
    }
    if (mode === 'pc') {
      const kinds = SCENARIOS.PC.types.map((t) => ['PC:' + t[0], t[1]])
        .concat(SCENARIOS.PO.types.map((t) => ['PO:' + t[0], t[1] + ' (2nd bag)']));
      const opts = [{ label: 'Type', options: kinds, value: d.scenario + ':' + d.type, set: (v) => { [d.scenario, d.type] = v.split(':'); } }];
      if (d.scenario === 'PC') opts.push(Object.assign(setupOpt(MAX_SETUP.pc, (i) => String(i + 2)), { label: 'Pieces' }));
      else opts.push(setupOpt(MAX_SETUP.po));
      return opts;
    }
    const m = settings.data.marathon;
    const opts = [
      { label: 'Lines', options: [[150, '150'], [300, '300'], [0, 'Endless']], value: m.lines, set: (v) => { m.lines = +v; } },
      { label: 'Start level', options: range(1, 20).map((i) => [i, String(i)]), value: m.startLevel, set: (v) => { m.startLevel = +v; } },
      { label: 'Garbage', options: [[0, 'Off']].concat(range(1, 12).map((i) => [i, i + (i > 1 ? ' rows' : ' row')])), value: m.garbage, set: (v) => { m.garbage = +v; } },
    ];
    if (m.garbage) opts.push({ label: 'Holes', options: range(1, 5).map((i) => [i, String(i)]), value: m.holes, set: (v) => { m.holes = +v; } });
    return opts;
  }

  function fillDrillSelectors() {
    const d = normalize(settings.data.drill);
    const mode = modeOf(d.scenario);
    settings.data.modes[mode] = { scenario: d.scenario, type: d.type, setup: d.setup };
    selMode.value = mode;
    subOpts.innerHTML = '';
    for (const o of subOptions(d)) {
      const label = document.createElement('label');
      label.append(o.label + ' ');
      const sel = document.createElement('select');
      for (const [v, text] of o.options) sel.add(new Option(text, String(v)));
      sel.value = String(o.value);
      sel.addEventListener('change', () => {
        o.set(sel.value);
        normalize(d);
        fillDrillSelectors();
        settings.save(); // the onChange listener below starts a new drill
        sel.blur();
      });
      label.appendChild(sel);
      subOpts.appendChild(label);
    }
    for (const id of ['btn-prev', 'btn-hint', 'btn-target', 'btn-fav']) $(id).classList.toggle('hidden', mode === 'marathon');
    $('btn-new').textContent = mode === 'marathon' ? 'New game ▶' : 'Next ▶';
    renderGuide();
  }

  function $(id) { return document.getElementById(id); }

  function renderGuide() {
    const d = settings.data.drill;
    let html = TW.Guides.forDrill(d.scenario, d.type);
    const op = (d.scenario === 'OP' || d.scenario === 'PO') && TW.Openers.OPENERS[d.type];
    if (op) html += '<p class="muted">Shapes from <a href="' + op.source + '" target="_blank" rel="noopener">four.lol</a>.</p>';
    document.getElementById('guide-text').innerHTML = html;
  }

  selMode.addEventListener('change', () => {
    settings.data.drill = Object.assign({}, settings.data.modes[selMode.value]);
    fillDrillSelectors();
    settings.save();
    selMode.blur();
  });
  fillDrillSelectors();

  // Settings import/reset may change the drill selection.
  let lastDrillKey = game.currentKey();
  settings.onChange(() => {
    if (game.currentKey() !== lastDrillKey) {
      lastDrillKey = game.currentKey();
      fillDrillSelectors();
      game.newDrill();
    }
    game.changed = true;
  });

  const blurAfter = (id, fn) => document.getElementById(id).addEventListener('click', (e) => { fn(); e.currentTarget.blur(); });
  // Phone toolbar: the controls fold under the ☰ button; a button press or a tap elsewhere closes it.
  const bar = document.getElementById('bar');
  const menuBtn = document.getElementById('btn-menu');
  // The info panels (goal, guide, stats) open over the board with the ℹ button. Marathon pauses meanwhile.
  const infoBtn = document.getElementById('q-info');
  const paused = () => { game.menuOpen = bar.classList.contains('open') || document.body.classList.contains('info-open'); };
  const setMenu = (open) => { bar.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); paused(); };
  const setInfo = (open) => { document.body.classList.toggle('info-open', open); infoBtn.setAttribute('aria-expanded', String(open)); paused(); };
  menuBtn.addEventListener('click', () => { setMenu(!bar.classList.contains('open')); setInfo(false); menuBtn.blur(); });
  infoBtn.addEventListener('click', () => { setInfo(!document.body.classList.contains('info-open')); setMenu(false); infoBtn.blur(); });
  document.getElementById('bar-menu').addEventListener('click', (e) => { if (e.target.closest('button')) setMenu(false); });
  document.addEventListener('pointerdown', (e) => { if (!bar.contains(e.target)) setMenu(false); });
  document.getElementById('btn-demo').addEventListener('click', () => setInfo(false)); // watch it on the board
  blurAfter('q-retry', () => game.onPress('retry'));
  blurAfter('q-new', () => game.onPress('skip'));

  blurAfter('btn-prev', () => game.onPress('prev'));
  blurAfter('btn-fav', () => input.onPress('favorite'));
  blurAfter('btn-favs', () => TW.FavoritesUI.show());
  TW.FavoritesUI.init(input, (d) => {
    settings.data.drill = { scenario: d.scenario, type: d.type, setup: d.setup };
    lastDrillKey = game.currentKey(); // switch the selectors without generating a new board
    fillDrillSelectors();
    settings.save();
    game.loadDrill(d);
  });
  blurAfter('btn-new', () => game.onPress('skip'));
  blurAfter('btn-retry', () => game.onPress('retry'));
  blurAfter('btn-hint', () => game.onPress('hint'));
  blurAfter('btn-target', () => input.onPress('target'));
  blurAfter('btn-copy', () => {
    const text = TW.debug.describe(game);
    const btn = document.getElementById('btn-copy');
    const done = (label) => { btn.textContent = label; setTimeout(() => { btn.textContent = '⧉ Copy board'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done('✓ Copied'), () => { window.prompt('Copy this text:', text); });
    } else {
      window.prompt('Copy this text:', text);
    }
  });
  blurAfter('btn-demo', () => game.startDemo());
  blurAfter('demo-prev', () => game.demoStep(-1));
  blurAfter('demo-next', () => game.demoStep(1));
  blurAfter('demo-play', () => game.demoToggle());
  blurAfter('demo-exit', () => game.stopDemo());
  blurAfter('btn-reset-stats', () => {
    if (game.marathon) { if (confirm('Reset the best results for this marathon setup?')) game.resetMarathonStats(); }
    else if (confirm('Reset all stats?')) game.resetStats();
  });

  // ---------- Info panel ----------

  const pct = (s, a) => (a ? s + ' / ' + a + ' (' + Math.round((100 * s) / a) + '%)' : '—');

  const touchDevice = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  function keysHelp() {
    const kb = settings.data.controls.keyboard;
    const name = (a) => (kb[a][0] ? kb[a][0].replace(/^Key|^Digit/, '').replace('Arrow', '') : '—');
    return (touchDevice ? [TW.Touch.help(settings)] : []).concat([
      'Move: ' + name('left') + ' / ' + name('right') + '   Soft: ' + name('softDrop'),
      'Hard drop: ' + name('hardDrop') + '   Hold: ' + name('hold'),
      'Rotate: ' + name('rotCCW') + ' / ' + name('rotCW') + ' / 180: ' + name('rot180'),
      'Retry: ' + name('retry') + '   Prev / Next: ' + name('prev') + ' / ' + name('skip') + '   Hint: ' + name('hint'),
      'Favorite: ' + name('favorite') + '   Opener outline: ' + name('target'),
    ]).join('\n');
  }

  function marathonDetail() {
    const m = settings.data.marathon;
    const g = TW.Game.levelGravity(m, game.mara ? game.mara.level : m.startLevel);
    let s = (m.lines ? 'Clear ' + m.lines + ' lines. ' : 'Play as long as you can. ') +
      'The level goes up every ' + m.linesPerLevel + ' lines, and with it the gravity (now ' +
      (g >= 1 ? g.toFixed(1) : g.toFixed(3)) + ' G).';
    if (m.garbage) s += ' ' + m.garbage + ' garbage row' + (m.garbage > 1 ? 's' : '') + ' with ' + m.holes + ' hole' + (m.holes > 1 ? 's' : '') + ' each: cleared rows come back after the next piece that clears nothing.';
    return s;
  }

  function updateStats() {
    const st = game.stats;
    const label = (id, text) => { $(id + '-l').textContent = text; };
    if (game.marathon) {
      const b = game.marathonStats[game.marathonKey()] || { games: 0, score: 0, lines: 0, time: 0 };
      label('st-drill', 'Best score'); $('st-drill').textContent = b.games ? b.score.toLocaleString('en-US') : '—';
      label('st-total', 'Most lines'); $('st-total').textContent = b.games ? b.lines : '—';
      label('st-streak', 'Best time'); $('st-streak').textContent = b.time ? TW.Renderer.formatTime(b.time) : '—';
      label('st-best', 'Games'); $('st-best').textContent = b.games;
      return;
    }
    const d = game.drill;
    const per = d && st.per[game.drillKey(d)];
    label('st-drill', 'This drill'); $('st-drill').textContent = per ? pct(per.s, per.a) : '—';
    label('st-total', 'Total'); $('st-total').textContent = pct(st.successes, st.attempts);
    label('st-streak', 'Streak'); $('st-streak').textContent = st.streak;
    label('st-best', 'Best streak'); $('st-best').textContent = st.best;
  }

  function updateInfo() {
    const d = game.drill;
    $('goal-text').textContent = d ? d.goal.text : '—';
    $('bar-title').textContent = d ? d.goal.text + (d.setup ? ' · ' + (d.scenario === 'PC' ? d.queue.length + ' pieces' : d.setup + ' setup') : '') : '';
    let detail = '';
    if (d) {
      const op = game.opener;
      if (d.goal.kind === 'marathon') detail = marathonDetail();
      else if (op) {
        const k = Math.min(game.op ? game.op.k : 0, op.phases.length - 1);
        detail = 'Step ' + (k + 1) + ' of ' + op.phases.length + ': ' + op.phases[k].label + '.';
        if (op.mirrored) detail += ' (Mirrored.)';
        if (k === 0 && game.ops && game.ops.length > 1) detail += ' Either side counts.';
      } else if (d.goal.kind === 'pc') detail = 'Clear the whole board using ' + d.queue.length + ' piece' + (d.queue.length > 1 ? 's' : '') + '. Stay under the dashed line.';
      else if (d.setup) detail = 'Place ' + d.setup + ' setup piece' + (d.setup > 1 ? 's' : '') + ' first, then spin the ' + d.goal.piece + '.';
      else detail = 'Spin the ' + d.goal.piece + ' into the slot.';
      if (d.well && d.well.name) detail = 'Setup: ' + d.well.name + '. ' + detail;
      if (d.needsHold) detail += ' The queue order needs hold.';
    }
    $('goal-detail').textContent = detail;
    updateStats();
    $('keys-help').textContent = keysHelp();
    $('btn-hint').classList.toggle('active', game.hintVisible);
    $('btn-target').classList.toggle('active', settings.data.game.showTarget);
    $('btn-prev').disabled = !game.hasPrev();
    const fav = TW.Favorites.has(d);
    $('btn-fav').textContent = fav ? '★' : '☆';
    $('btn-fav').classList.toggle('on', fav);
    $('btn-fav').title = fav ? 'Remove this board from favorites (F)' : 'Add this board to favorites (F)';
    $('btn-favs').textContent = 'Favorites' + (TW.Favorites.list.length ? ' (' + TW.Favorites.list.length + ')' : '');
    const df = game.demoFrame();
    $('demo-controls').classList.toggle('hidden', !df);
    $('btn-demo').classList.toggle('hidden', !!df || game.marathon);
    if (df) {
      $('demo-caption').textContent = df.caption;
      $('demo-pos').textContent = (game.demo.i + 1) + ' / ' + game.demo.frames.length;
      $('demo-play').textContent = game.demo.playing ? '❚❚' : '▶';
    }
  }

  // ---------- Loop ----------

  function resize() { renderer.resize(); }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(document.getElementById('stage'));
  resize();

  const sound = new TW.Sound(settings);
  TW.sound = sound;
  game.listen((e) => { renderer.effect(e, game.g); sound.event(e); });

  // Installable app (Add to Home screen opens without the browser UI); the service worker also lets it start offline.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline play is optional */ });
  }

  TW.Touch.attach(document.getElementById('stage'), { game, input, settings, cell: () => renderer.c });

  let last = performance.now();
  // ---------- Debug panel ----------

  const debugPanel = $('debug-panel');
  let fpsFrames = 0, fpsSince = performance.now();
  function updateDebug(now) {
    fpsFrames++;
    if (now - fpsSince < 500) return;
    const fps = (fpsFrames * 1000) / (now - fpsSince);
    fpsFrames = 0;
    fpsSince = now;
    if (!debugPanel.open) return;
    $('dbg-fps').textContent = fps.toFixed(0);
    const d = game.drill;
    $('dbg-gen').textContent = d && d.genMs != null
      ? Math.round(d.genMs) + ' ms' + (d.attempts ? ' (' + d.attempts + ' attempts)' : '')
      : '—';
    const p = game.pending;
    $('dbg-next').textContent = !p ? '—' : p.drill === undefined ? 'generating…' : p.drill ? 'ready (' + Math.round(p.drill.genMs || 0) + ' ms)' : 'failed';
    $('dbg-where').textContent = game.gen.background ? 'background worker' : 'main thread';
    $('dbg-well').textContent = !d ? '—' : d.well ? d.well.id : d.goal.kind === 'spin' ? 'procedural' : '—';
  }

  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    updateDebug(now);
    input.pollGamepads();
    game.update(dt);
    if (game.changed) { game.changed = false; updateInfo(); }
    renderer.draw(game);
    requestAnimationFrame(frame);
  }
  window.addEventListener('gamepadconnected', () => { if (TW.SettingsUI.open) TW.SettingsUI.renderControls(); });

  game.newDrill();
  requestAnimationFrame(frame);
})(window.TW);
