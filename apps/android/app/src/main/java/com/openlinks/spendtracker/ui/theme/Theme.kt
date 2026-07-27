package com.openlinks.spendtracker.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
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
 * Money colors, which are semantic rather than decorative: they must not shift
 * with the theme's accent. Kept slightly lighter in dark mode for contrast.
 */
object MoneyColors {
    private val incomeLight = Color(0xFF1B6E3C)
    private val incomeDark = Color(0xFF7FD6A0)
    private val expenseLight = Color(0xFFB3261E)
    private val expenseDark = Color(0xFFFFB4AB)

    @Composable
    fun income(): Color = if (isSystemInDarkTheme()) incomeDark else incomeLight

    @Composable
    fun expense(): Color = if (isSystemInDarkTheme()) expenseDark else expenseLight

    /** Green above zero, red below, plain text at exactly zero. */
    @Composable
    fun forAmount(amount: Double): Color = when {
        amount > 0 -> income()
        amount < 0 -> expense()
        else -> MaterialTheme.colorScheme.onSurface
    }
}

@Composable
fun SpendTrackerTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
