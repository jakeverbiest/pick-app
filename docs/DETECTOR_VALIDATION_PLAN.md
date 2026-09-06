# Multi-tester detector validation — plan

Written 2026-09-06. Grounded in a direct admin read of the live `cleanups` collection
(205 docs, all users) plus the detector memory files, not on recollection.

The detector is the core promise — "PICK counts your pickups as you walk." It has been
validated to 1.00x on held-out data against a frozen prediction (B5, 19 Aug). That
validation is **n=1**: one tester, one phone, one carry position. Everything downstream
(org outreach, social, sponsor dashboards) assumes the count is roughly right for people
who are not Jake. Nobody has ever tested that.

---

## 1. What data actually exists (audited, not assumed)

| user | walks | with `motion_log` | with `items_detected` | with `pace_*` | span |
|---|---|---|---|---|---|
| Jake | 172 | 138 | 38 | 23 | 2026-06-10 → 09-03 |
| "Claire" `Fhrfbd7wrm` | 28 | **21** | **0** | 0 | 2026-06-15 → **07-26** |
| "Will" `qI0d4X9BwM` | 3 | **3** | **0** | 0 | 2026-08-13 → 08-15 |
| two ghost accounts | 1 each | 0 | 0 | 0 | — |

**Zero non-Jake walks carry `items_detected` or the pace fields.** `items_detected` first
appears 2026-08-17; the pace fields 19 Aug. Claire's 28 walks — 8 hours of real,
substantial usage — all predate the instrumentation. Will's three land 13–15 Aug, also
just before it. This is not "thin" multi-tester data; it is none.

**Jake's own paired data (n=38, the only labeled set that exists):** overall
`items_detected / items_count` = **1.04**; user accepted the count unchanged on **33 of 38
walks (87%)**. Both numbers need a caveat before anyone quotes them:

- The five corrected walks are the **deliberate lab experiments**, not organic usage —
  two are the 48→20 stroll disasters (2.40x, pace 0.70/0.73, slow-share 0.90/0.94, i.e.
  C7a/B4), two are the B5-series 16→20 and 19→20, one is a 9→8.
- **Absence of correction is weak evidence of correctness.** It means "Jake didn't
  bother," which is the metric we want for UX ("a count a user would accept") but is not
  an accuracy measurement.

---

## 2. The reframe: these are two different questions

Conflating them is why this has felt stuck.

**Q1 — Generalization.** *Does the detector behave differently on other people's motion
signatures than on Jake's?* Answerable **today, retroactively, at zero build cost**, from
the 24 existing non-Jake motion logs (6,024 recorded events). No new testers, no new
instrumentation, no waiting.

**Q2 — Absolute accuracy.** *Is the count actually right for them?* **Not answerable from
any existing data.** `ground_truth` is empty on all 205 walks; no non-Jake user has ever
corrected a count; no non-Jake walk has a raw count. This requires new, deliberately
collected data — there is no clever query that recovers it.

Q1 is cheap and available now. Q2 is the one that gates launch confidence. Do Q1 first
anyway, because if Q1 shows other people's event streams look wildly unlike Jake's, that
changes how Q2 should be designed.

---

## 3. The replay corpus — real, but with a hard limit

`motion_log` is the flight recorder: per-event `{t, peak, duration, gyro, peaks,
confidence, speed, speedAgeMs, accepted, counted, reason}`. 24 non-Jake walks have one.

**What replay can answer:** any change to the *gating and filtering* stage — pause gate,
cooldown, monotony, stride rejection — because those operate on exactly the features the
log stores. You can re-run a candidate detector change against every historical walk,
including both non-Jake testers, and see how the counted total moves.

**What replay can never answer:** anything about events that were **never emitted**. The
log records candidates that already cleared event generation. A7a/C7a established that in
the stroll case *roughly 60% of real picks generate no motion event at all* — those
non-events are permanently absent and no replay recovers them. So replay cannot measure
stroll-case recall, and cannot evaluate changes to `POCKET_MIN_GYRO` or the peak
threshold.

Stated plainly: **replay is a regression harness for filter changes, not a recall
measurement.** Valuable, but don't let it masquerade as validation.

---

## 4. The instrumentation gap — and the trap to avoid

Stratifiers that matter, and whether they're recorded:

| variable | matters? | recorded today? |
|---|---|---|
| pace | **proven dominant** (A7a/C7a) | ✅ since 19 Aug |
| carry position | untested, plausibly large | ❌ **not persisted** |
| device model | plausible (sensor quality/sampling) | ❌ **not stored at all** |
| picking technique (stop vs. continuous) | proven to matter | partially, via `pace_slow_share` |

`session_mode` exists but only ever holds `background` / `unresolved` (11 docs total) —
it is not carry mode. Carry-mode auto-classification runs in-app and reads "pocket"
correctly for Jake, but **is never written to the cleanup doc**, so it cannot be used to
stratify retroactively. Device model is absent entirely (Sentry knows it; that's not
joined to walks).

**This is the A3/A5/A6 mistake waiting to happen again.** That progression — "seven
fixes, rate flat, therefore they failed" — is probably pace-confounded, because pace was
never controlled across the runs. Recruiting a group of testers *now*, with carry
position and device unrecorded, produces exactly the same unstratifiable pile one
variable over. Fix the instrumentation **before** collecting, not after.

Concretely: persist `carry_mode` and `device_model` on the cleanup doc. Both are cheap,
both are OTA-shippable, and both are worthless if added after the tester walks happen.

---

## 5. The disclosure question — answer it deliberately

The privacy policy already discloses that motion telemetry is retained: *"only a compact
summary of each detected motion event (strength, duration, accepted as a pickup or not)
is kept."* Good — the data's existence is covered.

But **"HOW WE USE IT" says: "To run the app: maps, stats, streaks, badges, team totals,
leaderboards, challenges."** That is a use-limitation. Systematically mining tester walks
to improve detection is not on that list. Before this program runs at scale, that line
needs a one-clause amendment — "and to improve pickup-detection accuracy" — across the
five legal copies Safety already manages together.

**Consistency check, worth being explicit about:** Tier 2 recap photos were just deferred
partly because a server-side process reading owner-only data was a real privacy-posture
change. Reading motion logs for detector work is the same *class* of question, and
answering it differently without noticing would be incoherent. The principled distinction
that makes this one acceptable and Tier 2 not: motion telemetry is **non-identifying
numeric data never surfaced to another user**, whereas Tier 2 would have surfaced private
photos publicly. That line holds — but it should be stated, not assumed.

---

## 6. What "accurate enough" means

The product is already designed to survive a mediocre detector. Correction is not a
fallback — the positioning line is *"you confirm the total before it saves,"* and the
memory is explicit that the correction UI **is** the product. That lowers the bar
substantially, but not to zero: a 2.40x overcount is not a shrug-and-tweak, it's a
repair, and it reads as broken.

So the metric is **correction magnitude, not correction rate.**

Proposed acceptance bar for a new tester, stated before any data is collected (frozen
prediction, per the B5 method):

1. **Median |detected/truth − 1| ≤ 0.25** across their walks.
2. **Bias non-positive** — the design target is "never systematically over." A tester
   whose median ratio exceeds ~1.1 is a fail even if the spread is tight.
3. **No walk worse than 1.5x**, in either direction. Single catastrophic walks are what
   lose users, and a median hides them.

Fail on (1) or (3) for two or more testers ⇒ the detector is gait-specific and the
fallback below is live.

**The fallback, if it is gait-specific:** lean harder into correction rather than tuning
per-user. Bias to undercount (already the stated design goal, still untested), surface
the confidence flag that already ships (`walkPaceProfile`, flags >50% of samples under
1.0 m/s), and make the correction step feel expected rather than remedial on
low-confidence walks. That is a UX change, not a signal-processing one, and it is
achievable. What must be avoided is re-entering threshold tuning against a second
individual's gait — that is how you overfit twice.

---

## 7. Sequenced plan

**Phase 0 — Instrument first (blocking; do before any recruiting).**
Persist `carry_mode` and `device_model` on the cleanup doc. Amend the privacy-policy use
clause (§5). Ships OTA, no build slot. Without this, Phase 3 collects unstratifiable data.

**Phase 1 — Replay the existing corpus (free, no dependencies, do now).**
Run the current detector's gating stage against the 24 non-Jake motion logs and Jake's
138. Compare **event-level feature distributions**, not counts: multi-peak share, event
duration, gyro magnitude, events-per-minute at matched pace. The question is narrow and
answerable: *do Claire's and Will's motion signatures sit inside the range Jake's
occupies, or outside it?* Inside ⇒ generalization risk is lower than feared, proceed to
Phase 3 with normal urgency. Outside ⇒ that is the single most important finding
available, and it arrives before anyone is recruited.

**Phase 2 — Build the detector-export Cloud Function** (already queued 17 Aug; the ledger
independently calls it the top priority). Anonymized `(detected, corrected, duration,
pace, carry_mode, device)` tuples. This is what turns every future tester walk into a
labeled data point automatically, instead of the screenshot-before-correcting protocol —
which relies on human compliance at exactly the moment the user wants to correct the
number, and which silently produces worthless data if they correct first.

**Phase 3 — Recruited multi-tester walks.**
Reuse the protocol that already worked (A7a/C7a): **alternating 30-second blocks,
walk-only / walk-and-pick-N, truth known per window, four minutes total.** Skip the voice
memo — the phase-offset sweep proved alignment doesn't matter, and pocketed-phone audio
is unusable anyway.

The four-minute duration is the important part: it is a small enough ask to make of a
stranger at a community cleanup. Target ≥5 testers, spanning at least two phone models
and at least one non-pocket carry position, each doing the block protocol once at normal
pace and once at a stroll.

---

## 8. What would change the plan

- **Phase 1 shows non-Jake event distributions are indistinguishable from Jake's** ⇒
  generalization risk was overestimated; Phase 3 becomes confirmatory rather than
  investigative, and could ship alongside launch rather than gating it.
- **Phase 1 shows they're clearly different** ⇒ stop, and treat the detector as
  unvalidated for general use until Phase 3 completes. Consider leading the org outreach
  on the correction experience rather than on automatic counting.
- **Any tester's carry position is not a pocket** ⇒ that is a genuinely untested regime,
  not a variation of a tested one. Do not generalize from it either way without its own
  runs.

---

## 8a. Result of the cheap comparison (run 2026-09-06)

Done as the scoped-down version of Phase 1 — a descriptive comparison of motion-event
features, not a replay harness. **Time-matched**: each tester is compared against Jake's
walks *in the same date window*, because Jake's 138 logged walks span June–September and
several detector versions; comparing a tester against his whole history would confound
person with detector version.

| | Claire | Jake (same window) | Will | Jake (same window) |
|---|---|---|---|---|
| window | Jun 15 – Jul 26 | | Aug 13 – 15 | |
| walks / events | 21 / 5,154 | 54 / 10,955 | 3 / 870 | 5 / 677 |
| events per min | 10.6 | 20.7 | 26.6 | 8.4 |
| median peak | 1.58 | 1.40 | 1.74 | 1.53 |
| median duration | 1396 ms | 995 ms | 2002 ms | 1194 ms |
| median gyro | 2.91 | 2.57 | **4.17** | **2.74** |
| multi-peak (≥3) | **43.2%** | **24.8%** | **52.3%** | **31.6%** |
| counted | 30.0% | 39.0% | 19.8% | 32.9% |
| median speed | 1.04 m/s | 0.86 m/s | 1.11 m/s | 0.97 m/s |

**Both testers sit outside Jake's central range, in the same direction, in two
independent windows** — more multi-peak events, longer events, a lower share surviving to
`counted`, and more of them rejected as rhythmic motion (Claire 41% vs 23%, Will 48% vs
30%). That consistency is the signal worth taking seriously; it is not noise from one odd
walk.

**But the most likely explanation is pace, not gait.** Both testers walk faster than Jake
(1.04 and 1.11 vs 0.86 and 0.97 m/s), and pace is the established dominant variable.
Claire's 43.2% multi-peak share lands almost exactly on C6a's 42% — Jake's own
normal-pace run. Read that way, the detector is not behaving strangely on Claire; it is
behaving the way it already does on Jake when he walks at her speed. That is reassuring,
and it is also a good sanity check that the metric means what we think it means.

**Will is the one that pace does not comfortably explain.** His median gyro is 52% higher
than Jake's and his p25 (3.19) sits above Jake's median, while his pace advantage is
modest. High rotation with only slightly higher speed is the signature you would expect
from a **different carry position** — a bag, a jacket pocket, a hand — rather than a
different gait. That variable is not recorded, so it cannot be confirmed. n=3 walks; treat
as a lead, not a finding.

**Two limitations, stated so this isn't over-read:**
1. **No ground truth**, so the lower `counted` rate for both testers is ambiguous by
   construction — it could be correct suppression of more walking noise, or it could be
   lost recall on real picks. Nothing here distinguishes those, and the difference is the
   whole question.
2. **Asymmetric data quality.** Jake's June–July walks include deliberate A/B/C/D-series
   lab runs; both testers' data is entirely organic usage. That is a confound running the
   opposite direction from the pace one.

**Verdict: not an alarm, not an all-clear — moderate generalization risk, and the
variance concentrates in precisely the variable that isn't instrumented.** This
independently arrives at the same conclusion §4 reached by argument: fix carry-mode and
device-model capture before the next cohort, or the same ambiguity repeats with more
people and more walks.

## 9. Known open items this does not solve

- `MIN_CLEANUP_SECONDS` is currently **60**, not the 120 an older note expected. Confirm
  the intended launch value; it affects what counts as a walk at all.
- `exportCleanup()` still does not emit the `pace_*` fields (gap flagged 19 Aug).
- Re-check the C-series (picking without stopping) on a current build — the stroll-only
  guard should be inert there, confirmed in simulation but not since the gate shipped.
