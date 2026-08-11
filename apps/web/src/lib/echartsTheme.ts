// Chart colors, split by the JOB the color does, with a selected set per
// surface. Mixing the jobs is what made the dashboard confusing: income and
// spend were coloured by their index in the categorical palette, so "spend" was
// green in one chart and blue in another, while green simultaneously meant
// "positive net" elsewhere.
//
// Dark is SELECTED, not a flip of light. Every value was checked with the
// data-viz validator against the surface it is actually drawn on - white for
// light, #020817 (the --background token) for dark. The light identity steps
// FAIL on the dark surface: violet drops to 2.34:1 contrast while orange,
// magenta and yellow all sit above the dark lightness band. Re-run the validator
// before changing any value here.

export interface ChartTheme {
  /** Money in. Reserved: never assigned to an identity series. */
  income: string
  /** Money out. Reserved. */
  spend: string
  /** Derived midpoint of the two poles, so neutral ink rather than a third hue. */
  net: string
  /** Identity slots, assigned in order and never cycled. */
  palette: string[]
  /** The bucket everything past the palette folds into. */
  other: string
  /** Sequential ramp for magnitude, in the spend hue, light to dark. */
  spendRamp: string[]
  /** Chart surface, used for the gaps between adjacent marks. */
  surface: string
  /** Recessive ink for axis labels, and the grid line colour. */
  axisLabel: string
  gridLine: string
  tooltipBackground: string
  tooltipBorder: string
  tooltipText: string
}

// The hue ORDER is identical across themes and only the steps change. If the
// order differed, a category would change colour when you toggle the theme -
// colour has to follow the entity, not the surface.
// Order: violet, orange, aqua, yellow, magenta, green.
const LIGHT_PALETTE = ['#4a3aa7', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']
const DARK_PALETTE = ['#7565e2', '#e06a34', '#12977a', '#bf8a10', '#cf5f88', '#17922a']

export const lightChartTheme: ChartTheme = {
  income: '#2a78d6',
  spend: '#e34948',
  net: '#475569',
  palette: LIGHT_PALETTE,
  other: '#94a3b8',
  spendRamp: ['#fdeceb', '#f7c8c6', '#ef9c99', '#e86e6b', '#e34948', '#b8322f'],
  surface: '#ffffff',
  axisLabel: '#64748b',
  gridLine: '#e2e8f0',
  tooltipBackground: '#ffffff',
  tooltipBorder: '#e2e8f0',
  tooltipText: '#020817',
}

export const darkChartTheme: ChartTheme = {
  // The polarity pair clears every check on BOTH surfaces, so it is deliberately
  // unchanged - income and spend keep one identity across themes.
  income: '#2a78d6',
  spend: '#e34948',
  net: '#94a3b8',
  palette: DARK_PALETTE,
  other: '#64748b',
  // Same hue, stepped from the dark surface upward so "darker" still reads as
  // "less", matching the light ramp's direction against its own surface.
  spendRamp: ['#2a1414', '#4d1f1e', '#7a2c2a', '#a83a38', '#d14947', '#ef7472'],
  surface: '#020817',
  axisLabel: '#94a3b8',
  gridLine: '#1e293b',
  tooltipBackground: '#0f172a',
  tooltipBorder: '#334155',
  tooltipText: '#f1f5f9',
}

export function chartThemeFor(isDark: boolean): ChartTheme {
  return isDark ? darkChartTheme : lightChartTheme
}

export const OTHER_LABEL = 'Other'

/**
 * Caps an identity series at the number of hues available and folds the rest
 * into a single "Other" bucket. Without this, ECharts silently wraps the palette
 * and the 7th category is painted the same colour as the 1st, so colour stops
 * identifying anything. Rows are assumed sorted by magnitude descending.
 */
export function withOtherBucket<Row>(
  rows: Row[],
  toValue: (row: Row) => number,
  toName: (row: Row) => string,
  theme: ChartTheme,
): { name: string; value: number; color: string }[] {
  const ranked = rows.map((row) => ({ name: toName(row), value: toValue(row) }))
  if (ranked.length <= theme.palette.length) {
    return ranked.map((entry, index) => ({ ...entry, color: theme.palette[index] }))
  }
  const kept = ranked.slice(0, theme.palette.length - 1)
  const remainder = ranked.slice(theme.palette.length - 1)
  // Round to cents. Adding a long column of decimal amounts in binary floating
  // point accumulates error - summing 31 categories produced
  // 37636.219999999994 - and this value is a money total, so cents is the real
  // precision. Percentages are derived from it, so it is rounded here rather
  // than only at the point of display.
  const otherTotal =
    Math.round(remainder.reduce((sum, entry) => sum + entry.value, 0) * 100) / 100
  return [
    ...kept.map((entry, index) => ({ ...entry, color: theme.palette[index] })),
    { name: `${OTHER_LABEL} (${remainder.length})`, value: otherTotal, color: theme.other },
  ]
}
