/**
 * Pick — "Trail" design system (Dark Green & Cream).
 * Locked palette + type scale ported from the Trail prototype.
 * No emoji anywhere; every glyph is a custom SVG line icon (see Icon.tsx).
 */

export const C = {
  /** buttons, headings, primary actions */
  primary: '#2D5016',
  /** near-black green: body text, dark hero bands */
  dark: '#1B2E1A',
  /** live state, success, route line, progress */
  accent: '#34C759',
  /** app background */
  cream: '#F5F5F0',
  /** secondary text, labels */
  muted: '#8B9B7F',
  /** cards */
  white: '#FFFFFF',
  /** chips, icon wells, badge wells */
  tint: '#EEF3E6',
  /** page behind the phone frame (unused on-device, kept for parity) */
  canvas: '#E6E7E1',
  danger: '#FF3B30',
  warning: '#FF9500',

  // secondary text shades
  text2: '#5C6B54',
  text3: '#6B7A62',

  // borders / hairlines
  border: '#E8E8E6',
  border2: '#F0F0EA',
  border3: '#ECECE6',

  // misc surfaces seen in the prototype
  field: '#FAFAF8',
  progressTrack: '#EEF0E9',
  heroSub: '#C7D6B4',
  heroSub2: '#A8B896',
  warnBg: '#FFF1E6',
  toggleOff: '#D8D8D2',
  chevron: '#C7CEC0',
} as const;

/** Brand colors used by the share composer per-platform presets. */
export const PLATFORM_ACCENT = {
  bluesky: '#1185FE',
  instagram: '#E1306C',
  facebook: '#1877F2',
  copy: '#2D5016',
} as const;

export const radius = {
  card: 16,
  cardLg: 20,
  pill: 999,
  sheet: 28,
  chip: 12,
  field: 12,
  button: 14,
} as const;

export const shadow = {
  card: {
    shadowColor: '#1B2E1A',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  raised: {
    shadowColor: '#2D5016',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  pill: {
    shadowColor: '#1B2E1A',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
} as const;

/** Type scale (system font; no Inter/Roboto). */
export const type = {
  display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.4, color: C.dark },
  title: { fontSize: 20, fontWeight: '700' as const, color: C.dark },
  subtitle: { fontSize: 16, fontWeight: '600' as const, color: C.dark },
  body: { fontSize: 14, fontWeight: '500' as const, color: C.dark },
  small: { fontSize: 12, fontWeight: '400' as const, color: C.muted },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.4,
    color: C.muted,
  },
} as const;
