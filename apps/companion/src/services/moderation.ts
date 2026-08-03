/**
 * Reporting + blocking for the community feed — the mechanism App Store
 * Review Guideline 1.2 requires for any app with user-generated content.
 *
 * Reports are write-only (see firestore.rules): the app never reads them
 * back, only the Firebase console / admin tooling does. Blocking is purely
 * client-side filtering — a blocked uid's posts are hidden from the
 * blocker's own feed, stored on the blocker's own user doc.
 */
import {
  getFirestore, collection, doc, addDoc, getDoc, updateDoc, arrayUnion, arrayRemove,
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

/** Blocked uids never appear in this user's feed again, on any device. */
export async function getBlockedUids(): Promise<string[]> {
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
    await updateDoc(doc(db, 'users', u.uid), { blocked_uids: arrayUnion(targetUid) });
  } catch (e) {
    console.warn('blockUser failed:', e);
  }
}

export async function unblockUser(targetUid: string): Promise<void> {
  const u = me();
  if (!u) return;
  try {
    await updateDoc(doc(db, 'users', u.uid), { blocked_uids: arrayRemove(targetUid) });
  } catch (e) {
    console.warn('unblockUser failed:', e);
  }
}
