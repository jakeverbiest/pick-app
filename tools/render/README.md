# Impact video renderer

Turns a real cleanup into a social-ready MP4, rendered from the walk's own
stored track. Built 2026-09-08.

```bash
# once, to build the encoder
swiftc -O tools/pngs-to-mp4.swift -o tools/pngs-to-mp4

# then, per walk
node tools/render/render-video.mjs --walk <cleanupId> --seconds 20 --format 4:5
```

| flag | default | notes |
|---|---|---|
| `--walk` | *required* | `cleanups` document id |
| `--seconds` | 20 | output duration |
| `--fps` | 30 | |
| `--format` | `4:5` | `4:5` (1080×1350), `9:16` (1080×1920), `1:1` (1080×1080) |
| `--out` | `./pick-<id>.mp4` | |
| `--keep-frames` | off | leave the PNG sequence for inspection |

Roughly 30 seconds to render a 20-second clip. Needs
`~/.secrets/pick-app/serviceAccountKey.json`, Google Chrome, and network access
to Overpass.

---

## Read this before sending one to an organization

**The pickup count in the video is the detector's count, and the detector
undercounts.** Measured 2026-09-08 against per-pick watch ground truth on
cleanup `LIEYG6ezcsDcQpxIIOF2`: **35 real picks, 15 detected — recall 0.43×**,
with zero false positives. It has never invented a pickup; it misses roughly
half of them when someone picks without breaking stride, which is exactly how
people work at an event.

`items_count` does not rescue this. On that same walk `items_count` equalled
`items_detected` because the number was not corrected at save, so the
"confirmed" total is the detector's output unless a human actually edited it.

So, until recall improves:

- **Do not send an org a video that presents the pickup number as their total
  work.** They carried the bags; they know it was more. Getting this wrong
  costs more trust than the video buys.
- The **map** is the honest hero — streets covered, route walked, area worked.
  That part is straightforwardly true and is what makes the artifact
  compelling anyway.
- If a number is used at all, it needs a human-corrected count behind it, or
  framing that makes clear it is a floor rather than a total.

Route the framing past Jake before anything goes to an organization. This is a
gate, not a style preference.

## What the renderer will not claim

Two things are deliberately absent, and both should stay absent:

- **No distance figure.** The saved track is thinned — median stored step 86 m
  on the reference walk, with six gaps over 400 m (longest 1,992 m). Summing
  it gives 11.07 km at 2.80 m/s, running speed for a walking cleanup. The
  track cannot support a distance, so none is shown.
- **The route is broken at those gaps, never bridged.** A straight line across
  six blocks the walker did not walk is an invented claim.

Framing uses the 4th–96th percentile of latitude and longitude rather than the
full extent. Fitting to extent is the failure documented in
`GROUP_IMPACT_MAP_SPEC.md` (strays push the bounding box out and waste the
frame); it reproduced exactly here before being fixed.

## Why not a screen recording

Capturing the live map means holding the phone with the screen awake for the
whole walk. That flips `carry_mode` from `pocket` to `hand` — the mode with no
detector tuning behind it — and films someone using the app wrong. Rendering
from the stored track is deterministic, re-renderable at any speed or aspect
ratio, and is the actual recorded data.

## Multi-crew

Same renderer with N tracks over one shared street layer, one clock across all
of them — the motion form of `GROUP_IMPACT_MAP_SPEC`. Not built yet. The
limiting factor is track density rather than the renderer: at 86 m median
sampling any single route looks coarse, so denser track storage during events
is the prerequisite, and that is a client-side change.

## How it works

No npm dependencies, on purpose — this machine has no ffmpeg, no ImageMagick
and no node-canvas, but Chrome and `swiftc` are already installed for other
reasons, and this should still run in six months without a reinstall.

1. `render-video.mjs` reads the walk from Firestore and fetches street geometry
   for its bounding box from Overpass.
2. `frame-template.html` draws one frame. It has **no animation loop** — the
   driver calls `window.PICK.frame(t)` for an exact `t` and screenshots it, so
   two renders of the same walk are identical frame for frame.
3. Frames are captured over the Chrome DevTools Protocol (Node 24's global
   `WebSocket`; no puppeteer).
4. `pngs-to-mp4` encodes them with AVFoundation.
