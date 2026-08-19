# Group Walk — four pickers, 18 Aug 2026

Prep + test plan for the first multi-user concurrent session.
Written 17 Aug 2026 against commit `59e3c96`.

---

## 1. The build question, answered

**Short answer: probably not, and there are three separate gaps. Publish an OTA
tonight; do NOT cut a new build.**

Two delivery channels, and they carry different things:

| Channel | Reaches | Latency | Carries |
|---|---|---|---|
| `eas update --branch production` | any install on runtime **1.2.2** (builds 27–31) | seconds | all JS/TS |
| New EAS build → TestFlight | only after Apple beta review | ~1–3 days | native, `app.json`, Swift |

### Gap 1 — the newest work may not be published at all

Four commits landed **17 Aug at 21:02** and nothing on disk records whether an
OTA followed them:

- `d0e95f3` Bag reports — named sizes, a quantity, and a persisted fullness
- `34a8eb3` **One panel for correcting a walk, shared by both screens**
- `4c64a0f` Splash: transparent mark
- `59e3c96` publish-detector.sh: stop under-reporting what will ship

That last commit exists *because* the script under-reported a splash change, which
suggests a publish happened around then — but that's an inference, not a fact.

**Verify:**

```bash
cd ~/Desktop/pick-app/apps/companion
npx eas update:list --branch production --limit 5
```

**Better, functional check on the phone** (build stamps are UUIDv7 and share long
prefixes — easy to misread): open a saved walk and look for the **"Adjust details"**
correction panel with an editable piece count and bag size / quantity / fullness.
If it's there, the 21:02 batch is live. If it isn't, publish.

### Gap 2 — the splash fix can't ship OTA at all

`4c64a0f` edits `app.json`. Splash config is baked into the binary, so it needs a
new EAS build. It is the *only* native item in the recent batch, and it's cosmetic.
Not worth a build before tomorrow.

### Gap 3 — is build 31 actually in testers' hands?

Build 31 was submitted **13 Aug**. Builds 28, 29, 30 and 31 all went in within about
36 hours of each other, and external TestFlight groups require Apple beta review.

**Check App Store Connect → TestFlight → external group:** is 31 *Approved*, and is
it the build the group is actually on? A tester sitting on 27 or 28 still receives
your OTA fine (same 1.2.2 runtime), but is missing the native watch staleness guard
that shipped in 28.

### Why not just cut a build

A build submitted tonight will not clear review before the walk. The only pending
native item is a splash cosmetic. And the thing that actually determines whether
tomorrow produces usable data — the correction panel — ships fine over OTA.

---

## 2. Why the correction panel is the whole game tomorrow

A four-person social walk **is a slow walk**, and slow walking is the one case the
detector has never solved. From your own field data:

- A6 (slow walk, zero real pickups): **12 counted**, ~7.1 false positives/min
- C5 (slow stroll, 15 real picks): **41 counted**

Four people × ~45 minutes of strolling and talking = four wildly inflated numbers,
seen for the first time by people who aren't you. Without the correction panel,
that inflated number *is* their impression of the app.

With it, the same walk becomes the most valuable dataset the project has: four
independent human ground-truth counts against sensor counts on the same route at
the same pace, with the raw count stored alongside the corrected one. That's the
labeled training data you concluded was the only way forward.

**So: getting `34a8eb3` onto four phones is the single highest-value action before
tomorrow.**

---

## 3. Tonight (~30–45 min)

1. **Check, then publish.** Run `update:list` above. If the 21:02 batch is missing:

   ```bash
   ~/Desktop/pick-app/publish-detector.sh "correction panel + bag reports"
   ```

   It will warn about uncommitted `apps/companion/targets/watch/PhoneLink.swift`.
   That's Swift — it is inert over OTA and only matters at the next native build,
   so it's safe to proceed. The untracked `docs/` and `design-audit/` files are
   likewise harmless in a bundle.

2. **Verify on your own phone.** Force-quit PICK, reopen, wait ~10s, force-quit,
   reopen. Then confirm the correction panel functionally — don't just eyeball the
   stamp.

3. **Get the other three installed tonight, not in the parking lot.** Challenge
   Guest Mode is a *draft spec, not implemented* — there is no QR / no-download
   path. All four need the app installed, an account created, and a successful
   sign-in. Signup is now Display Name + Email + one password (no neighborhood).

4. **Decide: run it as a Challenge, or four independent walks?**
   If a Challenge, create it tonight (area + today's date + a collective pickup
   goal) and have all four join before anyone starts walking.
   Rules for `challenges/{id}/contrib` and `/live` are present in the canonical
   `apps/companion/firestore.rules` and went out with the 5 Aug blocking release —
   **no deploy is required.** If you want belt-and-braces, it's idempotent:

   ```bash
   cd ~/Desktop/pick-app && firebase deploy --only firestore:rules
   ```

5. **Leave `MIN_CLEANUP_SECONDS` at 20.** Short walks still save, and any walk with
   ≥1 pickup always saved regardless. (Restore to 120 before launch — not tonight.)

---

## 4. Morning of — parking-lot checklist (10 min, all four phones)

- [ ] App installed, signed in, **same build number** — have each person read the
      build stamp in Settings out loud. One mismatched phone silently invalidates
      the four-way comparison.
- [ ] Location permission = **Always** (not "While Using"). Motion & Fitness ON.
- [ ] **Phone in a front pocket for everyone.** That's the only carry mode the
      detector is tuned for; mixing carry positions makes the four numbers
      incomparable.
- [ ] Battery >50%, **Low Power Mode OFF** — it throttles background location.
- [ ] **Agree on ground truth before starting.** Each person tallies their real
      picks (notes app, clicker, or a buddy counting). Without this the walk
      produces zero usable data — it's the single thing that can't be recovered
      afterwards.
- [ ] Note per person: phone model, iOS version, watch paired y/n.

---

## 5. During the walk — what's genuinely new here

Everything below only appears with more than one person, so this is the first real
test of any of it:

- **Concurrent segment stamping.** Four people on the same block all write
  `segment_status`. Rules are last-write-wins with a ±60s/24h plausibility window —
  no conflict expected, but confirm nobody's street coloring disappears.
- **Live "who's cleaning now."** Each person should see the other three in the
  Community banner (`live_walks`, 45s heartbeat, neighborhood name only, no coords).
- **Challenge contrib totals.** Numbers sum from each participant's own doc and are
  **eventually consistent by design** — they refresh on save or app open, not
  second-by-second. Don't chase that as a bug.
- **Watch team bar** (`challenges/{id}/live`) if anyone has a watch paired.
- **Known open bug to catch in the act:** watch pickup count dropping to 0 mid-walk
  and jumping back. Fixed in build 27, never field-verified. Try to force a Map
  remount — background the app, switch tabs, lock the phone for a stretch.
- **Free bonus test:** the long-walk crash / map-memory fix has never been confirmed
  on a real multi-hour session. If the walk runs long, that's a test you get free.

---

## 6. After the walk

- [ ] Everyone saves their walk and **uses the correction panel** — the raw sensor
      count is preserved alongside the corrected one. That pairing is the dataset.
- [ ] Collect per person: sensor count, manual count, bags, duration, phone model,
      carry position.
- [ ] Compare the four against each other. Same route, same pace, four devices is
      the first time you can separate *"the detector is noisy"* from *"this phone /
      this gait is noisy."*
- [ ] Ask each tester one open question: what did the number make you feel? That's
      the thing the overcounting analysis can't tell you.
- [ ] Log results in `docs/LAUNCH_BUGLIST.md`; add a dated entry to
      `~/pick-app/docs/PROJECT_TIMELINE.md`.

---

## 7. Decisions still sitting on you

- **`PhoneLink.swift` is uncommitted** — it removes the watch's stale-snapshot guard
  (the 28 Jul fix). Commit or revert it before the next native build; it can't ship
  or break anything OTA in the meantime.
- **Bias the detector to undercount?** Scoped but untested. Now that correction
  exists, being shown a low number and adjusting up reads better than being shown 3×
  and adjusting down. Tomorrow's four-way data is what should decide it.
- **When to cut build 32.** Natural trigger: splash fix + whatever tomorrow surfaces
  + the PhoneLink decision, batched together.
