/**
 * "Adopt a street" — a picker claims a spot they care about (their block, a
 * park path). A scheduled Cloud Function checks whether any cleanup has
 * happened near it recently; if it's gone `thresholdDays` without one, the
 * picker gets an email nudge to go tidy it. Data model only lives here + in the
 * `adoptions` Firestore collection; the notifying is entirely server-side.
 */
import { getFirestore, collection, addDoc, query, where, getDocs, deleteDoc, doc, orderBy } from 'firebase/firestore';
import * as Location from 'expo-location';
import { app } from './firebaseConfig';
import { getAuthService } from './authService';

const db = getFirestore(app);

export interface Adoption {
  id: string;
  label: string;
  lat: number;
  lon: number;
  radiusM: number;
  thresholdDays: number;
  createdAt: number;
  coords?: [number, number][]; // the block's line, when adopted by tapping the map
  segmentId?: string;
}

/** Firestore doc → Adoption, rebuilding `coords` from the flat `path` field. */
function fromDoc(id: string, data: any): Adoption {
  const { path, ...rest } = data || {};
  const coords = unflattenPath(path);
  return { id, ...(rest as any), ...(coords ? { coords } : {}) };
}

const DEFAULT_RADIUS_M = 150; // "this street" ≈ a block or two
export const DEFAULT_THRESHOLD_DAYS = 7;

/**
 * Firestore rejects nested arrays, so a block's polyline can't be stored as
 * `[[lat, lon], ...]`. We flatten it to `[lat, lon, lat, lon, ...]` on write
 * (field `path`) and rebuild the pairs on read. Docs written before this fix
 * never made it to the server, so there's no legacy shape to migrate.
 */
function flattenCoords(coords: [number, number][]): number[] {
  const flat: number[] = [];
  for (const c of coords) {
    if (!c || !isFinite(c[0]) || !isFinite(c[1])) continue;
    flat.push(c[0], c[1]);
  }
  return flat;
}

function unflattenPath(path: unknown): [number, number][] | undefined {
  if (!Array.isArray(path) || path.length < 4) return undefined;
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < path.length; i += 2) {
    const lat = Number(path[i]);
    const lon = Number(path[i + 1]);
    if (isFinite(lat) && isFinite(lon)) out.push([lat, lon]);
  }
  return out.length ? out : undefined;
}

/** Adopt the street you're standing on right now. */
export async function adoptCurrentStreet(thresholdDays: number = DEFAULT_THRESHOLD_DAYS): Promise<Adoption> {
  const user = getAuthService().getCurrentUser();
  if (!user) throw new Error('Sign in to adopt a street.');

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Location access is needed to adopt the street you’re on.');

  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;

  let label = 'My street';
  try {
    const g = (await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon }))[0];
    if (g) {
      const parts = [g.street || g.name, g.city].filter(Boolean);
      if (parts.length) label = parts.join(', ');
    }
  } catch {}

  const now = Date.now();
  const data = {
    userId: user.uid,
    email: user.email || '',
    label,
    lat,
    lon,
    radiusM: DEFAULT_RADIUS_M,
    thresholdDays,
    lastNotified: 0,
    createdAt: now,
  };
  const ref = await addDoc(collection(db, 'adoptions'), data);
  return { id: ref.id, label, lat, lon, radiusM: DEFAULT_RADIUS_M, thresholdDays, createdAt: now };
}

/** Save a block adopted by long-pressing it on the map (already snapped to a
 *  street segment; `label` from a reverse-geocode of its midpoint). */
export async function saveAdoptedBlock(
  seg: { id: string; coords: [number, number][] },
  label: string,
  thresholdDays: number = DEFAULT_THRESHOLD_DAYS
): Promise<Adoption> {
  const user = getAuthService().getCurrentUser();
  if (!user) throw new Error('Sign in to adopt a block.');
  const mid = seg.coords[Math.floor(seg.coords.length / 2)] || [0, 0];
  const now = Date.now();
  const data = {
    userId: user.uid,
    email: user.email || '',
    label: label || 'This block',
    lat: mid[0],
    lon: mid[1],
    // Flat [lat, lon, lat, lon, …] — Firestore has no nested-array type.
    path: flattenCoords(seg.coords),
    segmentId: seg.id || '',
    radiusM: 25,
    thresholdDays,
    lastNotified: 0,
    createdAt: now,
  };
  const ref = await addDoc(collection(db, 'adoptions'), data);
  return {
    id: ref.id,
    label: data.label,
    lat: mid[0],
    lon: mid[1],
    coords: seg.coords,
    segmentId: data.segmentId,
    radiusM: 25,
    thresholdDays,
    createdAt: now,
  };
}

export async function listMyAdoptions(): Promise<Adoption[]> {
  const user = getAuthService().getCurrentUser();
  if (!user) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'adoptions'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map((d) => fromDoc(d.id, d.data()));
  } catch {
    // orderBy may need an index the first time — fall back to unordered.
    const user2 = getAuthService().getCurrentUser();
    if (!user2) return [];
    const snap = await getDocs(query(collection(db, 'adoptions'), where('userId', '==', user2.uid)));
    return snap.docs
      .map((d) => fromDoc(d.id, d.data()))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
}

export async function removeAdoption(id: string): Promise<void> {
  await deleteDoc(doc(db, 'adoptions', id));
}
