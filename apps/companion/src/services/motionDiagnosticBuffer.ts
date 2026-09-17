/** Bounded local recorder; deliberately independent of detection and native APIs. */
export type DiagnosticRow = { type: string; atMs: number; [key: string]: unknown };
export class DiagnosticBuffer {
  private rows: string[] = [];
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  private chunk = 0;
  private bytes = 0;
  private ended = false;
  private stopping: Promise<void> | null = null;
  count = 0;
  dropped = 0;
  error: string | null = null;
  lastSeen: Record<string, number> = {};
  constructor(
    readonly startedAt: number,
    private write: (name: string, text: string) => Promise<void>,
    private changed: () => void = () => {},
    // Three 10 Hz sensor streams produce about 36,000 rows in 20 minutes.
    // The earlier 12 MB byte cap ended a real iPhone 14 trace at 9:55, so it
    // contradicted the explicit 20-minute tester promise before the row or
    // duration bounds could apply. 28 MB leaves room for the real raw rows
    // while the 40,000-row limit remains the hard upper bound.
    private limits = { rows: 40000, bytes: 28_000_000, durationMs: 20 * 60 * 1000, batch: 100, pending: 8 },
  ) {}
  get active() { return !this.ended && !this.error; }
  add(type: string, data: Record<string, unknown> = {}, atMs = Date.now()) {
    if (!this.active) return;
    if (atMs - this.startedAt > this.limits.durationMs || this.count >= this.limits.rows || this.bytes >= this.limits.bytes) {
      void this.stop('capture limit reached', atMs); return;
    }
    const previous = this.lastSeen[type];
    this.lastSeen[type] = atMs;
    const row: DiagnosticRow = { ...data, type, atMs };
    if (previous !== undefined) row.deliveryGapMs = atMs - previous;
    const text = JSON.stringify(row) + '\n';
    // This counts UTF-16 conservatively; records contain mostly ASCII numbers.
    if (this.bytes + text.length * 2 > this.limits.bytes) { void this.stop('size limit reached', atMs); return; }
    this.rows.push(text); this.count++; this.bytes += text.length * 2;
    if (this.rows.length >= this.limits.batch) this.flush();
  }
  flush() {
    if (!this.rows.length) return;
    if (this.pending >= this.limits.pending) {
      this.dropped += this.rows.length; this.rows = [];
      this.changed(); return;
    }
    const text = this.rows.join(''); this.rows = [];
    const name = `chunk-${String(this.chunk++).padStart(5, '0')}.jsonl`;
    this.pending++;
    this.chain = this.chain.then(() => this.write(name, text)).catch((e) => {
      this.error = `Local write failed: ${String(e)}`;
    }).finally(() => { this.pending--; this.changed(); });
  }
  stop(reason: string, atMs = Date.now()): Promise<void> {
    if (this.stopping) return this.stopping;
    this.ended = true;
    this.stopping = (async () => {
      // Wait before terminal chunk so it cannot be dropped under backpressure.
      this.flush(); await this.chain;
      this.rows.push(JSON.stringify({ type: 'end', atMs, reason, records: this.count,
        dropped: this.dropped, error: this.error, lastSeen: this.lastSeen }) + '\n');
      this.flush(); await this.chain; this.changed();
    })();
    return this.stopping;
  }
  async drained() {
    if (this.stopping) { await this.stopping; return; }
    this.flush(); await this.chain;
  }
}
