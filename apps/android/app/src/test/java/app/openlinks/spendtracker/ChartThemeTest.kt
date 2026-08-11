package app.openlinks.spendtracker

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import app.openlinks.spendtracker.ui.theme.chartThemeFor
import app.openlinks.spendtracker.ui.theme.darkChartTheme
import app.openlinks.spendtracker.ui.theme.lightChartTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.pow

class ChartThemeTest {

    @Test
    fun chartThemeForPicksTheMatchingSurface() {
        assertSame(lightChartTheme, chartThemeFor(isDark = false))
        assertSame(darkChartTheme, chartThemeFor(isDark = true))
    }

    /**
     * Colour follows the entity, so the identity palette must have the same length
     * and the same hue ORDER in both themes. If the orders differed, the Nth
     * category would change colour the moment the user toggled the theme.
     */
    @Test
    fun bothPalettesHaveTheSameSizeAndHueOrder() {
        assertEquals(6, lightChartTheme.palette.size)
        assertEquals(lightChartTheme.palette.size, darkChartTheme.palette.size)

        // Position by position, the two themes must be different STEPS of the same
        // hue: never the identical colour, and never a different hue family.
        val expectedHueDegrees = listOf(249f, 20f, 163f, 41f, 336f, 120f)
        lightChartTheme.palette.indices.forEach { position ->
            val lightHue = hueDegrees(lightChartTheme.palette[position])
            val darkHue = hueDegrees(darkChartTheme.palette[position])
            assertEquals(
                "palette position $position changed hue between themes",
                expectedHueDegrees[position],
                lightHue,
                12f,
            )
            assertEquals(
                "palette position $position changed hue between themes",
                expectedHueDegrees[position],
                darkHue,
                12f,
            )
            assertNotEquals(
                "palette position $position must use a different step per theme",
                lightChartTheme.palette[position],
                darkChartTheme.palette[position],
            )
        }
    }

    /**
     * Blue and red are reserved for polarity. A category painted the exact colour
     * that means "spend" is a lie about the data.
     */
    @Test
    fun neitherPaletteContainsAPolarityColor() {
        listOf(lightChartTheme, darkChartTheme).forEach { theme ->
            assertFalse(theme.palette.contains(theme.income))
            assertFalse(theme.palette.contains(theme.spend))
            assertFalse(theme.palette.contains(lightChartTheme.income))
            assertFalse(theme.palette.contains(lightChartTheme.spend))
        }
    }

    @Test
    fun netIsNeutralAndDistinctFromThePolarityPair() {
        listOf(lightChartTheme, darkChartTheme).forEach { theme ->
            assertNotEquals(theme.income, theme.net)
            assertNotEquals(theme.spend, theme.net)
            assertFalse(theme.palette.contains(theme.net))
        }
    }

    @Test
    fun bothSpendRampsHaveSixSteps() {
        assertEquals(6, lightChartTheme.spendRamp.size)
        assertEquals(6, darkChartTheme.spendRamp.size)
    }

    /**
     * The heatmap ramp has to read as an ordered scale, so lightness must move
     * monotonically: darker as spend rises on the light surface, lighter on the
     * dark surface.
     */
    @Test
    fun spendRampsAreMonotonicInLightness() {
        val lightSteps = lightChartTheme.spendRamp.map(::relativeLuminance)
        lightSteps.zipWithNext().forEach { (earlier, later) ->
            assertTrue("light ramp must get darker as spend rises", later < earlier)
        }
        val darkSteps = darkChartTheme.spendRamp.map(::relativeLuminance)
        darkSteps.zipWithNext().forEach { (earlier, later) ->
            assertTrue("dark ramp must get lighter as spend rises", later > earlier)
        }
    }

    @Test
    fun otherBucketIsNeutralAndNotAPaletteHue() {
        listOf(lightChartTheme, darkChartTheme).forEach { theme ->
            assertFalse(theme.palette.contains(theme.other))
            assertNotEquals(theme.income, theme.other)
            assertNotEquals(theme.spend, theme.other)
        }
    }
}

private fun channels(color: Color): Triple<Float, Float, Float> {
    val argb = color.toArgb()
    val red = ((argb shr 16) and 0xFF) / 255f
    val green = ((argb shr 8) and 0xFF) / 255f
    val blue = (argb and 0xFF) / 255f
    return Triple(red, green, blue)
}

/** Standard HSL hue in degrees, used only to compare hue families across themes. */
private fun hueDegrees(color: Color): Float {
    val (red, green, blue) = channels(color)
    val maximum = maxOf(red, green, blue)
    val minimum = minOf(red, green, blue)
    val delta = maximum - minimum
    if (delta == 0f) return 0f
    val hue = when (maximum) {
        red -> 60f * (((green - blue) / delta) % 6f)
        green -> 60f * (((blue - red) / delta) + 2f)
        else -> 60f * (((red - green) / delta) + 4f)
    }
    return (hue + 360f) % 360f
}

/** WCAG relative luminance, enough to assert a ramp is ordered. */
private fun relativeLuminance(color: Color): Float {
    val (red, green, blue) = channels(color)
    fun linear(channel: Float): Float =
        if (channel <= 0.03928f) channel / 12.92f else ((channel + 0.055f) / 1.055f).pow(2.4f)
    return 0.2126f * linear(red) + 0.7152f * linear(green) + 0.0722f * linear(blue)
}
