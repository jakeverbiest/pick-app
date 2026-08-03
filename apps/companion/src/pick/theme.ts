/**
 * Pick — "Civic Blueprint" design system (Navy & White, blueprint-grid motifs).
 * Replaces the original "Trail" (Dark Green & Cream) system as of the Aug 2026
 * rebrand. Palette + type scale ported from the Pick Redesign design file.
 * No emoji anywhere; every glyph is a custom SVG line icon (see Icon.tsx).
 *
 * Background convention: WHITE is the page/card surface now (not cream —
 * cream flattened hierarchy when used wall-to-wall). Cream is reserved for
 * text/icons/badge-fills ON NAVY surfaces (hero cards, onboarding, tab
 * actives). Screens still reference `C.cream` for their page background for
 * historical reasons in some older files — that's being migrated to
 * `C.white` screen-by-screen; new code should use `C.white` for page bg and
 * `C.creamText` for cream-on-navy content.
 */

export const C = {
  /** buttons, headings, primary actions, icons, borders — the one navy */
  primary: '#0F2F66',
  /** same navy — body text and dark hero bands share one tone in this system */
  dark: '#0F2F66',
  /** positive/success: streaks, completed progress, share icon, route line */
  accent: '#4B7A54',
  /** legacy page-background token — being migrated to C.white screen by screen */
  cream: '#FFFFFF',
  /** cream, for text/icons/badge-fill ON NAVY surfaces (hero cards, onboarding) */
  creamText: '#FEFCDD',
  /** secondary text, labels — navy at reduced opacity */
  muted: 'rgba(15,47,102,0.55)',
  /** cards, and now the primary page background too */
  white: '#FFFFFF',
  /** chips, icon wells, badge wells — pale navy tint */
  tint: '#E8ECF5',
  /** page behind the phone frame (unused on-device, kept for parity) */
  canvas: '#EDE7D3',
  danger: '#FF3B30',
  warning: '#FF9500',

  /** primary CTA / active-state accent (Get Started button, rank-1 highlight, Edit link) */
  rust: '#C1502E',
  /** secondary map-marker accent (partial progress) */
  mustard: '#C98A2E',
  /** map-marker accent, darker variant (no/low progress) */
  deepRust: '#A8402E',

  // secondary text shades — navy at reduced opacity
  text2: 'rgba(15,47,102,0.72)',
  text3: 'rgba(15,47,102,0.60)',

  // borders / hairlines — navy at low opacity ("1.5px navy 20-25%" per spec)
  border: 'rgba(15,47,102,0.20)',
  border2: 'rgba(15,47,102,0.12)',
  border3: 'rgba(15,47,102,0.16)',

  // misc surfaces
  field: '#F4F6FA',
  progressTrack: '#E8ECF3',
  /** text/icons on the navy hero card — cream at high opacity */
  heroSub: 'rgba(254,252,221,0.78)',
  heroSub2: 'rgba(254,252,221,0.62)',
  warnBg: '#FFF1E6',
  /** toggle OFF track — navy 15% per spec */
  toggleOff: 'rgba(15,47,102,0.15)',
  chevron: 'rgba(15,47,102,0.35)',
} as const;

/** Brand colors used by the share composer per-platform presets. */
export const PLATFORM_ACCENT = {
  bluesky: '#1185FE',
  instagram: '#E1306C',
  facebook: '#1877F2',
  copy: '#0F2F66',
} as const;

/** Corner radius scale: 6px buttons, 8px cards, 18px large icon badges. */
export const radius = {
  card: 8,
  cardLg: 10,
  pill: 999,
  sheet: 20,
  chip: 8,
  field: 8,
  button: 6,
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F2F66',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  raised: {
    shadowColor: '#0F2F66',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  pill: {
    shadowColor: '#0F2F66',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
} as const;

/**
 * Font family names as registered by useFonts() in app/_layout.tsx (via
 * @expo-google-fonts/barlow-condensed + @expo-google-fonts/public-sans).
 * Barlow Condensed carries headlines/numbers; Public Sans carries body/UI —
 * pick the exact weight face rather than combining a family with fontWeight,
 * since RN picks custom TTF faces by family name, not synthesized weight.
 */
export const Fonts = {
  displayBold: 'BarlowCondensed_800ExtraBold',
  headlineBold: 'BarlowCondensed_700Bold',
  body: 'PublicSans_400Regular',
  bodyMedium: 'PublicSans_500Medium',
  bodySemibold: 'PublicSans_600SemiBold',
  bodyBold: 'PublicSans_700Bold',
  mono: 'Menlo',
} as const;

/** Type scale. Headline/number styles use Barlow Condensed (often uppercase,
 *  tight tracking); body/UI styles use Public Sans. */
export const type = {
  display: { fontFamily: Fonts.displayBold, fontSize: 28, letterSpacing: -0.4, color: C.dark },
  title: { fontFamily: Fonts.headlineBold, fontSize: 20, color: C.dark },
  subtitle: { fontFamily: Fonts.bodySemibold, fontSize: 16, color: C.dark },
  body: { fontFamily: Fonts.bodyMedium, fontSize: 14, color: C.dark },
  small: { fontFamily: Fonts.body, fontSize: 12, color: C.muted },
  label: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 11,
    letterSpacing: 0.4,
    color: C.muted,
  },
} as const;
