/**
 * One-way follow graph.
 *
 * follows/{followerId_followingId} → { followerId, followingId, created_at }
 *
 * One-way, Twitter-style: you follow someone and immediately see their posts;
 * no approval step. The deterministic doc id keeps it idempotent (following
 * twice is a no-op) and lets the security rules verify the caller owns the
 * follower side.
 */
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where,
} from 'firebase/firestore';
import { app } from './firebaseConfig';
import { getAuthService } from './authService';

const db = getFirestore(app);

function me() {
  return getAuthService().getCurrentUser();
}
function edgeId(follower: string, following: string) {
  return `${follower}_${following}`;
}

/** Follow someone (idempotent). */
export async function follow(followingId: string): Promise<void> {
  const u = me();
  if (!u) throw new Error('Sign in to follow people.');
  if (!followingId || followingId === u.uid) return;
  await setDoc(doc(db, 'follows', edgeId(u.uid, followingId)), {
    followerId: u.uid,
    followingId,
    created_at: Date.now(),
  });
}

/** Unfollow someone (idempotent). */
export async function unfollow(followingId: string): Promise<void> {
  const u = me();
  if (!u || !followingId) return;
  await deleteDoc(doc(db, 'follows', edgeId(u.uid, followingId)));
}

/** Am I following this person? */
export async function isFollowing(followingId: string): Promise<boolean> {
  const u = me();
  if (!u || !followingId) return false;
  const snap = await getDoc(doc(db, 'follows', edgeId(u.uid, followingId)));
  return snap.exists();
}

/** UIDs the caller follows. */
export async function listFollowingIds(): Promise<string[]> {
  const u = me();
  if (!u) return [];
  const snap = await getDocs(query(collection(db, 'follows'), where('followerId', '==', u.uid)));
  return snap.docs.map((d) => (d.data() as any).followingId as string).filter(Boolean);
}

/** UIDs who follow the caller. */
export async function listFollowerIds(): Promise<string[]> {
  const u = me();
  if (!u) return [];
  const snap = await getDocs(query(collection(db, 'follows'), where('followingId', '==', u.uid)));
  return snap.docs.map((d) => (d.data() as any).followerId as string).filter(Boolean);
}

/** Follower / following counts for any user (for profile chips). */
export async function followCounts(uid: string): Promise<{ followers: number; following: number }> {
  if (!uid) return { followers: 0, following: 0 };
  const [followers, following] = await Promise.all([
    getDocs(query(collection(db, 'follows'), where('followingId', '==', uid))),
    getDocs(query(collection(db, 'follows'), where('followerId', '==', uid))),
  ]);
  return { followers: followers.size, following: following.size };
}
