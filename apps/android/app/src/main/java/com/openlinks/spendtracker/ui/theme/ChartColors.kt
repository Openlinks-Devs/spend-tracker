package com.openlinks.spendtracker.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Chart color tokens, kept separate from the Material theme so every chart draws
 * from one consistent, accessible source.
 *
 * [chartPalette] is a categorical set of six distinct hues (for charts that color
 * by an arbitrary category such as spend-by-category). The semantic colors carry
 * fixed meaning across every chart: income is green, spend is red, net is amber,
 * matching the app's green/amber theme accents.
 */
object ChartColors {
    val incomeColor: Color = Color(0xFF2E7D32)
    val spendColor: Color = Color(0xFFC62828)
    val netColor: Color = Color(0xFFB26A00)

    val chartPalette: List<Color> = listOf(
        Color(0xFF1B5E20), // green
        Color(0xFF1565C0), // blue
        Color(0xFFB26A00), // amber
        Color(0xFF6A1B9A), // purple
        Color(0xFF00838F), // teal
        Color(0xFFC62828), // red
    )
}
