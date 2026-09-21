/**
 * Shared end-of-suite guard for the tsx-run test suites. No jest, no deps.
 *
 * Why it exists: `npx -y tsx file.ts` exits 0 when a promise hangs and the
 * event loop drains — the session suite's first run "passed" after 43 of 164
 * assertions. Two guards close that hole:
 *
 *  1. A watchdog timer, deliberately left ref'd: it is what keeps a drained
 *     loop alive long enough to notice that `end()` was never reached. An
 *     `.unref()`'d timer would let the process exit 0 and defeat the purpose.
 *  2. An 'exit' listener that flips the exit code to 1 if the process leaves
 *     by any route other than `end()` (a stray `process.exit(0)`, a hang the
 *     loop somehow drains past the timer).
 *
 * Usage, keeping each suite's own print format:
 *   const suite = startSuite('geometry', 10_000);
 *   function check(name, cond) { if (suite.record(cond)) ... else ... }
 *   ...
 *   suite.end(); // prints "reached end, N assertions (...)" and exits 0/1
 */
export type Suite = {
  /** Count one assertion; returns `ok` so it can sit inline in a condition. */
  record(ok: boolean): boolean;
  /** Print the assertion count and exit 0 only if the end was reached with no failures. */
  end(): never;
  readonly passes: number;
  readonly failures: number;
};

export function startSuite(name: string, watchdogMs: number): Suite {
  const startedAt = Date.now();
  let passes = 0;
  let failures = 0;
  let ended = false;
  const ran = () => passes + failures;

  // Ref'd on purpose — see the header. Do not add `.unref()`.
  const watchdog = setTimeout(() => {
    ended = true;
    console.log(
      `\n❌ ${name}: watchdog fired after ${watchdogMs} ms — an await never settled; ` +
        `${ran()} assertions ran (${failures} failed) before the hang`,
    );
    process.exit(1);
  }, watchdogMs);

  process.on('exit', (code) => {
    if (ended) return;
    console.log(
      `\n❌ ${name}: process exited (code ${code}) before reaching the end of the suite — ` +
        `${ran()} assertions ran (${failures} failed)`,
    );
    process.exitCode = 1;
  });

  return {
    get passes() {
      return passes;
    },
    get failures() {
      return failures;
    },
    record(ok) {
      if (ok) passes++;
      else failures++;
      return ok;
    },
    end() {
      ended = true;
      clearTimeout(watchdog);
      console.log(
        `\n${failures === 0 ? '✅ ALL PASSED' : '❌ FAILED'} — ${name}: reached end, ` +
          `${ran()} assertions (${passes} passed, ${failures} failed) in ${Date.now() - startedAt} ms`,
      );
      process.exit(failures === 0 ? 0 : 1);
    },
  };
}
