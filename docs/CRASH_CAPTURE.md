# Capturing long-walk crashes

PICK can die during a long walk with the screen off. Two independent sources of
evidence now exist — use both after a crash.

## 1. PICK's in-app black box (automatic, no setup)

While a cleanup is running, PICK writes a tiny "sentinel" trace to the device
every GPS tick: how long the walk has lasted, how many route points / pickups /
motion events have accumulated, and a fresh timestamp. A clean **Stop** clears
it. If the app instead crashes (or is force-quit), the sentinel survives and the
next launch converts it into a **crash report**.

**To read it:** open PICK → **Settings → Diagnostics**. Each crash report shows
how far the walk got before it died, and roughly when. Tap **Copy reports to
share** and paste the text to the developer.

What it tells us: whether the counter was still climbing right up to the crash,
how many minutes in it happened, and whether route/marker counts (the memory
proxies) were ballooning — i.e. *when and under what load* it died.

Opening PICK after a crash also automatically stops any leftover background
location tracking — that's the fix for the "location arrow on when PICK isn't
running" symptom. If you ever see that arrow with no active cleanup, you can also
force it off manually: **Settings → Diagnostics → Force-stop background
tracking**.

## 2. iOS native crash report (.ips — the stack trace + memory verdict)

iOS writes its own crash file that says *why* the OS killed the app — most
importantly whether it was a **Jetsam (out-of-memory) termination**, which is the
prime suspect for long-walk crashes.

### Easiest: from the phone (no Mac needed)

1. **Settings → Privacy & Security → Analytics & Improvements → Analytics Data**
2. Scroll to entries beginning with **`PICK-`** or **`JetsamEvent-`** with the
   date/time of your walk. (`JetsamEvent` = the OS reclaimed memory = our theory
   confirmed.)
3. Tap the entry → tap the **Share** icon (top-right) → send it to yourself
   (AirDrop / Mail / Notes) → forward the file to the developer.

> Tip: turn on **Settings → Privacy & Security → Analytics & Improvements →
> Share iPhone Analytics** before the walk so these logs are generated.

### From a Mac (more detail, symbolicated)

1. Connect the iPhone, open **Xcode → Window → Devices and Simulators**.
2. Select the device → **View Device Logs**.
3. Find the PICK crash by time, right-click → **Export Log**, send the `.ips`.

(If you don't have Xcode: **Console.app → your iPhone → Crash Reports**, or
Finder won't show these — use Console or the on-phone method above.)

## What to send after a crashed walk

1. The **Copy reports to share** text from Settings → Diagnostics, and
2. The matching **`PICK-…ips`** or **`JetsamEvent-…ips`** file.

Together these give the *when/how-loaded* (black box) and the *why* (iOS verdict)
— enough to pinpoint the remaining long-walk crash.
