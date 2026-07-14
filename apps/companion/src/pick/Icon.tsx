/**
 * Custom SVG line-icon factory ported from the Trail prototype.
 * 24×24 viewBox, 1.8 stroke, round caps/joins. No emoji — ever.
 * Add new glyphs to ICONS using the same { d } (path) or { c:[cx,cy,r,filled] } (circle) shape.
 */
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { C } from './theme';

type PathDef = { d: string };
type CircleDef = { c: [number, number, number, boolean?] };
type Def = PathDef | CircleDef;

export const ICONS: Record<string, Def[]> = {
  pin: [{ d: 'M12 21s6.5-5.8 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.2 12 21 12 21Z' }, { c: [12, 10.3, 2.4] }],
  activity: [{ d: 'M3 12h3.5l2.5 7 4-15 2.5 8H21' }],
  trophy: [
    { d: 'M7 4h10v4a5 5 0 0 1-10 0V4Z' },
    { d: 'M7 6H4.5v1.5A2.5 2.5 0 0 0 7 10' },
    { d: 'M17 6h2.5v1.5A2.5 2.5 0 0 1 17 10' },
    { d: 'M12 13v4M8.5 20h7l-1-3h-5l-1 3Z' },
  ],
  target: [{ c: [12, 12, 8.5] }, { c: [12, 12, 4.5] }, { c: [12, 12, 1.4, true] }],
  user: [{ c: [12, 8, 3.3] }, { d: 'M5.5 19.5a6.5 6.5 0 0 1 13 0' }],
  route: [{ c: [6, 18, 2.2] }, { c: [18, 6, 2.2] }, { d: 'M8 17.5c6-1 4-6 8-9' }],
  clock: [{ c: [12, 12, 8.5] }, { d: 'M12 7.5V12l3 2' }],
  bag: [
    { d: 'M6.5 8h11l-1 11.5a1.8 1.8 0 0 1-1.8 1.6H9.3a1.8 1.8 0 0 1-1.8-1.6L6.5 8Z' },
    { d: 'M9.5 8V6.5a2.5 2.5 0 0 1 5 0V8' },
  ],
  check: [{ d: 'M5 12.5l4.5 4.5L19 7' }],
  plus: [{ d: 'M12 5.5v13M5.5 12h13' }],
  minus: [{ d: 'M5.5 12h13' }],
  trend: [{ d: 'M3.5 16.5l5.5-5.5 3.5 3.5L20 7' }, { d: 'M14.5 7H20v5.5' }],
  leaf: [{ d: 'M5 19c0-8 6-13.5 15-14.5C20 13 14 19 5 19Z' }, { d: 'M9 15c2-3 4-5 7-6.5' }],
  flag: [{ d: 'M6 21V4' }, { d: 'M6 4.5h11l-2 3.5 2 3.5H6' }],
  bolt: [{ d: 'M13 3 5 13.5h5.5L9 21l8-10.5h-5.5L13 3Z' }],
  camera: [
    { d: 'M4 8.5h3l1.5-2h7l1.5 2h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z' },
    { c: [12, 13, 3.3] },
  ],
  share: [
    { c: [6, 12, 2.4] },
    { c: [18, 6, 2.4] },
    { c: [18, 18, 2.4] },
    { d: 'M8.2 10.8 15.8 7.2M8.2 13.2l7.6 3.6' },
  ],
  back: [{ d: 'M15 6l-6 6 6 6' }],
  chevron: [{ d: 'M9.5 6l6 6-6 6' }],
  close: [{ d: 'M6 6l12 12M18 6 6 18' }],
  link: [
    { d: 'M10 13a4 4 0 0 0 5.7.4l2.6-2.6a4 4 0 0 0-5.7-5.7L11.2 6.5' },
    { d: 'M14 11a4 4 0 0 0-5.7-.4l-2.6 2.6a4 4 0 0 0 5.7 5.7L12.8 17.5' },
  ],
  trash: [
    { d: 'M5 7h14' },
    { d: 'M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7' },
    { d: 'M7 7l1 12.2a2 2 0 0 0 2 1.8h4a2 2 0 0 0 2-1.8L17 7' },
    { d: 'M10 11v6M14 11v6' },
  ],
};

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 22,
  color = C.dark,
  sw = 1.8,
}: {
  name: IconName | string;
  size?: number;
  color?: string;
  sw?: number;
}) {
  const defs = ICONS[name] ?? [];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {defs.map((def, i) => {
        if ('c' in def) {
          const [cx, cy, r, filled] = def.c;
          return (
            <Circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill={filled ? color : 'none'}
              stroke={filled ? 'none' : color}
              strokeWidth={sw}
            />
          );
        }
        return (
          <Path
            key={i}
            d={def.d}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </Svg>
  );
}
