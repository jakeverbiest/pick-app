# Ledger inbox — interactive sessions → scheduled reconciliation

**`docs/LAUNCH_LEDGER.md` has one writer: the daily `pick-ledger-reconciliation` scheduled
task.** Interactive sessions (Claude Code or otherwise) read the ledger freely but do not edit
it directly — that was the point of moving to a single writer: no more collisions between a live
session and the scheduled run on the same file (this repo has hit that class of bug before —
duplicate commits 72s apart, a stranded `.git/index.lock`).

If you're in an interactive session and learn something that should update the ledger — a fix
landed, a blocker cleared, a new open item — append a dated bullet here instead. The scheduled
task reads this file first, folds entries into the ledger's actual structure, and clears it on
each run.

Format: one dated bullet per item, plainly stated — the scheduled task will reconcile it into
the ledger's actual structure, not paste it verbatim.

<!-- Example:
- 2026-08-26 — PhoneLink.swift split-response fix committed as 7b19cd8, xcodebuild clean. No
  longer an open item.
-->

- 2026-09-08 — **Group impact map steps 1-3 built, deployed and verified live** (`8ece843`,
  `c5b5065`, `61e24f1`, `2755d5a`). Firestore rules released; `createChallengeToken` and
  `getChallengeToken` created; `onCleanupWrite` updated (rev 00021). Both callables confirmed live
  and correctly gated (`UNAUTHENTICATED` without sign-in).
  **End-to-end verification against production, on the Litchfield Litter Invitational:**
  ```
  challenge_stats   {cleanups:40, pickups:793, bags:11, hours:2, participants:2, roster_size:2}
  challenge_markers {suppressed:true, reason:"too_few_participants", cells:0, grid:0.0003}
  ```
  Both the roster-scoped rollup and the §11.6 suppression fired exactly as designed. All test
  artifacts removed afterwards — token, index, stats and marker docs all back to 0, probe field
  deleted from the cleanup.
  **⚠️ TESTING GOTCHA WORTH KEEPING: Firestore does not trigger on a write that changes nothing.**
  Three verification attempts reported "MISSING" and looked like a broken pipeline. The cause was
  the test, not the code: `set({field: <same value>}, {merge:true})` leaves the document
  byte-identical, Firestore does not create a new version, and **no `onDocumentWritten` trigger
  fires**. The function logs proved it — the last invocation predated all three writes. A
  "value-preserving touch" is not a way to exercise a Firestore trigger; a real field change is
  required. Two earlier attempts also failed for a *legitimate* reason worth separating from this
  one: they targeted cleanups outside the challenge's window/area, where declining to rebuild is
  correct behavior.
  **Also confirmed by this run:** `createChallengeToken`'s mint-time seed is load-bearing. Because
  the incremental path only rebuilds when a written cleanup falls in scope, a challenge whose work
  is all in the past would otherwise never get a stats doc at all. The two direct-write tests
  skipped the callable and so skipped the seed — which is exactly why they produced nothing.

- 2026-09-09 — **CARTO's self-serve key form is idempotent per domain: re-applying returns the
  SAME key, so the leaked basemap key cannot be rotated this way.** Jake requested a replacement
  key after the 2026-09-08 transcript leak, saved it to `.env`, and the value came back
  byte-identical to the key already in `.env`, `web/map.html`, `web/org.html`,
  `web/challenge.html` and the shipped bundle. `.env`'s mtime confirms the save happened; this is
  CARTO's behavior, not a failed edit. **Corrects an earlier guess in this session** that
  re-applying would issue a second, distinct key.
  **Consequences.** No web-file swap and no OTA were needed. The leaked key remains live and
  there is no self-serve way to retire it — CARTO documents no revocation, rotation or
  deactivation, so killing it would require a support request. Practically the exposure stays
  low: it is an `EXPO_PUBLIC_` key that ships inside the app bundle by design, so anyone with the
  app already has it, and the free tier is 5M tile requests/month. **Recorded so this is not
  re-attempted as though it were an open task** — "rotate the CARTO key" is closed, not pending.
