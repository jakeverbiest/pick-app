# Website — three options, and the asset list

Written 23 Aug 2026. `web/` is canonical (`pickglobal-site 4` is byte-identical;
`pickglobal-site`, ` 2`, ` 3` are older drift — delete all four).

## Where the text actually is

| Page | Words |
|---|---|
| **index.html** | **1,168** |
| privacy.html | 681 |
| about.html | 608 |
| support.html | 541 |
| terms.html | 520 |
| download.html | 408 |
| map / city / 404 | ~370 combined |

The home page is the problem. It's 1,168 words — roughly five minutes of
reading — to explain an app whose entire pitch is "put it in your pocket and
walk." Everything else is about the right length for what it is; privacy and
terms *should* be wordy.

---

## Option A — Trim

**index → ~700 words.** Same structure, same sections, 40% fewer words. Cut the
repetition between "How it works" and "While you walk", keep one honesty
paragraph instead of three.

- **Cost:** an afternoon of editing. No new assets.
- **Risk:** none.
- **Ceiling:** still a page you read rather than look at.

## Option B — One screen

**index → ~250 words.** Home becomes: headline, one line of what it is, three
short steps beside a phone screenshot, live totals, CTA. Everything currently
below that moves to `about` (already written and good) or a new
`how-it-works` page for people who want the detail.

- **Cost:** a restructure, plus one or two better screenshots.
- **Risk:** low. The detail isn't deleted, it's one click away.
- **This is what I'd pick.** It matches the product — the pitch is that the app
  disappears into a walk, and the page should behave the same way.

## Option C — Show, don't tell

**index → ~150 words.** A silent looping screen recording is the hero: cleanup
starts, phone pockets, streets paint green, summary appears with a count. Three
short captions underneath. CTA. That's the page.

- **Cost:** you have to shoot the video, and it has to be good.
- **Risk:** a mediocre loop is worse than good text.
- **Ceiling:** highest. This is the only version where someone *understands* the
  product in eight seconds instead of reading about it.

**A and C aren't exclusive** — B is the structure, C is what you drop into B's
hero once the video exists. Suggest: do B now, shoot the video this week, upgrade
the hero to C when it's ready.

---

## Assets — what's worth making, in order

### 1. The walk loop — 10–15s, silent, autoplay, no sound
The single highest-value asset on this list, and the only one that can carry
Option C. Screen recording, portrait:

- tap **Start cleanup**
- phone goes in pocket (cut)
- map with streets painting green behind the live bar
- end-of-walk summary with the count
- the count being corrected

Ends on the correction, because the honesty is the differentiator. Under 3MB,
looping, no audio, `playsinline`.

### 2. One real photograph
You, a bag, a Brooklyn street, and the three-and-a-half-year-old who insists on
carrying it. The most distinctive thing about this project is currently a
sentence on `about.html` with no picture. One good photo does more for trust
than any screenshot.

### 3. Before / after of a neighbourhood filling in
Two exports of the same area, some weeks apart — mostly grey, then mostly
green. It's the whole product thesis in two images, and nothing on the site
currently shows the map changing over time.

### 4. Watch on a wrist
Mid-walk, count visible. The Apple Watch companion is a real differentiator and
appears nowhere in the shot list.

---

## Screenshots — what I need from you

Existing six (`assets/shots/`) are all 540×1168, dated 17 Aug: `walk`,
`map-neighborhood`, `map-city`, `impact`, `challenge`, `leaderboard`.

**Two questions before reshooting anything:**

1. **Are they current?** They predate the 19 Aug detector work and the pace bar.
2. **Do they show the old branding?** The in-app Pick Global rebrand is logged
   as incomplete. If any screenshot shows the old name, it has to be reshot or
   it undercuts the whole site.

**Missing, and worth capturing:**

| Shot | Why |
|---|---|
| **End-of-walk summary with the correction control visible** | The honesty story is the site's strongest argument and there is no picture of it. Highest priority. |
| **Watch face mid-walk** | See above. Nothing exists. |
| **Neighbourhood at high completion** (mostly green) | Every current map shot is early-state. Nobody can see what winning looks like. |

**Capture spec:** iPhone with a modern aspect ratio, portrait, light mode,
status bar clean (full battery, no notifications), real data not empty states,
no personal route near your home address on any map shot. Export at 2x and let
me downscale — 540px wide is too small for a hero on a retina display.

---

## Also, while in there

- Delete `pickglobal-site`, ` 2`, ` 3`, ` 4` and `pickglobal-site.zip`. Five
  copies, four redundant, and an edit to the wrong one is silent.
- Fix the stale detector claim on `index`, `about`, `support`.
- `download.html` says "open beta" and "No account needed to install" while step
  3 says create an account. Resolve both against whatever the public-link check
  turns up.
