/**
 * Public profiles + discovery for the follow system.
 *
 * Three collections:
 *   profiles/{uid}          → { uid, handle, handleLower, display_name,
 *                              neighborhood, updated_at }  (public, no email)
 *   handles/{handleLower}   → { uid }   claim doc that enforces uniqueness
 *   email_index/{encEmail}  → { uid }   lets someone who ALREADY knows your
 *                              email find you; the collection can't be listed,
 *                              so addresses can't be harvested.
 *
 * Discovery is one-way-follow friendly: anyone signed in can look a picker up
 * by handle (prefix) or by exact email, then follow them (see follows.ts).
 */
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, orderBy, limit, runTransaction,
} from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { app } from './firebaseConfig';
import { getAuthService } from './authService';

const db = getFirestore(app);
const storage = getStorage(app);

export interface PublicProfile {
  uid: string;
  handle: string;        // as displayed, e.g. "JakeV"
  handleLower: string;   // lookup key, e.g. "jakev"
  display_name: string;
  neighborhood: string;
  updated_at: number;
  /** Profile picture (Storage URL). Falls back to the initial letter. */
  avatar_url?: string;
  /**
   * Opted out of having their profile opened by other people. Their name still
   * appears on leaderboards (that's the separate `leaderboard_hidden` setting)
   * but it isn't tappable, and the profile screen shows a private notice.
   * Lives on the PUBLIC profile doc so any screen can check it without needing
   * read access to the owner's settings.
   */
  hidden?: boolean;
}

/** Turn "anyone can open my profile" on or off. */
export async function setProfileHidden(hidden: boolean): Promise<void> {
  const u = me();
  if (!u) return;
  await setDoc(doc(db, 'profiles', u.uid), { uid: u.uid, hidden, updated_at: Date.now() }, { merge: true });
}

/**
 * Upload a profile picture and stamp it on the public profile.
 * (Longer-term: avatar builder / memoji — for now, any image.)
 */
export async function uploadAvatar(localUri: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const u = me();
  if (!u) return { ok: false, error: 'Sign in first.' };
  try {
    const blob = await (await fetch(localUri)).blob();
    const ref = storageRef(storage, `avatars/${u.uid}/avatar.jpg`);
    await uploadBytes(ref, blob, { contentType: 'image/jpeg' });
    const url = await getDownloadURL(ref);
    await setDoc(doc(db, 'profiles', u.uid), { uid: u.uid, avatar_url: url, updated_at: Date.now() }, { merge: true });
    return { ok: true, url };
  } catch (e: any) {
    console.error('Avatar upload failed:', e);
    return { ok: false, error: e?.message || 'Upload failed.' };
  }
}

// A handle: 3–20 chars, letters/numbers/underscore, must start with a letter.
const HANDLE_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

export function normalizeHandle(raw: string): string {
  return (raw || '').trim().replace(/^@/, '');
}
export function isValidHandle(raw: string): boolean {
  return HANDLE_RE.test(normalizeHandle(raw));
}
function normalizeEmail(raw: string): string {
  return (raw || '').trim().toLowerCase();
}
// Firestore doc id keyed off the email. encodeURIComponent removes any
// disallowed characters (there's no '/' in an email anyway) and the
// email_index collection forbids `list` in the rules, so the only way to read
// an entry is to know the exact email — no browsing everyone's addresses.
function emailKey(email: string): string {
  return encodeURIComponent(normalizeEmail(email));
}

function me() {
  return getAuthService().getCurrentUser();
}

/** Read a public profile (or null). */
export async function getProfile(uid: string): Promise<PublicProfile | null> {
  if (!uid) return null;
  const snap = await getDoc(doc(db, 'profiles', uid));
  return snap.exists() ? ({ uid, ...(snap.data() as any) }) : null;
}

/** Read many profiles at once (keeps order of the input ids). */
export async function getProfiles(uids: string[]): Promise<PublicProfile[]> {
  const out = await Promise.all(uids.map((u) => getProfile(u)));
  return out.filter(Boolean) as PublicProfile[];
}

/**
 * Create/refresh the caller's public profile fields (name, neighborhood, email
 * index). Does NOT change the handle — use setHandle for that. Safe to call on
 * every launch / profile edit.
 */
export async function ensureProfile(opts?: { display_name?: string; neighborhood?: string }): Promise<void> {
  const u = me();
  if (!u) return;
  const existing = await getProfile(u.uid);
  const display_name = opts?.display_name ?? u.displayName ?? existing?.display_name ?? 'Picker';
  const neighborhood = opts?.neighborhood ?? (u as any).neighborhood ?? existing?.neighborhood ?? '';
  await setDoc(
    doc(db, 'profiles', u.uid),
    {
      uid: u.uid,
      display_name,
      neighborhood,
      handle: existing?.handle ?? '',
      handleLower: existing?.handleLower ?? '',
      updated_at: Date.now(),
    },
    { merge: true }
  );
  // Email index: lets people who know your email find you. The collection
  // can't be listed (rules), so the entry is only reachable by exact email.
  if (u.email) {
    await setDoc(doc(db, 'email_index', emailKey(u.email)), { uid: u.uid }, { merge: true });
  }
}

/**
 * Claim/change the caller's handle. Uniqueness is enforced by a transaction on
 * handles/{handleLower}: the claim only succeeds if no one else holds it.
 * Returns { ok } or { ok:false, error }.
 */
export async function setHandle(raw: string): Promise<{ ok: boolean; error?: string }> {
  const u = me();
  if (!u) return { ok: false, error: 'Sign in first.' };
  const handle = normalizeHandle(raw);
  if (!isValidHandle(handle)) {
    return { ok: false, error: 'Handles are 3–20 letters, numbers or _, starting with a letter.' };
  }
  const handleLower = handle.toLowerCase();
  try {
    await runTransaction(db, async (tx) => {
      const claimRef = doc(db, 'handles', handleLower);
      const claim = await tx.get(claimRef);
      if (claim.exists() && (claim.data() as any).uid !== u.uid) {
        throw new Error('taken');
      }
      const profRef = doc(db, 'profiles', u.uid);
      const prof = await tx.get(profRef);
      const prevLower = prof.exists() ? (prof.data() as any).handleLower : '';

      tx.set(claimRef, { uid: u.uid });
      tx.set(
        profRef,
        {
          uid: u.uid,
          handle,
          handleLower,
          display_name: prof.exists() ? (prof.data() as any).display_name ?? u.displayName ?? 'Picker' : u.displayName ?? 'Picker',
          neighborhood: prof.exists() ? (prof.data() as any).neighborhood ?? '' : (u as any).neighborhood ?? '',
          updated_at: Date.now(),
        },
        { merge: true }
      );
      // Release the old handle so someone else can take it.
      if (prevLower && prevLower !== handleLower) {
        tx.delete(doc(db, 'handles', prevLower));
      }
    });
    return { ok: true };
  } catch (e: any) {
    if (String(e?.message) === 'taken') return { ok: false, error: 'That handle is already taken.' };
    console.error('setHandle failed:', e);
    return { ok: false, error: 'Could not save that handle. Try again.' };
  }
}

/** Prefix search by handle, e.g. "jak" → jakev, jakson… (case-insensitive). */
export async function searchByHandle(prefix: string, max = 15): Promise<PublicProfile[]> {
  const p = normalizeHandle(prefix).toLowerCase();
  if (p.length < 2) return [];
  const end = p + '';
  try {
    const snap = await getDocs(
      query(
        collection(db, 'profiles'),
        orderBy('handleLower'),
        where('handleLower', '>=', p),
        where('handleLower', '<=', end),
        limit(max)
      )
    );
    const meUid = me()?.uid;
    return snap.docs
      .map((d) => ({ uid: d.id, ...(d.data() as any) }) as PublicProfile)
      .filter((pr) => pr.handleLower && pr.uid !== meUid && !pr.hidden);
  } catch (e) {
    console.error('searchByHandle failed:', e);
    return [];
  }
}

/** Exact-email lookup: only finds a person if you already know their email. */
export async function findByEmail(email: string): Promise<PublicProfile | null> {
  const norm = normalizeEmail(email);
  if (!norm.includes('@')) return null;
  try {
    const idx = await getDoc(doc(db, 'email_index', emailKey(norm)));
    if (!idx.exists()) return null;
    const uid = (idx.data() as any).uid as string;
    if (!uid || uid === me()?.uid) return null;
    return await getProfile(uid);
  } catch (e) {
    console.error('findByEmail failed:', e);
    return null;
  }
}
