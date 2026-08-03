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
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';

const SERVICE = 'https://bsky.social';
const IDENTIFIER_KEY = 'pick_bluesky_identifier';
const PASSWORD_KEY = 'pick_bluesky_app_password';
const HANDLE_KEY = 'pick_bluesky_handle'; // display-only, not secret

export interface BlueskyAccount {
  handle: string;
}

/** Verify credentials work, then store them. Throws with a readable message on failure. */
export async function connectBluesky(identifier: string, appPassword: string): Promise<BlueskyAccount> {
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
  await SecureStore.setItemAsync(IDENTIFIER_KEY, trimmedId);
  await SecureStore.setItemAsync(PASSWORD_KEY, trimmedPw);
  await SecureStore.setItemAsync(HANDLE_KEY, data.handle || trimmedId);
  return { handle: data.handle || trimmedId };
}

export async function disconnectBluesky(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(IDENTIFIER_KEY),
    SecureStore.deleteItemAsync(PASSWORD_KEY),
    SecureStore.deleteItemAsync(HANDLE_KEY),
  ]);
}

/** Display-only — the connected handle, or null if nothing's connected. */
export async function getBlueskyAccount(): Promise<BlueskyAccount | null> {
  const handle = await SecureStore.getItemAsync(HANDLE_KEY);
  return handle ? { handle } : null;
}

async function session(): Promise<{ accessJwt: string; did: string } | null> {
  const identifier = await SecureStore.getItemAsync(IDENTIFIER_KEY);
  const password = await SecureStore.getItemAsync(PASSWORD_KEY);
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
