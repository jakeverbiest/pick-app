# Walk Feedback — 2026-07-21

Real-world test by Jake, on the build **before** the Jul 21 accuracy changes. Triage + status below. (Jake will start real cleanups from *outside*, not inside the apartment — so the "before start" false-pickup count is partly a test artifact.)

| # | Feedback | Status | Notes |
|---|----------|--------|-------|
| 1 | Walk one side of the street → should mark FRESH. **Mixed bag**: one street credited accurately, another had **no color change** after picking. Normal (single-line) street, not the per-side split. | ✅ Fixed (tuning) | Streets are 50m half-block pieces; the 80% coverage rule was too strict for real GPS — start/end pieces of a walk + any dropped fix fell just under. **Lowered `COVERAGE_THRESHOLD` 0.8 → 0.6.** Watch next walk for over-crediting (a barely-touched street turning green). |
| 2 | Watch + app need a better lock-screen image / a setting so the session shows on the lock screen + watch during an active session. Wants a **live "cleanup in progress" card**. | ⏳ Native build | iOS **Live Activity** (ActivityKit + Dynamic Island) + watch active-session state: needs a Widget Extension target (Swift) + a JS↔native bridge + walk-lifecycle wiring. Being scaffolded; requires an Xcode target + a native build to ship. |
| 4 | On tests started *inside* the apartment: ~**20–25 false pickups before start** (handling the phone / moving around before walking out). | ✅ Fixed | Added a **walking-onset gate**: pickups don't count until real walking is confirmed (a walking-rhythm window OR GPS walking pace 0.7–3.3 m/s). Resets each session; arms within the first strides, so starting outside is unaffected. Pre-walk events logged as `pre-walk (not walking yet)`. |
| 7 | Battery not draining tremendously during active session. | ✅ Good | No action — GPS + motion continuous-run cost is acceptable. |

**Also shipped Jul 21 (from the earlier ask, related to accuracy):**
- Color scale redone — worst state is now a **strong, visible red** (`#D2321C`) that dims but stays legible instead of dissolving.
- **Speed gate** — pickups rejected when GPS speed > 3.3 m/s (biking/vehicle).
- On-screen **"moving too fast — pickups paused"** hint during a walk.

**Still awaited from Jake's list:** items 3, 5, 6.

**How each ships:** #1, #4, color scale, speed gate, too-fast hint are all JS → over-the-air via `eas update`. #2 (Live Activity) is native → needs a widget-extension target + a fresh build.
