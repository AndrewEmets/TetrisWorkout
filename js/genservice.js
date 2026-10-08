// Board generation off the main thread. The worker is assembled from the core modules' source
// (TW.sources), so no files are fetched and it also works when the page is opened from file://.
// Falls back to generating on the main thread if workers are unavailable.
(function (TW) {
  'use strict';

  function workerMain() {
    self.onmessage = (e) => {
      const { id, spec } = e.data;
      let drill = null, error = null;
      const t0 = performance.now();
      try {
        drill = TW.Generator.generate(spec.scenario, spec.type, spec.setup, { hold: spec.hold });
        if (drill) drill.genMs = performance.now() - t0;
      } catch (err) {
        error = String(err && err.stack || err);
      }
      if (drill) drill = Object.assign({}, drill, { board: Array.from(drill.board.cells), opener: null });
      self.postMessage({ id, drill, error });
    };
  }

  function revive(d) {
    if (!d) return null;
    d.board = new TW.Board(Uint8Array.from(d.board));
    if (d.scenario === 'OP') d.opener = TW.Openers.OPENERS[d.type];
    return d;
  }

  const keyOf = (spec) => spec.scenario + '|' + spec.type + '|' + spec.setup + '|' + spec.hold;

  class GenService {
    constructor() {
      this.seq = 0;
      this.job = null; // { id, key, promise, resolve, spec }
      this.worker = null;
      this.background = false;
      this.start();
    }

    start() {
      try {
        const src = 'self.window = self; var TW = self.TW = {}; TW.module = function (fn) { fn(TW); };\n' +
          TW.sources.map((s) => '(' + s + ')(TW);').join('\n') + '\n(' + workerMain.toString() + ')();';
        if (!this.url) this.url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        this.worker = new Worker(this.url);
        this.worker.onmessage = (e) => this.onMessage(e.data);
        this.worker.onerror = (e) => {
          console.warn('Generator worker failed, generating on the main thread instead.', e.message || e);
          this.disableWorker();
        };
        this.background = true;
      } catch (e) {
        this.disableWorker();
      }
    }

    disableWorker() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.background = false;
      // Re-run an outstanding job on the main thread.
      const job = this.job;
      if (job) { this.job = null; this.runLocal(job); }
    }

    runLocal(job) {
      this.job = job;
      setTimeout(() => {
        if (this.job !== job) return;
        this.job = null;
        const t0 = performance.now();
        const d = TW.Generator.generate(job.spec.scenario, job.spec.type, job.spec.setup, { hold: job.spec.hold });
        if (d) d.genMs = performance.now() - t0;
        job.resolve(d);
      }, 20);
    }

    onMessage({ id, drill, error }) {
      if (!this.job || this.job.id !== id) return;
      const job = this.job;
      this.job = null;
      if (error) console.error('Generator error:', error);
      job.resolve(revive(drill));
    }

    // Resolves with a drill (or null). A request for a different drill cancels the running one.
    generate(spec) {
      const key = keyOf(spec);
      if (this.job && this.job.key === key) return this.job.promise;
      if (this.job) this.cancel();
      const job = { id: ++this.seq, key, spec };
      job.promise = new Promise((resolve) => { job.resolve = resolve; });
      if (this.worker) {
        this.job = job;
        this.worker.postMessage({ id: job.id, spec });
      } else {
        this.runLocal(job);
      }
      return job.promise;
    }

    cancel() {
      const job = this.job;
      if (!job) return;
      this.job = null;
      job.resolve(null);
      if (this.worker) {
        this.worker.terminate();
        this.start();
      }
    }
  }

  TW.GenService = GenService;
  TW.genKey = keyOf;
})(window.TW);
