/**
 * Challenges — a group of pickers opting into a shared limitation (an area, a
 * window of time) and working toward one collective number.
 *
 * The old Challenges tab had a UI but no backend: challenges could only be
 * hand-written into Firestore, and the progress bar filled with "how many
 * people joined" rather than any actual cleanup work. This module is the
 * missing half.
 *
 * ## Shape of a challenge
 *
 *   WHERE  `area` — anywhere, a named neighborhood, or a user-drawn boundary.
 *   WHEN   `start_date`/`end_date` — a multi-day window or a single day.
 *   WHAT   `goal_type` + `goal_value` — the collective target.
 *   WHO    `participants` — opt-in; only members' cleanups count.
 *
 * ## How progress is counted (no Cloud Function required)
 *
 * Cleanups are owner-only reads by design (routes can reveal home addresses),
 * so nobody can tally someone else's work by reading raw cleanups. Instead each
 * participant computes their OWN contribution from their own cleanup history
 * and publishes just the totals to `challenges/{id}/contrib/{uid}`. Anyone can
 * read that subcollection, so the group total is a sum of small public numbers
 * and no location data ever leaves the owner.
 *
 * That means a member's contribution refreshes when they open the app. It's
 * eventually consistent by design; the separate `live` subcollection
 * (challengeLive.ts) still carries the second-by-second count during a walk.
 *
 * ## Geometry note
 *
 * Firestore has no nested-array type, so a drawn boundary is stored FLAT as
 * `area.ring = [lat, lon, lat, lon, …]` — the same encoding adoptions use for
 * block polylines. Writing `[[lat, lon], …]` throws at addDoc time.
 */
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { app } from './firebaseConfig';
import { getAuthService } from './authService';
import type { Cleanup } from './firebaseDatabase';
import { cleanupBags } from './impactMetrics';

const db = getFirestore(app);

// ------------------------------------------------------------------- types

export type ChallengeGoalType = 'pickups' | 'bags' | 'cleanups';
export type ChallengeAreaType = 'anywhere' | 'neighborhood' | 'custom';
export type ChallengeStatus = 'upcoming' | 'active' | 'completed';

export interface ChallengeArea {
  type: ChallengeAreaType;
  /** Human label: "Carroll Gardens", "Anywhere", "Custom area". */
  label: string;
  /** Drawn boundary, FLAT: [lat, lon, lat, lon, …]. Only for type 'custom'. */
  ring?: number[];
  /** [minLat, minLon, maxLat, maxLon] — cheap reject before the ray cast. */
  bbox?: number[];
}

export interface Challenge {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  creator_name?: string;
  created_at: number;
  updated_at: number;

  /** Epoch SECONDS, matching cleanup timestamps. */
  start_date: number;
  end_date: number;
  /** 'day' renders as a single date; 'range' as a span. Purely presentational. */
  kind: 'day' | 'range';

  area: ChallengeArea;
  goal_type: ChallengeGoalType;
  goal_value: number;

  participants: string[];
  /**
   * Invited but not yet joined. A uid lives in exactly one of `invited` or
   * `participants` — accepting moves it across, declining just removes it.
   */
  invited?: string[];
  /** 'team' challenges only show up for members of `team`. */
  visibility: 'public' | 'team';
  team?: string;

  /** Denormalised so old readers (and the watch) keep working. */
  status: ChallengeStatus;
}

/** One participant's published totals. */
export interface Contribution {
  uid: string;
  display_name: string;
  pickups: number;
  bags: number;
  cleanups: number;
  updated_at: number;
}

export const GOAL_LABEL: Record<ChallengeGoalType, string> = {
  pickups: 'pickups',
  bags: 'bags',
  cleanups: 'cleanups',
};

// --------------------------------------------------------------- geometry

/** Flatten a ring for storage. Firestore rejects nested arrays. */
export function flattenRing(ring: [number, number][]): number[] {
  const out: number[] = [];
  for (const p of ring) {
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) continue;
    out.push(p[0], p[1]);
  }
  return out;
}

/** Rebuild [lat, lon] pairs from the flat form. */
export function unflattenRing(flat?: number[]): [number, number][] {
  if (!Array.isArray(flat) || flat.length < 6) return []; // a ring needs 3+ points
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const lat = Number(flat[i]);
    const lon = Number(flat[i + 1]);
    if (isFinite(lat) && isFinite(lon)) out.push([lat, lon]);
  }
  return out;
}

export function ringBbox(ring: [number, number][]): number[] {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  for (const [lat, lon] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return [minLat, minLon, maxLat, maxLon];
}

/**
 * Standard ray-casting point-in-polygon. Fine at neighborhood scale — over a
 * few km, treating lat/lon as planar introduces error far below the GPS noise
 * we're already living with.
 */
export function pointInRing(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Does this cleanup fall inside the challenge's area? */
export function cleanupInArea(c: Pick<Cleanup, 'location_lat' | 'location_lon' | 'neighborhood'>, area: ChallengeArea): boolean {
  if (!area || area.type === 'anywhere') return true;

  if (area.type === 'neighborhood') {
    const want = (area.label || '').trim().toLowerCase();
    const got = (c.neighborhood || '').trim().toLowerCase();
    return !!want && want === got;
  }

  const lat = Number(c.location_lat);
  const lon = Number(c.location_lon);
  if (!isFinite(lat) || !isFinite(lon)) return false;

  const bb = area.bbox;
  if (bb && bb.length === 4 && (lat < bb[0] || lat > bb[2] || lon < bb[1] || lon > bb[3])) return false;

  const ring = unflattenRing(area.ring);
  if (ring.length < 3) return false;
  return pointInRing(lat, lon, ring);
}

// ------------------------------------------------------------------ status

export function challengeStatus(c: Pick<Challenge, 'start_date' | 'end_date'>, nowSec = Date.now() / 1000): ChallengeStatus {
  if (nowSec < c.start_date) return 'upcoming';
  if (nowSec > c.end_date) return 'completed';
  return 'active';
}

/** Whole days remaining (0 once it's over). */
export function daysLeft(c: Pick<Challenge, 'end_date'>, nowSec = Date.now() / 1000): number {
  return Math.max(0, Math.ceil((c.end_date - nowSec) / 86400));
}

// ------------------------------------------------------------------- CRUD

export interface NewChallengeInput {
  name: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  kind: 'day' | 'range';
  area: { type: ChallengeAreaType; label: string; ring?: [number, number][] };
  goal_type: ChallengeGoalType;
  goal_value: number;
  visibility?: 'public' | 'team';
  team?: string;
}

export function validateChallenge(i: NewChallengeInput): string | null {
  if (!i.name || i.name.trim().length < 3) return 'Give the challenge a name (at least 3 characters).';
  if (i.name.trim().length > 60) return 'Keep the name under 60 characters.';
  if (!(i.goal_value > 0)) return 'Set a goal greater than zero.';
  if (i.goal_value > 1_000_000) return 'That goal is unrealistically large.';
  if (i.endDate.getTime() < i.startDate.getTime()) return 'The end date is before the start date.';
  // Compare on calendar days: "today" is always allowed even though its
  // midnight is already in the past.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const chosenStart = new Date(i.startDate);
  chosenStart.setHours(0, 0, 0, 0);
  if (chosenStart.getTime() < todayStart.getTime()) return 'Challenges can’t start in the past.';
  if (i.endDate.getTime() - i.startDate.getTime() > 366 * 86400000) return 'Challenges can run for at most a year.';
  if (i.area.type === 'custom' && (!i.area.ring || i.area.ring.length < 3)) {
    return 'Draw at least three points to close the boundary.';
  }
  if (i.area.type === 'neighborhood' && !i.area.label) return 'Pick a neighborhood.';
  if (i.visibility === 'team' && !i.team) return 'Pick the team this challenge belongs to.';
  return null;
}

/** Create a challenge. The creator joins automatically. */
export async function createChallenge(input: NewChallengeInput): Promise<string> {
  const user = getAuthService().getCurrentUser();
  if (!user) throw new Error('Sign in to create a challenge.');

  const problem = validateChallenge(input);
  if (problem) throw new Error(problem);

  // Challenges are whole calendar days. A future start begins at that day's
  // midnight; a start of "today" begins now, so a challenge you create at noon
  // doesn't retroactively claim the morning's walks.
  const startOfDay = new Date(input.startDate);
  startOfDay.setHours(0, 0, 0, 0);
  const start = Math.floor(Math.max(startOfDay.getTime(), Date.now()) / 1000);
  // A 'day' challenge always runs to the end of that local day, whatever time
  // it was created — otherwise "today's challenge" expires at lunchtime.
  const endBase = input.kind === 'day' ? input.startDate : input.endDate;
  const endOfDay = new Date(endBase);
  endOfDay.setHours(23, 59, 59, 999);
  const end = Math.floor(endOfDay.getTime() / 1000);

  const area: ChallengeArea = { type: input.area.type, label: input.area.label || 'Anywhere' };
  if (input.area.type === 'custom' && input.area.ring?.length) {
    area.ring = flattenRing(input.area.ring);
    area.bbox = ringBbox(input.area.ring);
  }

  const now = Date.now();
  const docData = {
    name: input.name.trim(),
    description: (input.description || '').trim(),
    created_by: user.uid,
    creator_name: user.displayName || 'Picker',
    created_at: now,
    updated_at: now,
    start_date: start,
    end_date: end,
    kind: input.kind,
    area,
    goal_type: input.goal_type,
    goal_value: Math.round(input.goal_value),
    participants: [user.uid],
    invited: [],
    visibility: input.visibility || 'public',
    ...(input.team ? { team: input.team } : {}),
    status: challengeStatus({ start_date: start, end_date: end }),
  };

  const ref = await addDoc(collection(db, 'challenges'), docData);
  return ref.id;
}

function fromDoc(id: string, data: any): Challenge {
  const c = { id, ...(data || {}) } as Challenge;
  // `status` is denormalised at write time and goes stale as dates pass, so
  // always trust the dates over the stored field.
  c.status = challengeStatus(c);
  if (!c.area) c.area = { type: 'anywhere', label: 'Anywhere' };
  if (!Array.isArray(c.participants)) c.participants = [];
  if (!Array.isArray(c.invited)) c.invited = [];
  return c;
}

export async function getChallenge(id: string): Promise<Challenge | null> {
  const snap = await getDoc(doc(db, 'challenges', id));
  return snap.exists() ? fromDoc(snap.id, snap.data()) : null;
}

/**
 * Every challenge visible to this user, newest window first. Filtering by
 * status happens client-side because the stored `status` field can be stale.
 */
export async function listChallenges(opts?: { team?: string }): Promise<Challenge[]> {
  const uid = getAuthService().getCurrentUser()?.uid || '';
  const snap = await getDocs(collection(db, 'challenges'));
  return snap.docs
    .map((d) => fromDoc(d.id, d.data()))
    .filter((c) => {
      if (c.visibility !== 'team') return true;
      // Team challenges are for that team's members (and always the creator).
      return c.created_by === uid || (!!opts?.team && c.team === opts.team);
    })
    .sort((a, b) => {
      const rank = (c: Challenge) => (c.status === 'active' ? 0 : c.status === 'upcoming' ? 1 : 2);
      return rank(a) - rank(b) || b.start_date - a.start_date;
    });
}

export async function joinChallenge(id: string, uid: string): Promise<void> {
  // Joining clears any pending invite for the same person, so a uid is never
  // in both lists and the "invited you" section empties on accept.
  await updateDoc(doc(db, 'challenges', id), {
    participants: arrayUnion(uid),
    invited: arrayRemove(uid),
    updated_at: Date.now(),
  });
}

// ----------------------------------------------------------------- invites

/** Invite people. No-op for anyone already in or already invited. */
export async function inviteToChallenge(id: string, uids: string[]): Promise<void> {
  const clean = [...new Set((uids || []).filter(Boolean))];
  if (!clean.length) return;
  await updateDoc(doc(db, 'challenges', id), {
    invited: arrayUnion(...clean),
    updated_at: Date.now(),
  });
}

/** Turn down an invite — removes you from `invited` without joining. */
export async function declineInvite(id: string, uid: string): Promise<void> {
  await updateDoc(doc(db, 'challenges', id), { invited: arrayRemove(uid), updated_at: Date.now() });
}

/** Challenges I've been invited to but haven't joined, soonest-ending first. */
export async function listMyInvites(): Promise<Challenge[]> {
  const user = getAuthService().getCurrentUser();
  if (!user) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'challenges'), where('invited', 'array-contains', user.uid))
    );
    return snap.docs
      .map((d) => fromDoc(d.id, d.data()))
      .filter((c) => c.status !== 'completed' && !c.participants.includes(user.uid))
      .sort((a, b) => a.end_date - b.end_date);
  } catch (e) {
    console.error('Failed to read invites:', e);
    return [];
  }
}

/**
 * A link that opens the challenge in the app.
 *
 * Two links, one covering each case, since we can't tell from a message
 * which situation the recipient is in:
 *   - Already has Pick: the `pickapp://` custom scheme, which expo-router
 *     already resolves to `app/challenge/[id]` with no extra config.
 *   - Doesn't have it yet: `pickglobal.org/join?challenge={id}` — the web
 *     landing page (`~/pick-app/web/join.html`) that carries the challenge
 *     id across the App Store detour via a clipboard handoff, so it's still
 *     there when they open the app for the first time post-signup. See
 *     `src/services/pendingChallenge.ts` for how the app picks it back up.
 *
 * The landing page itself also tries the custom scheme first (in case the
 * recipient tapped a share-sheet "copy link" version of this message rather
 * than the raw pickapp:// line below), so it's a safe universal fallback
 * either way — but keeping both lines means someone who already has the app
 * never has to leave it to get there.
 */
export function challengeInviteMessage(c: Challenge, inviterName?: string): string {
  const who = inviterName ? `${inviterName} invited you` : "You're invited";
  return (
    `${who} to "${c.name}" on Pick — ${challengeSubtitle(c)}.\n` +
    `We're going for ${c.goal_value.toLocaleString()} ${GOAL_LABEL[c.goal_type]} together.\n\n` +
    `Open in Pick: pickapp://challenge/${c.id}\n` +
    `Don't have it yet? https://pickglobal.org/join?challenge=${c.id}`
  );
}

export async function leaveChallenge(id: string, uid: string): Promise<void> {
  await updateDoc(doc(db, 'challenges', id), { participants: arrayRemove(uid), updated_at: Date.now() });
  // Drop the published contribution too, so leaving actually removes the work
  // from the group total rather than leaving a ghost number behind.
  try {
    await deleteDoc(doc(db, 'challenges', id, 'contrib', uid));
  } catch {}
}

/** Only the creator can delete. */
export async function deleteChallenge(id: string): Promise<void> {
  await deleteDoc(doc(db, 'challenges', id));
}

// ------------------------------------------------------------ contributions

/** Sum one user's qualifying cleanups. Pure — easy to test, no I/O. */
export function computeContribution(
  c: Pick<Challenge, 'start_date' | 'end_date' | 'area'>,
  cleanups: Cleanup[]
): { pickups: number; bags: number; cleanups: number } {
  let pickups = 0;
  let bags = 0;
  let count = 0;
  for (const cl of cleanups) {
    const ts = Number(cl.timestamp) || 0;
    if (ts < c.start_date || ts > c.end_date) continue;
    if (!cleanupInArea(cl, c.area)) continue;
    pickups += Number(cl.items_count) || 0;
    bags += cleanupBags(cl);
    count += 1;
  }
  return { pickups, bags: Number(bags.toFixed(2)), cleanups: count };
}

/**
 * Recompute my contribution from my own cleanups and publish the totals.
 * Called when the challenge screen opens and after saving a cleanup.
 */
export async function publishMyContribution(challenge: Challenge, myCleanups: Cleanup[]): Promise<Contribution | null> {
  const user = getAuthService().getCurrentUser();
  if (!user) return null;
  if (!challenge.participants.includes(user.uid)) return null;

  const totals = computeContribution(challenge, myCleanups);
  const payload: Contribution = {
    uid: user.uid,
    display_name: user.displayName || 'Picker',
    pickups: totals.pickups,
    bags: totals.bags,
    cleanups: totals.cleanups,
    updated_at: Date.now(),
  };
  try {
    await setDoc(doc(db, 'challenges', challenge.id, 'contrib', user.uid), payload);
  } catch (e) {
    console.warn('Contribution publish failed (non-fatal):', e);
  }
  return payload;
}

/**
 * Republish my contribution to every challenge I've joined that is currently
 * running. Called after a cleanup saves — that's the moment the group total
 * would otherwise go stale until someone reopened the app.
 */
export async function refreshMyChallengeContributions(): Promise<void> {
  const user = getAuthService().getCurrentUser();
  if (!user) return;

  const snap = await getDocs(
    query(collection(db, 'challenges'), where('participants', 'array-contains', user.uid))
  );
  const mine = snap.docs.map((d) => fromDoc(d.id, d.data())).filter((c) => c.status === 'active');
  if (!mine.length) return;

  // One cleanup read for all of them.
  const { getDatabase } = await import('./database');
  const database = await getDatabase();
  const cleanups = (await database.getCleanups(1000)) as unknown as Cleanup[];

  await Promise.all(mine.map((c) => publishMyContribution(c, cleanups)));
}

/** Everyone's published totals, biggest contributor first. */
export async function getContributions(challengeId: string): Promise<Contribution[]> {
  try {
    const snap = await getDocs(collection(db, 'challenges', challengeId, 'contrib'));
    return snap.docs
      .map((d) => ({ uid: d.id, ...(d.data() as any) }) as Contribution)
      .sort((a, b) => (b.pickups || 0) - (a.pickups || 0));
  } catch (e) {
    console.error('Failed to read contributions:', e);
    return [];
  }
}

/** The group's number for this challenge's goal metric. */
export function totalFor(goal: ChallengeGoalType, contributions: Contribution[]): number {
  return contributions.reduce((sum, c) => sum + (Number((c as any)[goal]) || 0), 0);
}

/** A short "Carroll Gardens · Sat 2 Aug" style line for cards. */
export function challengeSubtitle(c: Challenge): string {
  const when =
    c.kind === 'day'
      ? new Date(c.start_date * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : `${new Date(c.start_date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(
          c.end_date * 1000
        ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return `${c.area?.label || 'Anywhere'}  ·  ${when}`;
}
