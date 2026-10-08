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
    if (a === 'favorite') { if (game.drill) TW.Favorites.toggle(game.drill); }
    else gamePress(a);
  };
  TW.Favorites.onChange(() => { game.changed = true; });

  // ---------- Drill selectors ----------

  const { SCENARIOS, MAX_SETUP } = TW.Generator;
  const selScenario = document.getElementById('sel-scenario');
  const selType = document.getElementById('sel-type');
  const selSetup = document.getElementById('sel-setup');

  for (const [key, sc] of Object.entries(SCENARIOS)) selScenario.add(new Option(sc.label, key));

  function fillDrillSelectors() {
    const d = settings.data.drill;
    if (!SCENARIOS[d.scenario]) d.scenario = 'T';
    const sc = SCENARIOS[d.scenario];
    if (!sc.types.some((t) => t[0] === d.type)) d.type = sc.types[0][0];
    const max = d.scenario === 'PC' ? MAX_SETUP.pc : d.scenario === 'OP' ? 0 : MAX_SETUP.spin;
    d.setup = Math.min(Math.max(0, d.setup | 0), max);

    selScenario.value = d.scenario;
    selType.innerHTML = '';
    for (const [k, label] of sc.types) selType.add(new Option(label, k));
    selType.value = d.type;
    selSetup.innerHTML = '';
    for (let i = 0; i <= max; i++) {
      selSetup.add(new Option(d.scenario === 'PC' ? String(i + 2) : String(i), String(i)));
    }
    selSetup.value = String(d.setup);
    document.getElementById('setup-label').textContent = d.scenario === 'PC' ? 'Pieces' : 'Setup pieces';
    document.getElementById('setup-wrap').classList.toggle('hidden', d.scenario === 'OP');
    renderGuide();
  }

  function renderGuide() {
    const d = settings.data.drill;
    let html = TW.Guides.forDrill(d.scenario, d.type);
    const op = d.scenario === 'OP' && TW.Openers.OPENERS[d.type];
    if (op) html += '<p class="muted">Shapes from <a href="' + op.source + '" target="_blank" rel="noopener">four.lol</a>.</p>';
    document.getElementById('guide-text').innerHTML = html;
  }

  function onDrillChange() {
    settings.data.drill = { scenario: selScenario.value, type: selType.value, setup: +selSetup.value };
    fillDrillSelectors();
    settings.save(); // the onChange listener below starts a new drill
  }
  selScenario.addEventListener('change', () => { selType.value = ''; onDrillChange(); selScenario.blur(); });
  selType.addEventListener('change', () => { onDrillChange(); selType.blur(); });
  selSetup.addEventListener('change', () => { onDrillChange(); selSetup.blur(); });
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
  blurAfter('btn-reset-stats', () => { if (confirm('Reset all stats?')) game.resetStats(); });

  // ---------- Info panel ----------

  const $ = (id) => document.getElementById(id);
  const pct = (s, a) => (a ? s + ' / ' + a + ' (' + Math.round((100 * s) / a) + '%)' : '—');

  function keysHelp() {
    const kb = settings.data.controls.keyboard;
    const name = (a) => (kb[a][0] ? kb[a][0].replace(/^Key|^Digit/, '').replace('Arrow', '') : '—');
    return [
      'Move: ' + name('left') + ' / ' + name('right') + '   Soft: ' + name('softDrop'),
      'Hard drop: ' + name('hardDrop') + '   Hold: ' + name('hold'),
      'Rotate: ' + name('rotCCW') + ' / ' + name('rotCW') + ' / 180: ' + name('rot180'),
      'Retry: ' + name('retry') + '   Prev / Next: ' + name('prev') + ' / ' + name('skip') + '   Hint: ' + name('hint'),
      'Favorite: ' + name('favorite'),
    ].join('\n');
  }

  function updateInfo() {
    const d = game.drill;
    const st = game.stats;
    $('goal-text').textContent = d ? d.goal.text : '—';
    let detail = '';
    if (d) {
      if (d.opener) {
        const k = Math.min(game.op ? game.op.k : 0, d.opener.phases.length - 1);
        detail = 'Step ' + (k + 1) + ' of ' + d.opener.phases.length + ': ' + d.opener.phases[k].label + '.';
      } else if (d.goal.kind === 'pc') detail = 'Clear the whole board using ' + d.queue.length + ' pieces. Stay under the dashed line.';
      else if (d.setup) detail = 'Place ' + d.setup + ' setup piece' + (d.setup > 1 ? 's' : '') + ' first, then spin the ' + d.goal.piece + '.';
      else detail = 'Spin the ' + d.goal.piece + ' into the slot.';
    }
    $('goal-detail').textContent = detail;
    const per = d && st.per[game.drillKey(d)];
    $('st-drill').textContent = per ? pct(per.s, per.a) : '—';
    $('st-total').textContent = pct(st.successes, st.attempts);
    $('st-streak').textContent = st.streak;
    $('st-best').textContent = st.best;
    $('keys-help').textContent = keysHelp();
    $('btn-hint').classList.toggle('active', game.hintVisible);
    $('btn-prev').disabled = !game.hasPrev();
    const fav = TW.Favorites.has(d);
    $('btn-fav').textContent = fav ? '★' : '☆';
    $('btn-fav').classList.toggle('on', fav);
    $('btn-fav').title = fav ? 'Remove this board from favorites (F)' : 'Add this board to favorites (F)';
    $('btn-favs').textContent = 'Favorites' + (TW.Favorites.list.length ? ' (' + TW.Favorites.list.length + ')' : '');
    const df = game.demoFrame();
    $('demo-controls').classList.toggle('hidden', !df);
    $('btn-demo').classList.toggle('hidden', !!df);
    if (df) {
      $('demo-caption').textContent = df.caption;
      $('demo-pos').textContent = (game.demo.i + 1) + ' / ' + game.demo.frames.length;
      $('demo-play').textContent = game.demo.playing ? '❚❚' : '▶';
    }
  }

  // ---------- Loop ----------

  function resize() { renderer.resize(); }
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  // ---------- Debug panel ----------

  const debugPanel = $('debug-panel');
  try { debugPanel.open = localStorage.getItem('tetris-workout-debug-open') === '1'; } catch (e) { /* ignore */ }
  debugPanel.addEventListener('toggle', () => {
    try { localStorage.setItem('tetris-workout-debug-open', debugPanel.open ? '1' : '0'); } catch (e) { /* ignore */ }
  });
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
