/**
 * Live "who's cleaning now" presence.
 *
 * While a walk is active, we keep a small doc at live_walks/{uid} and refresh
 * its `lastPing` on a heartbeat. A walk counts as "live" only if its lastPing
 * is within STALE_MS — so a crashed/abandoned walk simply ages out of the count
 * without needing a server sweep. On a normal stop we delete the doc outright.
 *
 * PRIVACY: we store the neighborhood NAME only — never coordinates. "Someone is
 * cleaning in Carroll Gardens" is energizing; a live GPS pin would not be okay.
 */
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, getDocs,
} from 'firebase/firestore';
import { app } from './firebaseConfig';
import { getAuthService } from './authService';

const db = getFirestore(app);

/** A walk is "live" if it pinged within this window. Heartbeat is ~45s. */
export const STALE_MS = 150000;

export interface LiveWalk {
  userId: string;
  display_name: string;
  neighborhood: string;
  startedAt: number;
  lastPing: number;
}

function me() {
  return getAuthService().getCurrentUser();
}

/** Announce that the current user just started a walk. */
export async function startPresence(neighborhood: string): Promise<void> {
  const u = me();
  if (!u) return;
  const now = Date.now();
  try {
    await setDoc(doc(db, 'live_walks', u.uid), {
      userId: u.uid,
      display_name: u.displayName || 'A picker',
      neighborhood: neighborhood || '',
      startedAt: now,
      lastPing: now,
    });
  } catch (e) {
    // Presence is best-effort; never let it interrupt a walk.
    console.warn('startPresence failed:', e);
  }
}

/** Heartbeat — keeps the walk counted as live. */
export async function pingPresence(): Promise<void> {
  const u = me();
  if (!u) return;
  try {
    await updateDoc(doc(db, 'live_walks', u.uid), { lastPing: Date.now() });
  } catch {
    // Doc may not exist (e.g., resumed walk) — recreate it.
    try { await startPresence(''); } catch {}
  }
}

/** Walk ended — remove the presence doc. */
export async function endPresence(): Promise<void> {
  const u = me();
  if (!u) return;
  try {
    await deleteDoc(doc(db, 'live_walks', u.uid));
  } catch {}
}

/** All walks currently live (fresh ping), newest first. */
export async function getLiveWalks(): Promise<LiveWalk[]> {
  try {
    const snap = await getDocs(collection(db, 'live_walks'));
    const cutoff = Date.now() - STALE_MS;
    return snap.docs
      .map((d) => d.data() as LiveWalk)
      .filter((w) => typeof w.lastPing === 'number' && w.lastPing >= cutoff)
      .sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}
