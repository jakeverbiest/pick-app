/**
 * Deferred deep link for challenge invites.
 *
 * The gap this closes: a challenge QR/link scanned by someone who doesn't
 * have the app yet goes through the App Store/TestFlight detour, and the
 * challenge id has nowhere to live across that gap — a fresh install has no
 * memory of which link brought it there. This is "deferred deep linking",
 * and the technically thorough way to do it is Associated Domains +
 * Universal Links (apple-app-site-association, real domain verification) —
 * that needs new native capability, an entitlement, and a build. Skipping it
 * for this pass; see the note in `web/join.html` for the full tradeoff.
 *
 * What ships instead, JS-only, no native build:
 *
 *   1. Two people already have the app: `web/join.html` tries the custom
 *      `pickapp://challenge/{id}` scheme first (standard "app already
 *      installed" case). No pending-challenge mechanism needed there — the
 *      app opens straight into `app/challenge/[id].tsx`.
 *   2. No app yet: before falling back to the TestFlight link, the landing
 *      page writes a recognizable marker to the system clipboard. The app
 *      can't be told anything at install time, but it CAN read the
 *      clipboard once it's running for the first time post-signup — this is
 *      the same trick a lot of consumer apps use (Bitly, some referral SDKs)
 *      as a "poor man's deferred deep link" precisely because it needs no
 *      new native capability.
 *
 * Known limitations, so they aren't rediscovered as bugs:
 *   - iOS shows a system "Pasted from Safari" toast the first time the app
 *     reads a clipboard value it didn't write itself. That's expected and
 *     not a bug — there is no OTA-shippable way to suppress it, only the
 *     Universal Links path above avoids it entirely.
 *   - Clipboard is global, shared, and can go stale (a user copies something
 *     else before opening the app, or the marker sits there from an old
 *     visit to the landing page). `read()` guards with an expiry and clears
 *     the marker's meaning (not the OS clipboard itself, which apps can't
 *     silently wipe) by consuming it via AsyncStorage so it's only acted on
 *     once.
 *   - Doesn't survive an OS clipboard-clearing action, an intervening app
 *     that overwrites the clipboard, or (on some iOS versions) the
 *     background clipboard-access timeout Apple added after Safari. This is
 *     a best-effort fallback, not a guarantee — acceptable for "some extra
 *     conversions on an already-lossy funnel", not for anything that must
 *     always work.
 */
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Must match the prefix `web/join.html` writes to the clipboard. */
export const PENDING_CHALLENGE_CLIPBOARD_PREFIX = 'pick-pending-challenge:';

/** How stale a clipboard marker can be and still count — guards against an
 *  old copy from a past visit to the landing page being replayed weeks
 *  later. The marker embeds its own write time for this check. */
const MAX_MARKER_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/** Once a marker has been consumed (acted on or explicitly ignored), never
 *  act on the same one again — e.g. a second app launch shouldn't re-route
 *  someone who already landed on the challenge once. */
const CONSUMED_KEY = '@pick_pending_challenge_consumed';

function encodeMarker(challengeId: string): string {
  return `${PENDING_CHALLENGE_CLIPBOARD_PREFIX}${challengeId}:${Date.now()}`;
}

function parseMarker(raw: string): { id: string; ts: number } | null {
  if (!raw.startsWith(PENDING_CHALLENGE_CLIPBOARD_PREFIX)) return null;
  const rest = raw.slice(PENDING_CHALLENGE_CLIPBOARD_PREFIX.length);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon === -1) return null;
  const id = rest.slice(0, lastColon);
  const ts = Number(rest.slice(lastColon + 1));
  if (!id || !Number.isFinite(ts)) return null;
  return { id, ts };
}

/**
 * Look for a pending-challenge marker on the clipboard. Returns the
 * challenge id, or null if there isn't one, it's too old, or it's already
 * been consumed. Never throws — clipboard access failing (permission,
 * platform quirk) just means no pending challenge was found.
 */
export async function readPendingChallengeFromClipboard(): Promise<string | null> {
  try {
    const raw = await Clipboard.getStringAsync();
    if (!raw) return null;
    const marker = parseMarker(raw);
    if (!marker) return null;
    if (Date.now() - marker.ts > MAX_MARKER_AGE_MS) return null;

    const consumed = await AsyncStorage.getItem(CONSUMED_KEY);
    if (consumed === raw) return null;

    return marker.id;
  } catch {
    return null;
  }
}

/** Mark the current clipboard marker as handled, so it isn't acted on again
 *  on a later launch (e.g. after the user has already been routed once). */
export async function consumePendingChallengeMarker(): Promise<void> {
  try {
    const raw = await Clipboard.getStringAsync();
    if (raw && raw.startsWith(PENDING_CHALLENGE_CLIPBOARD_PREFIX)) {
      await AsyncStorage.setItem(CONSUMED_KEY, raw);
    }
  } catch {
    // Best-effort — worst case the same marker gets re-read once more.
  }
}
