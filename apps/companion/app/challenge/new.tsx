/**
 * Create a challenge — pick the limitation, then the collective goal.
 *
 * Three choices, in the order they matter:
 *   WHERE  anywhere · the neighborhood you're standing in · a boundary you draw
 *   WHEN   one day · a range of days
 *   WHAT   how many pickups / bags / cleanups, together
 *
 * Drawing happens in a small Leaflet WebView: tap to drop a vertex, and the
 * ring closes itself. The result is handed back as [lat, lon] pairs and stored
 * flat (Firestore has no nested-array type — see challenges.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { BASEMAP_URL } from '../../src/pick/basemap';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { Icon } from '../../src/pick/Icon';
import { AreaPreview } from '../../src/pick/AreaPreview';
import { C, Fonts, radius } from '../../src/pick/theme';
import { osmNeighborhood } from '../../src/services/neighborhoods';
import {
  createChallenge,
  validateChallenge,
  type ChallengeAreaType,
  type ChallengeGoalType,
  type NewChallengeInput,
} from '../../src/services/challenges';

const GOALS: { key: ChallengeGoalType; label: string; hint: string }[] = [
  { key: 'pickups', label: 'Pickups', hint: 'Pieces of litter, counted automatically' },
  { key: 'bags', label: 'Bags', hint: 'Standard 13-gallon bags filled' },
  { key: 'cleanups', label: 'Cleanups', hint: 'Number of walks logged' },
];

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Local midnight for a date — challenge days are whole calendar days. */
function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "today" / "tomorrow" / "Sat, Aug 8" — the shortest label that's still clear. */
function dayLabel(d: Date): string {
  const today = startOfDay(new Date());
  if (sameDay(d, today)) return 'today';
  if (sameDay(d, addDays(today, 1))) return 'tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function NewChallengeScreen() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [areaType, setAreaType] = useState<ChallengeAreaType>('neighborhood');
  const [hood, setHood] = useState('');
  const [hoodLoading, setHoodLoading] = useState(true);
  const [ring, setRing] = useState<[number, number][]>([]);
  const [drawing, setDrawing] = useState(false);
  const [kind, setKind] = useState<'day' | 'range'>('range');
  const [days, setDays] = useState(7); // range length
  // Which day the challenge begins. Defaults to today, so the old "runs today"
  // behavior is what you get if you never touch the picker.
  const [startDate, setStartDate] = useState<Date>(() => startOfDay(new Date()));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [goalType, setGoalType] = useState<ChallengeGoalType>('pickups');
  const [goalValue, setGoalValue] = useState('500');
  const [saving, setSaving] = useState(false);
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);

  // Where are we? Used both to name the neighborhood option and to centre the
  // drawing map. Failing to get a fix just means the neighborhood option is
  // unavailable — the other two still work.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        const pos =
          status === 'granted'
            ? await Location.getLastKnownPositionAsync()
            : null;
        if (pos) {
          setCenter({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          const n = await osmNeighborhood(pos.coords.latitude, pos.coords.longitude);
          if (n) setHood(n);
        }
      } catch {}
      setHoodLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!hoodLoading && !hood && areaType === 'neighborhood') setAreaType('anywhere');
  }, [hoodLoading, hood, areaType]);

  const start = startDate;
  const end = kind === 'day' ? start : addDays(start, days - 1);
  // You can schedule ahead but not behind; a year out matches the validator.
  const minDate = startOfDay(new Date());
  const maxDate = addDays(minDate, 365);

  const onPickDate = (event: DateTimePickerEvent, picked?: Date) => {
    // Android fires this for the dialog's Cancel too — only 'set' is a choice.
    if (Platform.OS === 'android') setPickerOpen(false);
    if (event.type === 'dismissed' || !picked) return;
    setStartDate(startOfDay(picked));
  };

  const buildInput = (): NewChallengeInput => ({
    name,
    description,
    startDate: start,
    endDate: end,
    kind,
    area:
      areaType === 'anywhere'
        ? { type: 'anywhere', label: 'Anywhere' }
        : areaType === 'neighborhood'
        ? { type: 'neighborhood', label: hood }
        : { type: 'custom', label: hood || 'Custom area', ring },
    goal_type: goalType,
    goal_value: Number(goalValue) || 0,
    visibility: 'public',
  });

  const problem = validateChallenge(buildInput());

  const save = async () => {
    const input = buildInput();
    const err = validateChallenge(input);
    if (err) {
      Alert.alert('Almost there', err);
      return;
    }
    setSaving(true);
    try {
      const id = await createChallenge(input);
      router.replace(`/challenge/${id}` as any);
    } catch (e: any) {
      Alert.alert('Could not create', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 22 }}>
          <Icon name="close" size={21} color={C.dark} sw={2} />
        </Pressable>
        <Text style={styles.h1}>New challenge</Text>
        <View style={{ width: 22 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* ---- name ---- */}
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Saturday Smith Street sweep"
            placeholderTextColor={C.muted}
            value={name}
            onChangeText={setName}
            maxLength={60}
          />

          <Text style={styles.label}>What's the plan? (optional)</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            placeholder="Meet at the F train at 10, bags provided."
            placeholderTextColor={C.muted}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={280}
          />

          {/* ---- where ---- */}
          <Text style={styles.section}>Where does it count?</Text>
          <Text style={styles.sectionSub}>
            This is the limitation everyone opts into — only cleanups inside it add to the group total.
          </Text>
          <Choice
            on={areaType === 'neighborhood'}
            disabled={!hood}
            title={hood ? hood : hoodLoading ? 'Finding your neighborhood…' : 'Neighborhood unavailable'}
            sub={hood ? 'Cleanups tagged to this neighborhood count' : 'Turn on location to use this'}
            icon="pin"
            onPress={() => setAreaType('neighborhood')}
          />
          <Choice
            on={areaType === 'custom'}
            title={ring.length >= 3 ? `Custom boundary · ${ring.length} points` : 'Draw a boundary'}
            sub="Tap a map to trace exactly the area you mean"
            icon="route"
            onPress={() => {
              setAreaType('custom');
              setDrawing(true);
            }}
          />
          <Choice
            on={areaType === 'anywhere'}
            title="Anywhere"
            sub="Every cleanup counts, wherever it happens"
            icon="target"
            onPress={() => setAreaType('anywhere')}
          />
          {areaType === 'custom' && ring.length >= 3 && (
            <View style={{ marginTop: 12 }}>
              <AreaPreview ring={ring} height={140} />
              <Pressable style={styles.redraw} onPress={() => setDrawing(true)}>
                <Text style={styles.redrawText}>Redraw boundary</Text>
              </Pressable>
            </View>
          )}

          {/* ---- when ---- */}
          <Text style={styles.section}>When?</Text>
          <View style={styles.segment}>
            {(['day', 'range'] as const).map((k) => (
              <Pressable
                key={k}
                style={[styles.segBtn, kind === k && styles.segBtnActive]}
                onPress={() => setKind(k)}
              >
                <Text style={[styles.segText, kind === k && styles.segTextActive]}>
                  {k === 'day' ? 'Single day' : 'A stretch of days'}
                </Text>
              </Pressable>
            ))}
          </View>
          {kind === 'range' && (
            <View style={styles.pillRow}>
              {[3, 7, 14, 30].map((d) => (
                <Pressable key={d} style={[styles.pill, days === d && styles.pillOn]} onPress={() => setDays(d)}>
                  <Text style={[styles.pillText, days === d && styles.pillTextOn]}>{d} days</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Start day. Defaults to today; tap to schedule it ahead — a Saturday
              sweep can now be created on Wednesday. */}
          <Pressable style={styles.dateRow} onPress={() => setPickerOpen(true)}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.dateLabel}>Starts</Text>
              <Text style={styles.dateValue}>
                {start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </Text>
            </View>
            <Icon name="clock" size={16} color={C.primary} />
          </Pressable>

          <Text style={styles.hint}>
            {kind === 'day'
              ? `Runs ${dayLabel(start)} only, until midnight.`
              : `${dayLabel(start) === 'today' ? 'Today' : dayLabel(start)} through ${end.toLocaleDateString(
                  'en-US',
                  { weekday: 'long', month: 'short', day: 'numeric' },
                )}.`}
          </Text>

          {/* iOS shows the calendar inline in a sheet; Android opens its own
              dialog, so it's rendered bare and dismissed in onPickDate. */}
          {pickerOpen && Platform.OS !== 'ios' && (
            <DateTimePicker
              value={start}
              mode="date"
              display="default"
              minimumDate={minDate}
              maximumDate={maxDate}
              onChange={onPickDate}
            />
          )}
          {Platform.OS === 'ios' && (
            <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
              <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
                <Pressable style={styles.pickerCard} onPress={(e) => e.stopPropagation()}>
                  <Text style={styles.pickerTitle}>Start day</Text>
                  <DateTimePicker
                    value={start}
                    mode="date"
                    display="inline"
                    minimumDate={minDate}
                    maximumDate={maxDate}
                    onChange={onPickDate}
                    accentColor={C.primary}
                  />
                  <Pressable style={styles.pickerDone} onPress={() => setPickerOpen(false)}>
                    <Text style={styles.pickerDoneText}>Done</Text>
                  </Pressable>
                </Pressable>
              </Pressable>
            </Modal>
          )}

          {/* ---- what ---- */}
          <Text style={styles.section}>The collective goal</Text>
          <View style={styles.pillRow}>
            {GOALS.map((g) => (
              <Pressable
                key={g.key}
                style={[styles.pill, goalType === g.key && styles.pillOn]}
                onPress={() => setGoalType(g.key)}
              >
                <Text style={[styles.pillText, goalType === g.key && styles.pillTextOn]}>{g.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>{GOALS.find((g) => g.key === goalType)?.hint}</Text>
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            placeholder="500"
            placeholderTextColor={C.muted}
            keyboardType="number-pad"
            value={goalValue}
            onChangeText={setGoalValue}
          />
          <Text style={styles.hint}>
            Everyone who joins works toward this one number together.
          </Text>

          {!!problem && <Text style={styles.problem}>{problem}</Text>}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[styles.primaryBtn, (!!problem || saving) && { opacity: 0.5 }]}
            onPress={save}
            disabled={!!problem || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={C.creamText} />
            ) : (
              <Text style={styles.primaryBtnText}>Create challenge</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <BoundaryDrawer
        visible={drawing}
        center={center}
        initial={ring}
        onCancel={() => {
          setDrawing(false);
          if (ring.length < 3) setAreaType(hood ? 'neighborhood' : 'anywhere');
        }}
        onDone={(pts) => {
          setRing(pts);
          setDrawing(false);
        }}
      />
    </SafeAreaView>
  );
}

function Choice({
  on, title, sub, icon, onPress, disabled,
}: {
  on: boolean; title: string; sub: string; icon: any; onPress: () => void; disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.choice, on && styles.choiceOn, disabled && { opacity: 0.5 }]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
    >
      <View style={[styles.choiceWell, on && { backgroundColor: C.primary }]}>
        <Icon name={icon} size={18} color={on ? C.creamText : C.primary} sw={1.8} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.choiceTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.choiceSub} numberOfLines={2}>{sub}</Text>
      </View>
      {on && <Icon name="check" size={17} color={C.primary} sw={2.4} />}
    </Pressable>
  );
}

// -------------------------------------------------------- boundary drawer

/**
 * Tap-to-trace boundary picker. Leaflet in a WebView because that's what the
 * map tab already uses (same tiles, same offline behaviour); the RN side only
 * ever receives the finished list of points.
 */
function BoundaryDrawer({
  visible, center, initial, onCancel, onDone,
}: {
  visible: boolean;
  center: { lat: number; lon: number } | null;
  initial: [number, number][];
  onCancel: () => void;
  onDone: (pts: [number, number][]) => void;
}) {
  const webref = useRef<WebView>(null);
  const [count, setCount] = useState(initial.length);
  const [pts, setPts] = useState<[number, number][]>(initial);

  useEffect(() => {
    if (visible) {
      setPts(initial);
      setCount(initial.length);
    }
    // Only reset when the sheet opens; edits during the session are local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const lat = center?.lat ?? 40.6795;
  const lon = center?.lon ?? -73.9958;

  const html = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#FFFFFF; }
  .leaflet-control-attribution { font-size: 9px; }
</style></head><body><div id="map"></div><script>
  var map = L.map('map', { zoomControl: false }).setView([${lat}, ${lon}], 15);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('${BASEMAP_URL}', {
    attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 19
  }).addTo(map);

  var pts = ${JSON.stringify(initial)};
  var poly = L.polygon([], { color: '#0F2F66', weight: 3, fillColor: '#4B7A54', fillOpacity: 0.18 }).addTo(map);
  var dots = L.featureGroup([]).addTo(map);

  function post() {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ pts: pts }));
    }
  }
  function redraw() {
    poly.setLatLngs(pts);
    dots.clearLayers();
    pts.forEach(function (p, i) {
      L.circleMarker(p, {
        radius: 6, color: '#fff', weight: 2,
        fillColor: i === 0 ? '#0F2F66' : '#4B7A54', fillOpacity: 1
      }).addTo(dots);
    });
    post();
  }
  map.on('click', function (e) {
    pts.push([e.latlng.lat, e.latlng.lng]);
    redraw();
  });
  window.undo = function () { pts.pop(); redraw(); };
  window.clearAll = function () { pts = []; redraw(); };
  if (pts.length) { redraw(); try { map.fitBounds(poly.getBounds().pad(0.2)); } catch (e) {} }
</script></body></html>`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.drawRoot} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={onCancel} hitSlop={10} style={{ width: 22 }}>
            <Icon name="close" size={21} color={C.dark} sw={2} />
          </Pressable>
          <Text style={styles.h1}>Draw the area</Text>
          <View style={{ width: 22 }} />
        </View>
        <Text style={styles.drawHint}>
          Tap the map to drop corners. Three or more closes the shape.
        </Text>
        <View style={{ flex: 1, overflow: 'hidden' }}>
          <WebView
            ref={webref}
            source={{ html }}
            originWhitelist={['*']}
            onMessage={(e) => {
              try {
                const data = JSON.parse(e.nativeEvent.data);
                if (Array.isArray(data.pts)) {
                  setPts(data.pts as [number, number][]);
                  setCount(data.pts.length);
                }
              } catch {}
            }}
          />
        </View>
        <View style={styles.drawBar}>
          <Pressable
            style={styles.drawBtn}
            onPress={() => webref.current?.injectJavaScript('window.undo(); true;')}
          >
            <Text style={styles.drawBtnText}>Undo</Text>
          </Pressable>
          <Pressable
            style={styles.drawBtn}
            onPress={() => webref.current?.injectJavaScript('window.clearAll(); true;')}
          >
            <Text style={styles.drawBtnText}>Clear</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, { flex: 1 }, count < 3 && { opacity: 0.5 }]}
            disabled={count < 3}
            onPress={() => onDone(pts)}
          >
            <Text style={styles.primaryBtnText}>
              {count < 3 ? `${3 - count} more point${3 - count === 1 ? '' : 's'}` : 'Use this area'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white },
  drawRoot: { flex: 1, backgroundColor: C.white },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  h1: { flex: 1, fontFamily: Fonts.headlineBold, fontSize: 18, color: C.dark, textAlign: 'center' },
  scroll: { paddingHorizontal: 16, paddingBottom: 30 },

  label: { fontFamily: Fonts.bodyBold, fontSize: 12, color: C.muted, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 18, marginBottom: 7 },
  input: {
    backgroundColor: '#fff', borderRadius: radius.field, borderWidth: 1, borderColor: C.border3,
    paddingVertical: 13, paddingHorizontal: 14, fontFamily: Fonts.body, fontSize: 16, color: C.dark,
  },
  inputMulti: { minHeight: 78, textAlignVertical: 'top' },

  section: { fontFamily: Fonts.headlineBold, fontSize: 17, color: C.dark, marginTop: 26 },
  sectionSub: { fontFamily: Fonts.body, fontSize: 13, color: C.text3, marginTop: 4, marginBottom: 12, lineHeight: 18 },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 17 },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: C.white,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  dateLabel: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginBottom: 2 },
  dateValue: { fontFamily: Fonts.bodySemibold, fontSize: 15, color: C.dark },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,47,102,0.35)',
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: C.white,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: 16,
    paddingBottom: 28,
  },
  pickerTitle: { fontFamily: Fonts.headlineBold, fontSize: 16, color: C.dark, marginBottom: 4 },
  pickerDone: {
    marginTop: 8,
    paddingVertical: 13,
    borderRadius: radius.button,
    backgroundColor: C.primary,
    alignItems: 'center',
  },
  pickerDoneText: { fontFamily: Fonts.bodyBold, color: C.creamText, fontSize: 15 },
  problem: { fontFamily: Fonts.body, fontSize: 13, color: C.warning, marginTop: 18, lineHeight: 18 },

  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: radius.card,
    padding: 14, marginTop: 10,
    borderWidth: 1.5, borderColor: C.border,
  },
  choiceOn: { borderColor: C.primary },
  choiceWell: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  choiceTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: C.dark },
  choiceSub: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 16 },

  redraw: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: C.tint },
  redrawText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.primary },

  segment: { flexDirection: 'row', gap: 6, backgroundColor: C.tint, borderRadius: 12, padding: 4, marginTop: 12 },
  segBtn: { flex: 1, borderRadius: 9, paddingVertical: 10, alignItems: 'center' },
  segBtnActive: { backgroundColor: '#fff' },
  segText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.muted },
  segTextActive: { color: C.primary },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  pill: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border3 },
  pillOn: { backgroundColor: C.primary, borderColor: C.primary },
  pillText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.text2 },
  pillTextOn: { color: C.creamText },

  footer: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 22,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, backgroundColor: C.white,
  },
  primaryBtn: { backgroundColor: C.primary, borderRadius: radius.button, paddingVertical: 15, alignItems: 'center' },
  primaryBtnText: { fontFamily: Fonts.bodyBold, color: C.creamText, fontSize: 15 },

  drawHint: { fontFamily: Fonts.body, fontSize: 13, color: C.text3, paddingHorizontal: 16, paddingBottom: 10 },
  drawBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24, backgroundColor: C.white,
  },
  drawBtn: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.button, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border3 },
  drawBtnText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: C.dark },
});
