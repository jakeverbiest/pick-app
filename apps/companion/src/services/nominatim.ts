// Shared Nominatim client: identifying User-Agent + one process-wide throttle.
// Policy: https://operations.osmfoundation.org/policies/nominatim/
// (valid identifying contact, max 1 request/second).
export const NOMINATIM_USER_AGENT = 'PICK-cleanup-app/1.0 (+https://pickglobal.org; hello@pickglobal.org)';
export const NOMINATIM_MIN_SPACING_MS = 1000;

let chain: Promise<unknown> = Promise.resolve();
let lastStart = 0;

/** Run `task` after all previously queued tasks, starting at least `spacingMs` after the previous start. */
export function throttled<T>(
  task: () => Promise<T>,
  spacingMs: number = NOMINATIM_MIN_SPACING_MS,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastStart + spacingMs - now();
    if (wait > 0) await sleep(wait);
    lastStart = now();
    return task();
  });
  chain = run.catch(() => {});
  return run;
}

/** Test hook: reset spacing state. */
export function _resetThrottleForTests(): void {
  chain = Promise.resolve();
  lastStart = 0;
}

/** fetch() to Nominatim with the compliant User-Agent, throttled to 1 req/sec app-wide. */
export function nominatimFetch(url: string): Promise<Response> {
  return throttled(() =>
    fetch(url, { headers: { 'User-Agent': NOMINATIM_USER_AGENT, Accept: 'application/json' } }),
  );
}
