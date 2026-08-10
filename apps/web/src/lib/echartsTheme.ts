// Chart colors, split by the JOB the color does. Mixing these jobs is what made
// the dashboard confusing: income and spend were being coloured by their index
// in the categorical palette, so "spend" was green in one chart, blue in another,
// and a blue heatmap in a third, while green simultaneously meant "positive net"
// elsewhere.
//
// Every value below was checked with the data-viz validator against this app's
// white surface (not eyeballed). Re-run before changing any of them.

// ---------------------------------------------------------------------------
// Polarity (diverging): money in vs money out.
// RESERVED - never assign these to an identity series.
//
// Validated pair: protan ΔE 21.6, normal ΔE 32.3, both >= 3:1 contrast, all
// checks pass. Green/red was tested first because it is the finance convention
// and REJECTED on evidence: every natural green/red pairing lands at protan
// ΔE 1.6-5.7, far below the floor of 8, meaning red-green colourblind viewers
// (~8% of men) cannot tell income from spend at all. The only green/red pairs
// that separated needed a green so dark it read gray (chroma 0.086) and a red
// too pale to reach 3:1 contrast.
// ---------------------------------------------------------------------------
export const INCOME_COLOR = '#2a78d6'
export const SPEND_COLOR = '#e34948'

// Net is the difference between the two, so it gets neutral ink rather than a
// third competing hue - it is the midpoint of the diverging axis. It is also
// drawn as a line against bars, so mark shape distinguishes it too.
export const NET_COLOR = '#475569'

// ---------------------------------------------------------------------------
// Identity (categorical): which category, which tag. Order is fixed and never
// cycled; slots are assigned in sequence.
//
// Blue and red are deliberately absent - they belong to polarity above. The
// order is load-bearing: orange next to magenta fails the normal-vision floor
// (ΔE 12.9, below 15), so they are kept apart. As listed: all checks pass.
// ---------------------------------------------------------------------------
export const palette = [
  '#4a3aa7', // violet
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#e87ba4', // magenta
  '#eda100', // yellow
  '#008300', // green
]

// Everything beyond the palette's length collapses into one neutral bucket
// rather than wrapping around and reusing a hue that already means something.
export const OTHER_COLOR = '#94a3b8'
export const OTHER_LABEL = 'Other'

// ---------------------------------------------------------------------------
// Sequential (magnitude): one hue, light to dark, monotonic lightness. This is
// the spend hue so that "more red = more spent" is the same story the bars tell.
// ---------------------------------------------------------------------------
export const SPEND_RAMP = ['#fdeceb', '#f7c8c6', '#ef9c99', '#e86e6b', '#e34948', '#b8322f']

/**
 * Caps an identity series at the number of hues available and folds the rest
 * into a single "Other" slice. Without this, ECharts silently wraps the palette
 * and the 7th category is painted the same colour as the 1st, so colour stops
 * identifying anything. Rows are assumed sorted by magnitude descending.
 */
export function withOtherBucket<Row>(
  rows: Row[],
  toValue: (row: Row) => number,
  toName: (row: Row) => string,
): { name: string; value: number; color: string }[] {
  const ranked = rows.map((row) => ({ name: toName(row), value: toValue(row) }))
  if (ranked.length <= palette.length) {
    return ranked.map((entry, index) => ({ ...entry, color: palette[index] }))
  }
  const kept = ranked.slice(0, palette.length - 1)
  const remainder = ranked.slice(palette.length - 1)
  // Round to cents. Adding a long column of decimal amounts in binary floating
  // point accumulates error - summing 31 categories produced
  // 37636.219999999994 - and this value is a money total, so cents is the real
  // precision. Display is formatted too, but the stored value should not carry
  // noise that percentages are then derived from.
  const otherTotal =
    Math.round(remainder.reduce((sum, entry) => sum + entry.value, 0) * 100) / 100
  return [
    ...kept.map((entry, index) => ({ ...entry, color: palette[index] })),
    { name: `${OTHER_LABEL} (${remainder.length})`, value: otherTotal, color: OTHER_COLOR },
  ]
}
