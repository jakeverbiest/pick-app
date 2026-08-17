/**
 * Bluesky (AT Protocol) integration — the one platform Pick can actually post
 * to directly, no app review required. Instagram/Facebook only offer a Graph
 * API for Business accounts behind Meta's app-review process, so autopost
 * there is a separate, longer-lead initiative; this covers Bluesky only.
 *
 * Auth model: Bluesky "app passwords" (not OAuth) — a user generates one at
 * bsky.app/settings/app-passwords and pairs it with their handle. We store
 * that handle + app password in SecureStore (Keychain-backed) and re-run
 * com.atproto.server.createSession on each post rather than juggling refresh
 * tokens — one extra request per post, far simpler and just as correct.
 */
import * as SecureStore from 'expo-secure-store';
// expo-file-system 19 split the API: readAsStringAsync/EncodingType now live
// only under /legacy. Importing the modern entry left EncodingType undefined,
// so `FileSystem.EncodingType.Base64` threw and Bluesky photo upload crashed
// for every user. This was the long-standing typecheck error in this file.
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { getAuthService } from './authService';

const SERVICE = 'https://bsky.social';

// Keyed per signed-in Pick account (Firebase uid) — these used to be fixed,
// device-wide keys, so connecting Bluesky under one Pick account leaked into
// every other Pick account signed into on the same device/install. Anyone
// who connected before this fix will need to reconnect once; there's no way
// to know which Pick account the old un-scoped credentials "belonged" to.
function keys(uid: string) {
  return {
    identifier: `pick_bluesky_identifier_${uid}`,
    password: `pick_bluesky_app_password_${uid}`,
    handle: `pick_bluesky_handle_${uid}`,
  };
}

function currentUid(): string | null {
  return getAuthService().getCurrentUser()?.uid ?? null;
}

export interface BlueskyAccount {
  handle: string;
}

/** Verify credentials work, then store them. Throws with a readable message on failure. */
export async function connectBluesky(identifier: string, appPassword: string): Promise<BlueskyAccount> {
  const uid = currentUid();
  if (!uid) throw new Error('Sign in first.');
  const trimmedId = identifier.trim().replace(/^@/, '');
  const trimmedPw = appPassword.trim();
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: trimmedId, password: trimmedPw }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || 'Could not sign in — check your handle and app password.');
  }
  const data = await res.json();
  const k = keys(uid);
  await SecureStore.setItemAsync(k.identifier, trimmedId);
  await SecureStore.setItemAsync(k.password, trimmedPw);
  await SecureStore.setItemAsync(k.handle, data.handle || trimmedId);
  return { handle: data.handle || trimmedId };
}

export async function disconnectBluesky(): Promise<void> {
  const uid = currentUid();
  if (!uid) return;
  const k = keys(uid);
  await Promise.all([
    SecureStore.deleteItemAsync(k.identifier),
    SecureStore.deleteItemAsync(k.password),
    SecureStore.deleteItemAsync(k.handle),
  ]);
}

/** Display-only — the connected handle, or null if nothing's connected. */
export async function getBlueskyAccount(): Promise<BlueskyAccount | null> {
  const uid = currentUid();
  if (!uid) return null;
  const handle = await SecureStore.getItemAsync(keys(uid).handle);
  return handle ? { handle } : null;
}

async function session(): Promise<{ accessJwt: string; did: string } | null> {
  const uid = currentUid();
  if (!uid) return null;
  const k = keys(uid);
  const identifier = await SecureStore.getItemAsync(k.identifier);
  const password = await SecureStore.getItemAsync(k.password);
  if (!identifier || !password) return null;
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { accessJwt: data.accessJwt, did: data.did };
}

async function uploadImage(accessJwt: string, photoUri: string): Promise<any | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(photoUri, { encoding: FileSystem.EncodingType.Base64 });
    const bytes = Buffer.from(base64, 'base64');
    const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.uploadBlob`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessJwt}`, 'Content-Type': 'image/jpeg' },
      body: bytes,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.blob || null;
  } catch (e) {
    console.warn('Bluesky image upload failed (posting text-only):', e);
    return null;
  }
}

/**
 * Post to Bluesky. Best-effort like the community auto-post path — returns
 * false rather than throwing, so a failed post never blocks or crashes the
 * cleanup-save flow it's called from.
 */
export async function postToBluesky({ text, photoUri }: { text: string; photoUri?: string | null }): Promise<boolean> {
  try {
    const s = await session();
    if (!s) return false;

    let embed: any;
    if (photoUri) {
      const blob = await uploadImage(s.accessJwt, photoUri);
      if (blob) embed = { $type: 'app.bsky.embed.images', images: [{ image: blob, alt: 'A Pick cleanup photo' }] };
    }

    const record: any = {
      $type: 'app.bsky.feed.post',
      text: text.slice(0, 300),
      createdAt: new Date().toISOString(),
    };
    if (embed) record.embed = embed;

    const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.accessJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record }),
    });
    return res.ok;
  } catch (e) {
    console.warn('Bluesky post failed:', e);
    return false;
  }
}
