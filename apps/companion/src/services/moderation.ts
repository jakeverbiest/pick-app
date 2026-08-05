/**
 * Reporting + blocking for the community feed — the mechanism App Store
 * Review Guideline 1.2 requires for any app with user-generated content.
 *
 * Reports are write-only (see firestore.rules): the app never reads them
 * back, only the Firebase console / admin tooling does.
 *
 * Blocking has two parts:
 *  - blocks/{blockerUid_blockedUid}: the enforcement record. Clients can
 *    create/delete their own (as blockerUid) but can never READ this
 *    collection — firestore.rules sets `allow read: if false`, so a blocked
 *    user has no way to query whether they've been blocked. It exists so the
 *    follows rules can deny new follow edges between blocked pairs via
 *    exists() (which bypasses read rules from inside rules evaluation), and
 *    so a Cloud Function (functions/index.js) can mirror it onto the
 *    blocked user's own doc.
 *  - users/{uid}.blocked_uids: the blocker's own copy of who they've
 *    blocked, kept in lockstep with the blocks collection. This is what
 *    powers the "Blocked accounts" screen and the blocker's own feed
 *    filtering — it's just their own document, which they could already
 *    read/write before blocking existed.
 *  - users/{uid}.blocked_by: mirrored by the Cloud Function onto the
 *    BLOCKED user's own doc. Their client reads its own doc already, so it
 *    can filter the blocker's posts out of its own feed without ever
 *    learning who blocked them or why.
 */
import {
  getFirestore, collection, doc, addDoc, getDoc, updateDoc, setDoc, deleteDoc,
  arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { app } from './firebaseConfig';
import { getAuthService } from './authService';
import type { Post } from './firebaseDatabase';

const db = getFirestore(app);

function me() {
  return getAuthService().getCurrentUser();
}

/** Report a post for review. Best-effort — never blocks the reporting UI on failure. */
export async function reportPost(post: Post, reason: string): Promise<boolean> {
  const u = me();
  if (!u) return false;
  try {
    await addDoc(collection(db, 'reports'), {
      type: 'post',
      postId: post.id,
      postAuthorUid: post.uid,
      reporterUid: u.uid,
      reason,
      createdAt: Date.now(),
    });
    return true;
  } catch (e) {
    console.warn('reportPost failed:', e);
    return false;
  }
}

/**
 * Uids to hide everywhere (feed, search, follower/following lists,
 * leaderboards): everyone this user blocked, plus everyone who blocked this
 * user. Either direction should make the two accounts invisible to each
 * other, without either side learning who initiated it.
 */
export async function getBlockedUids(): Promise<string[]> {
  const u = me();
  if (!u) return [];
  try {
    const snap = await getDoc(doc(db, 'users', u.uid));
    const data = snap.data();
    const blocked = Array.isArray(data?.blocked_uids) ? (data!.blocked_uids as string[]) : [];
    const blockedBy = Array.isArray(data?.blocked_by) ? (data!.blocked_by as string[]) : [];
    return Array.from(new Set([...blocked, ...blockedBy]));
  } catch {
    return [];
  }
}

/** Uids this user has explicitly blocked — for the "Blocked accounts" screen. */
export async function listMyBlockedUids(): Promise<string[]> {
  const u = me();
  if (!u) return [];
  try {
    const snap = await getDoc(doc(db, 'users', u.uid));
    const list = snap.data()?.blocked_uids;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function blockUser(targetUid: string): Promise<void> {
  const u = me();
  if (!u || !targetUid || targetUid === u.uid) return;
  try {
    await Promise.all([
      setDoc(doc(db, 'blocks', `${u.uid}_${targetUid}`), {
        blockerUid: u.uid,
        blockedUid: targetUid,
        created_at: Date.now(),
      }),
      updateDoc(doc(db, 'users', u.uid), { blocked_uids: arrayUnion(targetUid) }),
    ]);
    // Sever any existing follow relationship in either direction — blocking
    // should end a connection that already exists, not just prevent a new
    // one. Best-effort: deleting an edge that doesn't exist just no-ops.
    await Promise.all([
      deleteDoc(doc(db, 'follows', `${u.uid}_${targetUid}`)).catch(() => {}),
      deleteDoc(doc(db, 'follows', `${targetUid}_${u.uid}`)).catch(() => {}),
    ]);
  } catch (e) {
    console.warn('blockUser failed:', e);
  }
}

export async function unblockUser(targetUid: string): Promise<void> {
  const u = me();
  if (!u || !targetUid) return;
  try {
    await Promise.all([
      deleteDoc(doc(db, 'blocks', `${u.uid}_${targetUid}`)),
      updateDoc(doc(db, 'users', u.uid), { blocked_uids: arrayRemove(targetUid) }),
    ]);
  } catch (e) {
    console.warn('unblockUser failed:', e);
  }
}
