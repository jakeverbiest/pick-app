/**
 * The shareable "group Wrapped" card for a finished challenge — sibling to
 * RecapCard, same visual language (kicker / area art / hero / tiles /
 * footer) so it reads as the same product feature, not a bolt-on. See
 * docs/CHALLENGE_RECAP_SPEC.md §5, and §11 for the v2 redesign this file
 * implements: the map as the card's visual centerpiece, a real boundary for
 * `neighborhood` challenges (not just `custom`), and a Tier 1 photo strip
 * pulled from Community posts already tagged to this challenge.
 *
 * Unlike a personal recap, there's no walked path to draw (compositing
 * everyone's routes would need a Cloud Function reading raw locations,
 * breaking the app's owner-only-cleanups privacy model — see the spec's
 * §4/§8, reaffirmed for photos in §11.4 which stays unbuilt). What CAN be
 * drawn:
 *  - `area.type === 'custom'` — the challenge's own drawn ring (AreaPreview).
 *  - `area.type === 'neighborhood'` — the real OSM boundary for the stored
 *    label, fetched/cached by the caller via
 *    `services/neighborhoods.ts#challengeNeighborhoodBoundary` (§11.2/§11.5
 *    phase 3) and handed in as `neighborhoodRing`. Still an ornamental
 *    placeholder when OSM has no shape for the name.
 *  - `area.type === 'anywhere'` — no shape to draw, ever (§11.2) — a
 *    full-bleed decorative placeholder sized like the real-map cases so the
 *    card family reads as one design.
 *
 * This component stays pure/presentational, same as RecapCard: the caller
 * (GroupRecapModal) is responsible for fetching `neighborhoodRing` and
 * `posts` before rendering — no Firestore/OSM calls happen in here, and
 * nothing here is async, so a `<ViewShot>` around this card captures a
 * stable, already-loaded card.
 */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { AreaPreview } from './AreaPreview';
import { C, Fonts, radius } from './theme';
import { formatBagsShort } from '../services/impactMetrics';
import type { ChallengeRecapData } from '../services/challengeRecap';
import { GOAL_LABEL, challengeSubtitle, unflattenRing, type Challenge } from '../services/challenges';
import type { Post } from '../services/firebaseDatabase';

const MAP_HEIGHT = 220;
// Card is capped to 6 thumbnails: a 3-per-row grid at this card width stays
// legible in a share image, and 12-20 posts (getPostsForChallenge's own cap)
// would otherwise make the strip taller than the map it's meant to support.
const PHOTO_LIMIT = 6;

function MiniTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileNum}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

/** Full-bleed decorative placeholder for the cases with no real shape to draw
 *  ('anywhere' always; 'neighborhood' when OSM has nothing for the label) —
 *  sized and positioned like the real-map cases (§11.2) rather than the old
 *  flat-tint trophy icon, so the card family still reads as one design. */
function MapPlaceholder() {
  return (
    <View style={styles.mapEmpty}>
      <View style={styles.mapEmptyPattern}>
        {Array.from({ length: 12 }).map((_, i) => (
          <Icon key={i} name="leaf" size={22} color="rgba(15,47,102,0.10)" sw={1.6} />
        ))}
      </View>
      <View style={styles.mapEmptyBadge}>
        <Icon name="trophy" size={22} color={C.primary} sw={1.6} />
      </View>
    </View>
  );
}

export function GroupRecapCard({
  recap,
  challenge,
  neighborhoodRing,
  posts,
}: {
  recap: ChallengeRecapData;
  challenge: Challenge;
  /** Real OSM boundary for a `neighborhood`-type challenge, fetched by the
   *  caller (see file doc comment). `undefined` while still loading/not
   *  fetched, `null` once resolved with no shape found — both render the
   *  placeholder; only a real ring switches to AreaPreview. Ignored for
   *  'custom' and 'anywhere' challenges. */
  neighborhoodRing?: [number, number][] | null;
  /** Posts tagged to this challenge via `challengeId` on `createPost`
   *  (§11.3) — already-public Community photos, newest first. Omit or pass
   *  [] for the empty state (expected for most challenges at launch, since
   *  nothing could be tagged retroactively). */
  posts?: Post[];
}) {
  const customRing = unflattenRing(challenge.area.ring);
  const hasCustomArea = challenge.area.type === 'custom' && customRing.length >= 3;
  const hasNeighborhoodArea = challenge.area.type === 'neighborhood' && !!neighborhoodRing && neighborhoodRing.length >= 3;
  const mapRing = hasCustomArea ? customRing : hasNeighborhoodArea ? neighborhoodRing! : null;
  const goalValue = recap.pctOfGoal * challenge.goal_value; // same metric as goal_type

  const photos = (posts || []).filter((p) => !!p.image_url).slice(0, PHOTO_LIMIT);
  const extraPhotoCount = Math.max(0, (posts || []).filter((p) => !!p.image_url).length - photos.length);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.kicker} numberOfLines={1}>{challenge.name.toUpperCase()}</Text>
        {recap.goalReached && (
          <View style={styles.goalBadge}>
            <Icon name="check" size={11} color="#fff" sw={2.4} />
            <Text style={styles.goalBadgeText}>GOAL REACHED</Text>
          </View>
        )}
      </View>

      {/* Map — the card's visual centerpiece (§11.2): full card width, most
          of the card's vertical space, stats living below it rather than
          overlaid on top (legibility over cleverness, per Jake's reviewed
          direction). */}
      <View style={styles.mapWrap}>
        {mapRing ? <AreaPreview ring={mapRing} height={MAP_HEIGHT} /> : <MapPlaceholder />}
      </View>

      <View style={styles.heroRow}>
        <Text style={styles.heroNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {Math.round(goalValue).toLocaleString()}
        </Text>
        <Text style={styles.heroUnit}>{GOAL_LABEL[challenge.goal_type]}, together</Text>
      </View>

      <View style={styles.tiles}>
        <MiniTile value={formatBagsShort(recap.totalBags)} label="BAGS" />
        <MiniTile value={String(recap.totalCleanups)} label="CLEANUPS" />
        <MiniTile value={String(recap.participantCount)} label="PICKERS" />
      </View>

      {/* Photo strip (§11.3, Tier 1) — thumbnails from Community posts people
          already chose to share and tagged to this challenge. Needs a real
          empty state: most challenges have zero tagged photos today (no
          backfill, community_auto_post defaults off), so this must look
          intentional at zero, not like a broken slot. */}
      <View style={styles.photoSection}>
        <Text style={styles.photoLabel}>FROM THE CHALLENGE</Text>
        {photos.length > 0 ? (
          <View style={styles.photoGrid}>
            {photos.map((p) => (
              <Image key={p.id} source={{ uri: p.image_url }} style={styles.photoThumb} resizeMode="cover" />
            ))}
            {extraPhotoCount > 0 && (
              <View style={[styles.photoThumb, styles.photoMore]}>
                <Text style={styles.photoMoreText}>+{extraPhotoCount}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.photoEmpty}>
            <Icon name="camera" size={16} color={C.muted} sw={1.6} />
            <Text style={styles.photoEmptyText}>No photos shared yet</Text>
          </View>
        )}
      </View>

      {!!recap.topContributorName && (
        <Text style={styles.led} numberOfLines={1}>Led by {recap.topContributorName}</Text>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerSub} numberOfLines={1}>{challengeSubtitle(challenge)}</Text>
        <View style={styles.brandRow}>
          <Icon name="leaf" size={14} color={C.primary} sw={1.8} />
          <Text style={styles.brand}>Pick</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Crisp navy border, not a shadow — "cards are defined by a drafted line,
  // not a soft shadow" is the Civic Blueprint aesthetic (see src/pick/ui.tsx's
  // Card), and every other card in the app already uses it.
  card: { width: 340, borderRadius: radius.cardLg, padding: 22, backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.border },

  head: { marginBottom: 14, gap: 8 },
  kicker: { fontFamily: Fonts.bodyBold, fontSize: 11, letterSpacing: 0.6, color: C.muted, textTransform: 'uppercase' },
  goalBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.accent, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10,
  },
  goalBadgeText: { fontFamily: Fonts.bodyBold, fontSize: 10.5, color: '#fff', letterSpacing: 0.3 },

  mapWrap: { borderRadius: radius.card, overflow: 'hidden' },
  mapEmpty: {
    height: MAP_HEIGHT, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  mapEmptyPattern: {
    ...StyleSheet.absoluteFillObject, flexDirection: 'row', flexWrap: 'wrap',
    alignItems: 'center', justifyContent: 'space-evenly', padding: 12, opacity: 0.9,
  },
  mapEmptyBadge: {
    width: 52, height: 52, borderRadius: radius.pill, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.border,
  },

  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 18 },
  heroNum: { flexShrink: 1, fontFamily: Fonts.displayBold, fontSize: 42, letterSpacing: -1, color: C.dark },
  heroUnit: { fontFamily: Fonts.bodySemibold, fontSize: 14, color: C.muted, flexShrink: 1 },

  tiles: { flexDirection: 'row', gap: 8, marginTop: 16 },
  tile: { flex: 1, alignItems: 'center' },
  tileNum: { fontFamily: Fonts.displayBold, fontSize: 20, letterSpacing: -0.3, color: C.primary },
  tileLabel: { fontFamily: Fonts.bodyBold, fontSize: 10, color: C.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },

  photoSection: { marginTop: 18 },
  photoLabel: { fontFamily: Fonts.bodyBold, fontSize: 10, color: C.muted, letterSpacing: 0.3, marginBottom: 8 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoThumb: { width: 92, height: 92, borderRadius: radius.chip, backgroundColor: C.tint },
  photoMore: { alignItems: 'center', justifyContent: 'center' },
  photoMoreText: { fontFamily: Fonts.displayBold, fontSize: 16, color: C.primary },
  photoEmpty: {
    height: 52, borderRadius: radius.chip, backgroundColor: C.tint,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  photoEmptyText: { fontFamily: Fonts.bodySemibold, fontSize: 12, color: C.muted },

  led: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 14, textAlign: 'center' },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border2,
  },
  footerSub: { flex: 1, marginRight: 8, fontFamily: Fonts.bodySemibold, fontSize: 12, color: C.text3 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  brand: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.primary },
});
