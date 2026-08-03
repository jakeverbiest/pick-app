// Pick App Color System
// "Civic Blueprint" — Navy & White Theme (Aug 2026 rebrand)
// Legacy duplicate of src/pick/theme.ts's `C` used by a handful of
// not-yet-migrated screens (map, settings, safety, auth, TeamSection,
// LoadingView) — kept in sync with the same palette so those screens shift
// to the new brand even before their own redesign pass.

export const COLORS = {
  // Primary
  sage: '#0F2F66',        // Primary brand color (navy)
  darkSage: '#0F2F66',    // Dark text (same navy)
  mutedSage: 'rgba(15,47,102,0.55)',   // Secondary text
  lightSage: '#3D5A8C',   // Hover states

  // Base
  cream: '#FFFFFF',       // Background (white is the surface now; see theme.ts note)
  light: '#F4F6FA',       // Subtle backgrounds
  white: '#FFFFFF',       // Pure white for cards

  // Accents
  accent: '#4B7A54',      // Green (calls to action / success)
  success: '#4B7A54',     // Green (success)
  error: '#FF3B30',       // Red (warnings/errors)
  warning: '#FF9500',     // Orange (caution)

  // Semantic
  background: '#FFFFFF',  // Page background
  surface: '#FFFFFF',     // Card/modal background
  border: 'rgba(15,47,102,0.20)',      // Border color
  text: '#0F2F66',        // Primary text
  textSecondary: 'rgba(15,47,102,0.55)', // Secondary text
  overlay: 'rgba(15,47,102,0.5)', // Modal overlay
};

export const TYPOGRAPHY = {
  display: { fontSize: 28, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 14, fontWeight: '500' },
  small: { fontSize: 12, fontWeight: '400' },
  label: { fontSize: 11, fontWeight: '600' },
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const RADIUS = {
  sm: 6,
  md: 8,
  lg: 8,
  xl: 10,
};
