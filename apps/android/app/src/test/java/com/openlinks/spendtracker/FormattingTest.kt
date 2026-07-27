package com.openlinks.spendtracker

import com.openlinks.spendtracker.ui.Formatting
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
