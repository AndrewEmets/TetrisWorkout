// Favorite boards: stored in localStorage, listed in a modal with mini previews.
(function (TW) {
  'use strict';

  const STORAGE_KEY = 'tetris-workout-favorites';

  const signature = (d) => [d.scenario, d.type, d.setup, d.queue.join(''), d.board.toLetterRows().join('/')].join('|');

  function serialize(d) {
    return {
      v: 1,
      sig: signature(d),
      savedAt: Date.now(),
      scenario: d.scenario, type: d.type, setup: d.setup,
      goal: d.goal,
      queue: d.queue.slice(),
      rows: d.board.toLetterRows(),
      solution: d.solution,
    };
  }

  function deserialize(f) {
    return {
      board: TW.Board.fromRows(f.rows),
      queue: f.queue.slice(),
      solution: f.solution,
      goal: f.goal,
      scenario: f.scenario, type: f.type, setup: f.setup,
      opener: f.scenario === 'OP' ? TW.Openers.OPENERS[f.type] : null,
    };
  }

  const Favorites = {
    list: [],
    listeners: [],

    load() {
      try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
        this.list = Array.isArray(raw) ? raw.filter((f) => f && f.rows && f.queue && f.goal) : [];
      } catch (e) {
        this.list = [];
      }
    },
    save() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.list)); } catch (e) { /* storage unavailable */ }
      this.listeners.forEach((fn) => fn());
    },
    onChange(fn) { this.listeners.push(fn); },
    has(d) { return !!d && this.list.some((f) => f.sig === signature(d)); },
    toggle(d) {
      if (!d) return;
      const sig = signature(d);
      if (this.list.some((f) => f.sig === sig)) this.list = this.list.filter((f) => f.sig !== sig);
      else this.list.unshift(serialize(d));
      this.save();
    },
    remove(sig) {
      this.list = this.list.filter((f) => f.sig !== sig);
      this.save();
    },
    deserialize,
  };

  // ---------- Modal ----------

  // Mini board preview. Opener favorites start empty, so they show the opener's first shape dimmed.
  function drawThumb(canvas, f) {
    const opener = f.scenario === 'OP' && TW.Openers.OPENERS[f.type];
    const rows = (opener ? opener.phases[0].rows : f.rows).slice(-10);
    const c = 9, n = 10;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 10 * c * dpr;
    canvas.height = n * c * dpr;
    canvas.style.width = 10 * c + 'px';
    canvas.style.height = n * c + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(0, 0, 10 * c, n * c);
    ctx.globalAlpha = opener ? 0.45 : 1;
    const top = n - rows.length;
    rows.forEach((row, i) => {
      for (let x = 0; x < 10; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        ctx.fillStyle = TW.Pieces.COLORS[ch === '#' || ch === 'X' ? 8 : ch] || TW.Pieces.COLORS[8];
        ctx.fillRect(x * c, (top + i) * c, c - 1, c - 1);
      }
    });
    ctx.globalAlpha = 1;
  }

  const FavoritesUI = {
    open: false,

    init(input, onPlay) {
      this.input = input;
      this.onPlay = onPlay;
      this.modal = document.getElementById('fav-modal');
      document.getElementById('fav-close').addEventListener('click', () => this.hide());
      this.modal.addEventListener('mousedown', (e) => { if (e.target === this.modal) this.hide(); });
      document.addEventListener('keydown', (e) => { if (this.open && e.code === 'Escape') this.hide(); });
      Favorites.onChange(() => { if (this.open) this.render(); });
    },

    show() {
      this.open = true;
      this.input.releaseAll();
      this.input.enabled = false;
      this.modal.classList.remove('hidden');
      this.render();
    },

    hide() {
      this.open = false;
      this.input.enabled = true;
      this.modal.classList.add('hidden');
    },

    render() {
      const root = document.getElementById('fav-list');
      root.innerHTML = '';
      if (!Favorites.list.length) {
        root.innerHTML = '<p class="muted">No favorites yet. Press ☆ (or F) while playing a board to save it here.</p>';
        return;
      }
      for (const f of Favorites.list) {
        const card = document.createElement('div');
        card.className = 'fav-card';
        card.title = 'Play this board';
        const canvas = document.createElement('canvas');
        drawThumb(canvas, f);
        const info = document.createElement('div');
        info.className = 'fav-info';
        const title = document.createElement('div');
        title.className = 'fav-title';
        title.textContent = f.goal.text + (f.setup ? ' · ' + f.setup + ' setup' : '');
        const sub = document.createElement('div');
        sub.className = 'muted';
        sub.textContent = 'Queue ' + f.queue.join('') + ' · saved ' + new Date(f.savedAt).toLocaleDateString();
        info.append(title, sub);
        const del = document.createElement('button');
        del.className = 'small';
        del.textContent = '✕';
        del.title = 'Remove from favorites';
        del.addEventListener('click', (e) => { e.stopPropagation(); Favorites.remove(f.sig); });
        card.append(canvas, info, del);
        card.addEventListener('click', () => { this.hide(); this.onPlay(deserialize(f)); });
        root.appendChild(card);
      }
    },
  };

  TW.Favorites = Favorites;
  TW.FavoritesUI = FavoritesUI;
})(window.TW);
