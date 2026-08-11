package app.openlinks.spendtracker

import app.openlinks.spendtracker.ui.Formatting
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FormattingTest {

    private val utc = ZoneId.of("UTC")

    @Test
    fun knownCurrenciesUseTheirSymbol() {
        assertEquals("$ 1,200.00", Formatting.money(1200.0, "USD"))
        assertEquals("S/ 142.60", Formatting.money(142.6, "PEN"))
    }

    @Test
    fun unknownCurrenciesFallBackToTheCode() {
        assertEquals("CLP 1,200.00", Formatting.money(1200.0, "CLP"))
    }

    @Test
    fun negativeAmountKeepsSignInFront() {
        assertEquals("-€ 4.50", Formatting.money(-4.5, "EUR"))
        assertEquals("-CLP 4.50", Formatting.money(-4.5, "CLP"))
    }

    @Test
    fun roundsToTwoDecimals() {
        assertEquals("$ 0.10", Formatting.money(0.1, "USD"))
    }

    /**
     * The chart value axes read money through this, so the gutter has to stay narrow:
     * "$ 1,234,567.00" on an axis either clips or steals width from the plot.
     */
    @Test
    fun compactMoneyAbbreviatesLargeAmounts() {
        assertEquals("$ 1.2K", Formatting.compactMoney(1200.0, "USD"))
        assertEquals("$ 1.5M", Formatting.compactMoney(1_500_000.0, "USD"))
        assertEquals("$ 2.3B", Formatting.compactMoney(2_250_000_000.0, "USD"))
    }

    @Test
    fun compactMoneyDropsATrailingZeroDecimal() {
        assertEquals("$ 1K", Formatting.compactMoney(1000.0, "USD"))
        assertEquals("$ 3M", Formatting.compactMoney(3_000_000.0, "USD"))
    }

    @Test
    fun compactMoneyKeepsCentsBelowAThousand() {
        assertEquals("$ 42.50", Formatting.compactMoney(42.5, "USD"))
        assertEquals("$ 0.00", Formatting.compactMoney(0.0, "USD"))
        assertEquals("$ 999.99", Formatting.compactMoney(999.99, "USD"))
    }

    @Test
    fun compactMoneyKeepsTheSignInFrontAndTheCurrencyRules() {
        assertEquals("-S/ 2.5K", Formatting.compactMoney(-2500.0, "PEN"))
        assertEquals("CLP 1.2K", Formatting.compactMoney(1200.0, "CLP"))
    }

    /** An axis on a chart with no rows has no currency to read; it must not print a stray space. */
    @Test
    fun compactMoneyWithoutACurrencyPrintsJustTheNumber() {
        assertEquals("1.2K", Formatting.compactMoney(1200.0, ""))
        assertEquals("-42.50", Formatting.compactMoney(-42.5, ""))
    }

    /**
     * The exact drift web surfaced when it summed a folded bucket: 37636.219999999994.
     * Aggregates are rounded here before anyone formats or compares them.
     */
    @Test
    fun roundToCentsRemovesFloatingPointDrift() {
        assertEquals(37636.22, Formatting.roundToCents(37636.219999999994), 0.0)
        assertEquals(0.3, Formatting.roundToCents(0.1 + 0.2), 0.0)
        assertEquals(-4.56, Formatting.roundToCents(-4.555), 0.0)
    }

    @Test
    fun roundToCentsLeavesExactAmountsAlone() {
        assertEquals(12.34, Formatting.roundToCents(12.34), 0.0)
        assertEquals(0.0, Formatting.roundToCents(0.0), 0.0)
    }

    @Test
    fun dateTimeIsHumanReadable() {
        assertEquals("27 Jul 2026, 06:56", Formatting.dateTime("2026-07-27T06:56:37.935Z", utc))
    }

    @Test
    fun unparseableTimestampsFallThroughUnchanged() {
        assertEquals("not-a-date", Formatting.dateTime("not-a-date", utc))
        assertNull(Formatting.localDate("not-a-date", utc))
    }

    @Test
    fun localDateReadsTheCalendarDay() {
        assertEquals(LocalDate.of(2026, 7, 27), Formatting.localDate("2026-07-27T06:56:37.935Z", utc))
    }

    @Test
    fun dayHeadingNamesTheTwoRecentDays() {
        val today = LocalDate.of(2026, 7, 27)

        assertEquals("Today", Formatting.dayHeading(today, today))
        assertEquals("Yesterday", Formatting.dayHeading(today.minusDays(1), today))
    }

    @Test
    fun dayHeadingShowsTheYearOnlyWhenItDiffers() {
        val today = LocalDate.of(2026, 7, 27)

        assertEquals("Fri, 3 Jul", Formatting.dayHeading(LocalDate.of(2026, 7, 3), today))
        assertEquals("Wed, 3 Dec 2025", Formatting.dayHeading(LocalDate.of(2025, 12, 3), today))
    }
}
