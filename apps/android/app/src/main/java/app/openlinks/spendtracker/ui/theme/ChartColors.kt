package app.openlinks.spendtracker.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color

/**
 * Chart color tokens, kept separate from the Material theme so every chart draws
 * from one consistent, accessible source. Per theme, because a chart is painted on
 * a surface: a single fixed set cannot be legible on both #FFFFFF and #101510.
 *
 * Three deliberate rules, each replacing something that was wrong here before:
 *
 * 1. Polarity ([income] / [spend]) is blue #2a78d6 against red #e34948, NOT the
 *    finance-convention green/red. Natural green/red pairs measure a protanopic
 *    colour difference of 1.6-5.7, far below the floor of 8, so a red-green
 *    colourblind viewer cannot tell income from spend at all. This file used to
 *    ship exactly such a pair (#2E7D32 / #C62828). The blue/red pair measures
 *    protan dE 21.6 and validates on both surfaces.
 * 2. [net] is a derived neutral ink, never a third hue. It was amber #B26A00,
 *    which read as a third category and collided with a palette entry.
 * 3. The identity [palette] is for arbitrary categories, and blue and red are
 *    deliberately ABSENT from it because they are reserved for polarity above.
 *    Previously the palette contained a red byte-identical to the spend colour, so
 *    a category could be painted the exact colour that means "spend".
 *
 * The palette's hue ORDER is identical in both themes and only the steps change,
 * because colour follows the entity: if the order differed, a category would
 * change colour when the theme toggles.
 *
 * Money amounts are a separate role and do NOT use these values. See the KDoc on
 * [MoneyColors] for why (text has to clear 4.5:1; these hues do not).
 */
@Immutable
data class ChartTheme(
    /** Reserved polarity: money in. Never used for an identity series. */
    val income: Color,
    /** Reserved polarity: money out. Never used for an identity series. */
    val spend: Color,
    /** Derived neutral ink for the net line. Never a third hue. */
    val net: Color,
    /** Categorical identity hues, same order in every theme. */
    val palette: List<Color>,
    /** Neutral bucket for aggregated or truncated remainders ("Other"). */
    val other: Color,
    /** Sequential single-hue ramp, monotonic lightness, for the calendar heatmap. */
    val spendRamp: List<Color>,
)

val lightChartTheme = ChartTheme(
    income = Color(0xFF2A78D6),
    spend = Color(0xFFE34948),
    net = Color(0xFF475569),
    palette = listOf(
        Color(0xFF4A3AA7), // violet
        Color(0xFFEB6834), // orange
        Color(0xFF1BAF7A), // aqua
        Color(0xFFEDA100), // yellow
        Color(0xFFE87BA4), // magenta
        Color(0xFF008300), // green
    ),
    other = Color(0xFF94A3B8),
    spendRamp = listOf(
        Color(0xFFFDECEB),
        Color(0xFFF7C8C6),
        Color(0xFFEF9C99),
        Color(0xFFE86E6B),
        Color(0xFFE34948),
        Color(0xFFB8322F),
    ),
)

val darkChartTheme = ChartTheme(
    income = Color(0xFF2A78D6),
    spend = Color(0xFFE34948),
    net = Color(0xFF94A3B8),
    palette = listOf(
        Color(0xFF7565E2), // violet
        Color(0xFFE06A34), // orange
        Color(0xFF12977A), // aqua
        Color(0xFFBF8A10), // yellow
        Color(0xFFCF5F88), // magenta
        Color(0xFF17922A), // green
    ),
    other = Color(0xFF64748B),
    spendRamp = listOf(
        Color(0xFF2A1414),
        Color(0xFF4D1F1E),
        Color(0xFF7A2C2A),
        Color(0xFFA83A38),
        Color(0xFFD14947),
        Color(0xFFEF7472),
    ),
)

/** Pure lookup, so the pairing can be asserted without Compose. */
fun chartThemeFor(isDark: Boolean): ChartTheme = if (isDark) darkChartTheme else lightChartTheme

/**
 * The chart tokens for the theme actually in effect. Reads [LocalIsDarkTheme], not
 * isSystemInDarkTheme(), so a forced light or dark app does not paint dark-theme
 * chart steps on a light surface.
 */
@Composable
fun rememberChartTheme(): ChartTheme {
    val isDark = LocalIsDarkTheme.current
    return remember(isDark) { chartThemeFor(isDark) }
}

// The transitional, non-composable ChartColors shim lived here until every chart
// read rememberChartTheme(). All six now do, and its own KDoc gated its removal on
// exactly that, so it is gone: a non-theme-aware colour source that still compiles
// is a source a future chart can reach for by accident.
