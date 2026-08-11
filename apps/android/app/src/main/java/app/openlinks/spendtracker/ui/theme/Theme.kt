package app.openlinks.spendtracker.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * A complete scheme, not a partial one. Overriding only primary/secondary/tertiary
 * leaves every container, surface and "on" role at Material's baseline, which is
 * purple: that is why green buttons used to sit next to purple chips and a purple
 * FAB. Both schemes below are green-seeded end to end, with warm-neutral surfaces
 * so the money colors are the only saturated thing on screen.
 */

private val LightColors = lightColorScheme(
    primary = Color(0xFF16653C),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFA2F2C0),
    onPrimaryContainer = Color(0xFF00210F),
    secondary = Color(0xFF4E6355),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFD1E8D6),
    onSecondaryContainer = Color(0xFF0C1F14),
    tertiary = Color(0xFF8A5300),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFFDDB6),
    onTertiaryContainer = Color(0xFF2C1700),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
    background = Color(0xFFF7FBF5),
    onBackground = Color(0xFF181D18),
    surface = Color(0xFFF7FBF5),
    onSurface = Color(0xFF181D18),
    surfaceVariant = Color(0xFFDCE5DB),
    onSurfaceVariant = Color(0xFF414942),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF1F5EF),
    surfaceContainer = Color(0xFFEBEFE9),
    surfaceContainerHigh = Color(0xFFE6EAE4),
    surfaceContainerHighest = Color(0xFFE0E4DE),
    outline = Color(0xFF717971),
    outlineVariant = Color(0xFFC0C9BF),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF87D5A6),
    onPrimary = Color(0xFF00391E),
    primaryContainer = Color(0xFF00522D),
    onPrimaryContainer = Color(0xFFA2F2C0),
    secondary = Color(0xFFB5CCBA),
    onSecondary = Color(0xFF203528),
    secondaryContainer = Color(0xFF364B3E),
    onSecondaryContainer = Color(0xFFD1E8D6),
    tertiary = Color(0xFFFFB960),
    onTertiary = Color(0xFF4A2800),
    tertiaryContainer = Color(0xFF693C00),
    onTertiaryContainer = Color(0xFFFFDDB6),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    background = Color(0xFF101510),
    onBackground = Color(0xFFDFE4DD),
    surface = Color(0xFF101510),
    onSurface = Color(0xFFDFE4DD),
    surfaceVariant = Color(0xFF414942),
    onSurfaceVariant = Color(0xFFC0C9BF),
    surfaceContainerLowest = Color(0xFF0B0F0B),
    surfaceContainerLow = Color(0xFF181D18),
    surfaceContainer = Color(0xFF1C211C),
    surfaceContainerHigh = Color(0xFF262B26),
    surfaceContainerHighest = Color(0xFF313630),
    outline = Color(0xFF8B938A),
    outlineVariant = Color(0xFF414942),
)

/**
 * Is the theme actually in effect dark? Read this, never [isSystemInDarkTheme],
 * anywhere a color has to match the surface it is painted on. The two agree only
 * while the app blindly follows the OS; once the user can force light or dark they
 * diverge, and anything still asking the OS ends up dark-on-light or light-on-dark.
 *
 * Provided by [SpendTrackerTheme] from the same boolean that picks the color
 * scheme, so the value can never disagree with the surfaces around it. The `false`
 * default only applies outside the theme (previews, tests).
 */
val LocalIsDarkTheme = staticCompositionLocalOf { false }

/**
 * Money colors, which are semantic rather than decorative: they must not shift
 * with the theme's accent. Kept slightly lighter in dark mode for contrast.
 *
 * These four values are deliberately NOT swapped for the chart polarity pair in
 * [ChartTheme]. Amounts are TEXT and must clear WCAG 4.5:1; measured against the
 * real surfaces these are 6.01:1 / 6.25:1 / 10.58:1 / 10.88:1, whereas the chart
 * blue #2a78d6 measures 4.42:1 on white and 4.18:1 on the dark surface and the
 * chart red #e34948 measures 3.95:1 on white. Those clear the 3:1 threshold that
 * applies to graphics but fail it as text, so reusing them here would trade a
 * chart accessibility win for a text-contrast regression. Colour is also not the
 * only channel for an amount: Formatting.money emits a leading '-' and the summary
 * tiles carry Income / Spend / Net labels. Chart tokens and money tokens are two
 * different roles; only the charts change.
 */
object MoneyColors {
    private val incomeLight = Color(0xFF1B6E3C)
    private val incomeDark = Color(0xFF7FD6A0)
    private val expenseLight = Color(0xFFB3261E)
    private val expenseDark = Color(0xFFFFB4AB)

    @Composable
    fun income(): Color = if (LocalIsDarkTheme.current) incomeDark else incomeLight

    @Composable
    fun expense(): Color = if (LocalIsDarkTheme.current) expenseDark else expenseLight

    /** Green above zero, red below, plain text at exactly zero. */
    @Composable
    fun forAmount(amount: Double): Color = when {
        amount > 0 -> income()
        amount < 0 -> expense()
        else -> MaterialTheme.colorScheme.onSurface
    }
}

/**
 * [darkTheme] is the single source of truth for the whole tree: it picks the color
 * scheme AND is published as [LocalIsDarkTheme], so a caller that overrides it
 * (MainActivity, once the user has chosen an appearance) moves every theme-aware
 * color together instead of leaving money amounts and chart series on the OS setting.
 */
@Composable
fun SpendTrackerTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalIsDarkTheme provides darkTheme) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColors else LightColors,
            content = content,
        )
    }
}
