package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.SeriesRow
import com.openlinks.spendtracker.ui.bucketLabel
import com.openlinks.spendtracker.ui.seriesForCurrency
import org.junit.Assert.assertEquals
import org.junit.Test

class ChartDataTest {

    private fun row(bucketStart: String, currency: String): SeriesRow =
        SeriesRow(bucketStart = bucketStart, currency = currency, income = 10.0, spend = 4.0, net = 6.0)

    @Test
    fun seriesForCurrencyKeepsOnlyMatchingRows() {
        val series = listOf(
            row("2026-07-01T00:00:00.000Z", "USD"),
            row("2026-07-02T00:00:00.000Z", "EUR"),
            row("2026-07-03T00:00:00.000Z", "USD"),
        )

        val filtered = seriesForCurrency(series, "USD")

        assertEquals(listOf("USD", "USD"), filtered.map { it.currency })
    }

    @Test
    fun seriesForCurrencyPreservesBackendOrder() {
        val first = row("2026-07-01T00:00:00.000Z", "USD")
        val second = row("2026-07-02T00:00:00.000Z", "USD")
        val third = row("2026-07-03T00:00:00.000Z", "USD")
        val series = listOf(first, second, third)

        val filtered = seriesForCurrency(series, "USD")

        assertEquals(listOf(first, second, third), filtered)
    }

    @Test
    fun seriesForCurrencyReturnsEmptyWhenNoMatch() {
        val series = listOf(row("2026-07-01T00:00:00.000Z", "USD"))

        assertEquals(emptyList<SeriesRow>(), seriesForCurrency(series, "GBP"))
    }

    @Test
    fun seriesForCurrencyReturnsEmptyForNullCurrency() {
        val series = listOf(row("2026-07-01T00:00:00.000Z", "USD"))

        assertEquals(emptyList<SeriesRow>(), seriesForCurrency(series, null))
    }

    @Test
    fun bucketLabelFormatsIsoDate() {
        assertEquals("Jul 01", bucketLabel("2026-07-01T00:00:00.000Z"))
    }

    @Test
    fun bucketLabelFormatsAnotherIsoDate() {
        assertEquals("Dec 25", bucketLabel("2026-12-25T12:34:56.000Z"))
    }

    @Test
    fun bucketLabelReturnsRawInputForGarbage() {
        assertEquals("not-a-date", bucketLabel("not-a-date"))
    }

    @Test
    fun bucketLabelReturnsRawInputForEmptyString() {
        assertEquals("", bucketLabel(""))
    }

    @Test
    fun bucketLabelReturnsRawInputForOutOfRangeMonth() {
        assertEquals("2026-13-01T00:00:00.000Z", bucketLabel("2026-13-01T00:00:00.000Z"))
    }
}
