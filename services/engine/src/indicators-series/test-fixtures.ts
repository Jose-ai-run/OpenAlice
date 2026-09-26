/**
 * 10-bar OHLC fixture used by adx.spec.ts (and reusable by other series
 * tests). Values are plain round numbers specifically so the reference
 * computation in adx.spec.ts's comment can be traced by hand.
 */
export const HLC_FIXTURE = {
  highs:  [44, 45, 46, 47,   48, 47.5, 46.5, 48, 49, 50],
  lows:   [42, 43, 44, 45.5, 46, 46,   45,   46, 47, 48],
  closes: [43, 44, 45, 46.5, 47.5, 46.5, 45.5, 47.5, 48.5, 49.5],
}
