/**
 * Live challenge totals — the aggregated team-event counter.
 *
 * During a walk, each participant streams their in-session pickup count to
 * `challenges/{id}/live/{uid}` (one doc per user, last-write-wins, throttled).
 * Everyone subscribed sums the docs for a real-time event total — this is
 * what fills the team bar on the Apple Watch during team events.
 *
 * Contributions are also folded into the doc across sessions: `base` holds
 * pickups from finished walks (bumped on save), `session` the live count.
 */
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  setDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { app } from './firebaseConfig';
import type { Challenge } from './firebaseDatabase';

const db = getFirestore(app);

export interface LiveEvent {
  id: string;
  name: string;
  goal: number; // goal_value, in pickups
}

/**
 * The challenge whose bar the watch should show: active, pickup-based,
 * joined by this user, and currently within its date window.
 */
export async function findMyLiveEvent(uid: string): Promise<LiveEvent | null> {
  try {
    // `status` is written once at creation and never updated, so a challenge
    // scheduled for a future day is stored as 'upcoming' and stays that way
    // even after its start date arrives. Match both and let the date window
    // below decide — that's the only source of truth (see challengeStatus).
    const snap = await getDocs(
      query(collection(db, 'challenges'), where('status', 'in', ['active', 'upcoming']))
    );
    const now = Date.now() / 1000;
    for (const d of snap.docs) {
      const c = d.data() as Challenge;
      if (
        c.goal_type === 'pickups' &&
        (c.participants || []).includes(uid) &&
        c.start_date <= now &&
        c.end_date >= now
      ) {
        return { id: d.id, name: c.name, goal: c.goal_value };
      }
    }
  } catch (error) {
    console.error('Live event lookup failed:', error);
  }
  return null;
}

/** Subscribe to the event's live total (sum of everyone's base + session). */
export function subscribeEventTotal(
  challengeId: string,
  onTotal: (total: number) => void
): () => void {
  const unsub = onSnapshot(
    collection(db, 'challenges', challengeId, 'live'),
    (snap) => {
      let total = 0;
      snap.forEach((d) => {
        const data = d.data();
        total += (Number(data.base) || 0) + (Number(data.session) || 0);
      });
      onTotal(total);
    },
    (error) => console.error('Event total subscription failed:', error)
  );
  return unsub;
}

let lastReport = 0;

/** Throttled: stream my in-session count to the event (max ~1 write/10s). */
export async function reportSessionPickups(
  challengeId: string,
  uid: string,
  sessionPickups: number,
  force = false
): Promise<void> {
  const now = Date.now();
  if (!force && now - lastReport < 10000) return;
  lastReport = now;
  try {
    await setDoc(
      doc(db, 'challenges', challengeId, 'live', uid),
      { session: sessionPickups, updated_at: now },
      { merge: true }
    );
  } catch (error) {
    console.error('Live pickup report failed:', error);
  }
}

/** On walk save: fold the session into `base` and zero the live count. */
export async function commitSessionPickups(
  challengeId: string,
  uid: string,
  sessionPickups: number,
  priorBase: number | null = null
): Promise<void> {
  try {
    const ref = doc(db, 'challenges', challengeId, 'live', uid);
    if (priorBase === null) {
      // Cheap path: read-free increment via merge of session into base is not
      // atomic without a read; a session's worth of drift is acceptable here.
      const { getDoc } = await import('firebase/firestore');
      const cur = await getDoc(ref);
      priorBase = Number(cur.data()?.base) || 0;
    }
    await setDoc(
      ref,
      { base: priorBase + sessionPickups, session: 0, updated_at: Date.now() },
      { merge: true }
    );
  } catch (error) {
    console.error('Live pickup commit failed:', error);
  }
}
