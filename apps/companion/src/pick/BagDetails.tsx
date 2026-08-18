/**
 * BagDetails — the one place a user corrects what a walk actually was.
 *
 * Used by two screens that must never disagree:
 *   • the end-of-walk summary sheet (map.tsx), behind "Adjust details"
 *   • the edit sheet for a past walk (activity.tsx)
 *
 * Before this existed, the past-walk editor asked people to type a DECIMAL
 * NUMBER OF 13-GALLON BAGS ("e.g. 0.5 or 2") — the app handing its own volume
 * math to the user. Same four values, two unrelated interfaces. Hence one
 * component, fully controlled, with the parent owning state and persistence.
 *
 * Note on bag size: it is a first-class control here, always visible, never
 * behind a disclosure. The quick chips on the summary sheet used to hardcode
 * `kitchen`, so anyone filling a 30-gallon yard bag was credited one kitchen
 * bag — a 2.3x under-credit that fell hardest on the people doing the most
 * work. Size is chosen once and everything else is expressed relative to it.
 */
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useState } from 'react';

import { C, Fonts } from './theme';
import { BAG_SIZE_OPTIONS, formatKitchenBags, reportedBags } from '../services/impactMetrics';

export const FULLNESS_OPTIONS = [25, 50, 75, 100];

export interface BagDetailsValue {
  /** Pieces the user says they picked up. */
  count: number;
  /** A key from BAG_SIZE_FACTORS — named sizes for new reports. */
  size: string;
  /** How many bags of that size. */
  qty: number;
  /** How full, 0–100, applied to the whole report. */
  fullness: number;
}

interface Props {
  value: BagDetailsValue;
  onChange: (next: BagDetailsValue) => void;
  /**
   * What the motion detector counted, if this walk was detected. Shown as a
   * reference point so a correction feels like a correction rather than a
   * blank form. Omit on screens where there is nothing to compare against.
   */
  detectedCount?: number | null;
  /** Hide the piece-count field (e.g. a flow where count isn't editable). */
  showCount?: boolean;
  /**
   * Hide the bag-size row. The summary sheet shows size as a top-level
   * question above its quick chips, so repeating it inside the panel would be
   * the same control twice on one screen.
   */
  showSize?: boolean;
}

export function BagDetails({ value, onChange, detectedCount = null, showCount = true, showSize = true }: Props) {
  // Raw text while the field is focused. Parsing on every keystroke meant
  // backspacing to empty gave NaN, which the old code mapped to 0 — the field
  // snapped to "0" mid-edit and could not be cleared.
  const [countDraft, setCountDraft] = useState<string | null>(null);

  const set = (patch: Partial<BagDetailsValue>) => onChange({ ...value, ...patch });

  const clampCount = (digits: string) => Math.min(parseInt(digits, 10), 100000);

  return (
    <View style={styles.panel}>
      {showCount ? (
        <>
          <Text style={styles.label}>Pieces picked up</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={countDraft ?? String(value.count)}
            onFocus={() => setCountDraft(String(value.count))}
            onChangeText={(t) => {
              const digits = t.replace(/[^0-9]/g, '').slice(0, 6);
              setCountDraft(digits);
              if (digits.length) set({ count: clampCount(digits) });
            }}
            onBlur={() => {
              // Left blank? Keep what was there rather than silently zeroing a
              // walk. Typing an explicit 0 still works.
              const digits = (countDraft ?? '').replace(/[^0-9]/g, '');
              if (digits.length) set({ count: clampCount(digits) });
              setCountDraft(null);
            }}
            selectTextOnFocus
            returnKeyType="done"
          />
          {detectedCount !== null ? (
            <Text style={styles.hint}>
              {value.count !== detectedCount
                ? `We counted ${detectedCount}. Yours is what gets saved.`
                : `We counted ${detectedCount}. Change it if that’s off.`}
            </Text>
          ) : null}
        </>
      ) : null}

      {showSize ? (
        <>
      <Text style={styles.label}>Bag size</Text>
      <View style={styles.grid}>
        {BAG_SIZE_OPTIONS.map((o) => {
          const on = value.size === o.key;
          return (
            <TouchableOpacity
              key={o.key}
              style={[styles.chip, on && styles.chipActive]}
              onPress={() => set({ size: o.key })}
            >
              <Text style={[styles.chipText, on && styles.chipTextActive]}>{o.label}</Text>
              <Text style={[styles.chipHint, on && styles.chipTextActive]}>{o.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
        </>
      ) : null}

      <Text style={styles.label}>How many bags</Text>
      <View style={styles.stepperRow}>
        <TouchableOpacity style={styles.stepperBtn} onPress={() => set({ qty: Math.max(1, value.qty - 1) })}>
          <Text style={styles.stepperBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{value.qty}</Text>
        <TouchableOpacity style={styles.stepperBtn} onPress={() => set({ qty: Math.min(99, value.qty + 1) })}>
          <Text style={styles.stepperBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>How full</Text>
      <View style={styles.grid}>
        {FULLNESS_OPTIONS.map((f) => {
          const on = value.fullness === f;
          return (
            <TouchableOpacity
              key={f}
              style={[styles.chip, styles.fullnessChip, on && styles.chipActive]}
              onPress={() => set({ fullness: f })}
            >
              <Text style={[styles.chipText, on && styles.chipTextActive]}>{f}%</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hint}>
        That’s {formatKitchenBags(reportedBags(value.size, value.fullness, value.qty))}.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 16,
    marginBottom: 18,
    gap: 4,
  },
  label: {
    fontSize: 14,
    fontFamily: Fonts.bodyBold,
    color: C.dark,
    marginTop: 12,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    fontFamily: Fonts.bodyBold,
    color: C.dark,
  },
  hint: { fontSize: 12.5, color: C.muted, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    width: '47.8%',
    flexGrow: 1,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  // Civic Blueprint: navy is the active/selected state everywhere else in the
  // app (settings pills, adopt button, leaderboard). Green is reserved for
  // progress and success, not selection.
  chipActive: { borderColor: C.primary, backgroundColor: C.tint },
  chipText: { fontSize: 15, fontFamily: Fonts.bodyBold, color: C.dark },
  chipTextActive: { color: C.primary },
  chipHint: { fontSize: 11.5, color: C.muted, marginTop: 2 },
  fullnessChip: { width: '22%', paddingVertical: 12 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  stepperBtn: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: { fontSize: 22, fontFamily: Fonts.bodyBold, color: C.primary },
  stepperValue: { fontSize: 20, fontFamily: Fonts.bodyBold, color: C.dark, minWidth: 32, textAlign: 'center' },
});
