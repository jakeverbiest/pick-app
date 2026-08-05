/**
 * The shareable "group Wrapped" card for a finished challenge — sibling to
 * RecapCard, same visual language (kicker / area art / hero / tiles /
 * footer) so it reads as the same product feature, not a bolt-on. See
 * docs/CHALLENGE_RECAP_SPEC.md §5.
 *
 * Unlike a personal recap, there's no walked path to draw (compositing
 * everyone's routes would need a Cloud Function reading raw locations,
 * breaking the app's owner-only-cleanups privacy model — see the spec's
 * §4). v1 draws the challenge's own drawn area instead, or an ornamental
 * placeholder for 'anywhere'/'neighborhood' challenges with no stored
 * polygon.
 *
 * Meant to be wrapped in a `react-native-view-shot` <ViewShot> by the
 * caller (see GroupRecapModal), same as RecapCard.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { AreaPreview } from './AreaPreview';
import { C, Fonts, radius } from './theme';
import { formatBagsShort } from '../services/impactMetrics';
import type { ChallengeRecapData } from '../services/challengeRecap';
import { GOAL_LABEL, challengeSubtitle, unflattenRing, type Challenge } from '../services/challenges';

function MiniTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileNum}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

export function GroupRecapCard({ recap, challenge }: { recap: ChallengeRecapData; challenge: Challenge }) {
  const ring = unflattenRing(challenge.area.ring);
  const hasArea = challenge.area.type === 'custom' && ring.length >= 3;
  const goalValue = recap.pctOfGoal * challenge.goal_value; // same metric as goal_type

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

      <View style={styles.mapWrap}>
        {hasArea ? (
          <AreaPreview ring={ring} height={150} />
        ) : (
          <View style={styles.mapEmpty}>
            <Icon name="trophy" size={22} color={C.muted} sw={1.6} />
          </View>
        )}
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
  mapEmpty: { height: 150, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },

  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 18 },
  heroNum: { flexShrink: 1, fontFamily: Fonts.displayBold, fontSize: 42, letterSpacing: -1, color: C.dark },
  heroUnit: { fontFamily: Fonts.bodySemibold, fontSize: 14, color: C.muted, flexShrink: 1 },

  tiles: { flexDirection: 'row', gap: 8, marginTop: 16 },
  tile: { flex: 1, alignItems: 'center' },
  tileNum: { fontFamily: Fonts.displayBold, fontSize: 20, letterSpacing: -0.3, color: C.primary },
  tileLabel: { fontFamily: Fonts.bodyBold, fontSize: 10, color: C.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },

  led: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 14, textAlign: 'center' },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border2,
  },
  footerSub: { flex: 1, marginRight: 8, fontFamily: Fonts.bodySemibold, fontSize: 12, color: C.text3 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  brand: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.primary },
});
