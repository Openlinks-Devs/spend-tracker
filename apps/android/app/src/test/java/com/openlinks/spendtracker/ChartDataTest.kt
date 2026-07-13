package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.AccountRow
import com.openlinks.spendtracker.data.SeriesRow
import com.openlinks.spendtracker.data.TagRow
import com.openlinks.spendtracker.ui.accountsForCurrency
import com.openlinks.spendtracker.ui.bucketLabel
import com.openlinks.spendtracker.ui.seriesForCurrency
import com.openlinks.spendtracker.ui.tagsForCurrency
import org.junit.Assert.assertEquals
import org.junit.Test

class ChartDataTest {

    private fun row(bucketStart: String, currency: String): SeriesRow =
        SeriesRow(bucketStart = bucketStart, currency = currency, income = 10.0, spend = 4.0, net = 6.0)

    private fun tagRow(tag: String, currency: String, spend: Double = 4.0): TagRow =
        TagRow(tag = tag, currency = currency, spend = spend, count = 1)

    private fun accountRow(accountId: String, currency: String, net: Double = 6.0): AccountRow =
        AccountRow(accountId = accountId, currency = currency, income = 10.0, spend = 4.0, net = net, count = 1)

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

    @Test
    fun tagsForCurrencyKeepsOnlyMatchingRows() {
        val byTag = listOf(
            tagRow("groceries", "USD"),
            tagRow("rent", "EUR"),
            tagRow("travel", "USD"),
        )

        val filtered = tagsForCurrency(byTag, "USD")

        assertEquals(listOf("groceries", "travel"), filtered.map { it.tag })
    }

    @Test
    fun tagsForCurrencyPreservesBackendOrder() {
        val first = tagRow("groceries", "USD")
        val second = tagRow("rent", "USD")
        val third = tagRow("travel", "USD")
        val byTag = listOf(first, second, third)

        val filtered = tagsForCurrency(byTag, "USD")

        assertEquals(listOf(first, second, third), filtered)
    }

    @Test
    fun tagsForCurrencyReturnsEmptyWhenNoMatch() {
        val byTag = listOf(tagRow("groceries", "USD"))

        assertEquals(emptyList<TagRow>(), tagsForCurrency(byTag, "GBP"))
    }

    @Test
    fun tagsForCurrencyReturnsEmptyForNullCurrency() {
        val byTag = listOf(tagRow("groceries", "USD"))

        assertEquals(emptyList<TagRow>(), tagsForCurrency(byTag, null))
    }

    @Test
    fun accountsForCurrencyKeepsOnlyMatchingRows() {
        val byAccount = listOf(
            accountRow("checking", "USD"),
            accountRow("savings", "EUR"),
            accountRow("credit", "USD"),
        )

        val filtered = accountsForCurrency(byAccount, "USD")

        assertEquals(listOf("checking", "credit"), filtered.map { it.accountId })
    }

    @Test
    fun accountsForCurrencyPreservesBackendOrder() {
        val first = accountRow("checking", "USD")
        val second = accountRow("savings", "USD")
        val third = accountRow("credit", "USD")
        val byAccount = listOf(first, second, third)

        val filtered = accountsForCurrency(byAccount, "USD")

        assertEquals(listOf(first, second, third), filtered)
    }

    @Test
    fun accountsForCurrencyReturnsEmptyWhenNoMatch() {
        val byAccount = listOf(accountRow("checking", "USD"))

        assertEquals(emptyList<AccountRow>(), accountsForCurrency(byAccount, "GBP"))
    }

    @Test
    fun accountsForCurrencyReturnsEmptyForNullCurrency() {
        val byAccount = listOf(accountRow("checking", "USD"))

        assertEquals(emptyList<AccountRow>(), accountsForCurrency(byAccount, null))
    }
}
