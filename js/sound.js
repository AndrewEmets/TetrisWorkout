// Retro sound effects, synthesized with Web Audio: square / triangle waves and filtered noise, no sound files.
// Plays the game's events (game.listen). Events from one game step are played together, so a line clear can use
// the combo and back-to-back that Marathon scoring adds right after it.
(function (TW) {
  'use strict';

  const hz = (note) => 440 * Math.pow(2, (note - 69) / 12); // MIDI note number -> frequency
  const C5 = 72;
  const MAJOR = [0, 4, 7, 12, 16, 19, 24]; // arpeggio steps (semitones)

  class Sound {
    constructor(settings) {
      this.settings = settings;
      this.ctx = null;
      this.pending = [];
      this.lastMove = 0;
      // Browsers only start audio from a user gesture.
      const unlock = () => this.unlock();
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    }

    get volume() { return this.settings.data.audio.volume / 100; }

    unlock() {
      if (this.volume <= 0) return;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    // One note: freq (Hz), start (s from now), dur (s); opts: type, vol, slide (end frequency).
    tone(freq, start, dur, opts = {}) {
      const ctx = this.ctx, t = ctx.currentTime + start;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = opts.type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(opts.vol || 0.1, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }

    // A burst of low-passed noise (drops, crashes).
    noise(start, dur, vol, cutoff) {
      const ctx = this.ctx, t = ctx.currentTime + start;
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = this.noiseBuf;
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff / 6), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.02);
    }

    // Notes (MIDI numbers) one after another.
    seq(notes, step, opts = {}) {
      notes.forEach((n, i) => this.tone(hz(n), i * step, opts.dur || step * 1.6, opts));
    }

    // game.listen callback.
    event(e) {
      if (!this.ctx || this.ctx.state !== 'running' || this.volume <= 0) return;
      this.pending.push(e);
      if (this.pending.length === 1) queueMicrotask(() => this.flush());
    }

    flush() {
      const events = this.pending;
      this.pending = [];
      this.master.gain.setValueAtTime(this.volume * 0.6, this.ctx.currentTime);
      const score = events.find((e) => e.kind === 'score');
      const moves = this.settings.data.audio.moves;
      for (const e of events) {
        switch (e.kind) {
          case 'move': {
            const now = performance.now();
            if (moves && now - this.lastMove > 30) this.tone(1320, 0, 0.022, { vol: 0.05 });
            this.lastMove = now;
            break;
          }
          case 'rotate':
            if (moves) this.tone(620, 0, 0.045, { vol: 0.06, slide: 930 });
            if (e.spin !== 'none') this.seq([96, 103], 0.035, { type: 'triangle', vol: 0.12 });
            break;
          case 'hold': this.seq([67, 74], 0.04, { type: 'triangle', vol: 0.12 }); break;
          case 'land': this.tone(200, 0, 0.04, { type: 'triangle', vol: 0.12 }); break;
          case 'bump': this.tone(95, 0, 0.06, { type: 'triangle', vol: 0.18 }); break;
          case 'drop':
            if (e.hard) { this.noise(0, 0.1, 0.35, 1400); this.tone(170, 0, 0.11, { vol: 0.1, slide: 45 }); }
            else { this.noise(0, 0.06, 0.15, 2500); this.tone(500, 0, 0.07, { type: 'triangle', vol: 0.1, slide: 160 }); }
            break;
          case 'lock': if (!e.hard) this.tone(240, 0, 0.05, { vol: 0.07, slide: 120 }); break;
          case 'clear': this.clear(e, score); break;
          case 'result':
            if (e.ok) this.seq(e.over ? [72, 76, 79, 84, 79, 84, 88] : [76, 79, 84, 88], 0.07, { vol: 0.1 });
            else if (e.over) this.seq([72, 67, 64, 60, 55, 48], 0.12, { type: 'triangle', vol: 0.18, dur: 0.2 });
            else { this.tone(330, 0, 0.3, { vol: 0.09, slide: 110 }); this.tone(220, 0.12, 0.35, { vol: 0.08, slide: 70 }); }
            break;
        }
      }
      if (score && score.levelUp) this.seq([84, 88, 91, 96], 0.06, { type: 'triangle', vol: 0.14, dur: 0.12 });
    }

    // Line clears go up an arpeggio (one note per line); combos raise the pitch, spins add a sparkle,
    // back-to-back a bass note, a perfect clear plays a fanfare.
    clear(e, score) {
      const combo = score ? Math.max(0, score.combo) : 0;
      const base = C5 + Math.min(combo, 12);
      if (e.pc) {
        this.seq([72, 76, 79, 84, 79, 84, 88, 91, 96], 0.065, { vol: 0.11 });
        this.noise(0, 0.5, 0.15, 6000);
        return;
      }
      if (e.lines) {
        const steps = MAJOR.slice(0, e.lines >= 4 ? 6 : e.lines + 1);
        this.seq(steps.map((s) => base + s), e.lines >= 4 ? 0.04 : 0.05, { vol: 0.1 });
        if (e.lines >= 4) this.noise(0, 0.25, 0.18, 5000);
      }
      if (e.spin !== 'none') this.seq([96, 100, 103, 108].slice(0, e.lines ? 4 : 2), 0.04, { type: 'triangle', vol: 0.12 });
      if (score && score.b2b) this.tone(hz(base - 24), 0, 0.25, { type: 'triangle', vol: 0.2 });
    }
  }

  TW.Sound = Sound;
})(window.TW);
