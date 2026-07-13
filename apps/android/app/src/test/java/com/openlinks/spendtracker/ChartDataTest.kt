package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.AccountRow
import com.openlinks.spendtracker.data.CategoryRow
import com.openlinks.spendtracker.data.SeriesRow
import com.openlinks.spendtracker.data.TagRow
import com.openlinks.spendtracker.ui.accountsForCurrency
import com.openlinks.spendtracker.ui.bucketLabel
import com.openlinks.spendtracker.ui.categoriesForCurrency
import com.openlinks.spendtracker.ui.donutSlices
import com.openlinks.spendtracker.ui.heatmapCells
import com.openlinks.spendtracker.ui.seriesForCurrency
import com.openlinks.spendtracker.ui.tagsForCurrency
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChartDataTest {

    private fun row(bucketStart: String, currency: String, spend: Double = 4.0): SeriesRow =
        SeriesRow(bucketStart = bucketStart, currency = currency, income = 10.0, spend = spend, net = 6.0)

    private fun tagRow(tag: String, currency: String, spend: Double = 4.0): TagRow =
        TagRow(tag = tag, currency = currency, spend = spend, count = 1)

    private fun accountRow(accountId: String, currency: String, net: Double = 6.0): AccountRow =
        AccountRow(accountId = accountId, currency = currency, income = 10.0, spend = 4.0, net = net, count = 1)

    private fun categoryRow(categoryId: String, currency: String, spend: Double): CategoryRow =
        CategoryRow(categoryId = categoryId, currency = currency, spend = spend, income = 0.0, net = 0.0, count = 1)

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

    @Test
    fun categoriesForCurrencyKeepsOnlyMatchingRows() {
        val byCategory = listOf(
            categoryRow("food", "USD", 10.0),
            categoryRow("rent", "EUR", 20.0),
            categoryRow("travel", "USD", 30.0),
        )

        val filtered = categoriesForCurrency(byCategory, "USD")

        assertEquals(listOf("food", "travel"), filtered.map { it.categoryId })
    }

    @Test
    fun categoriesForCurrencyReturnsEmptyForNullCurrency() {
        val byCategory = listOf(categoryRow("food", "USD", 10.0))

        assertEquals(emptyList<CategoryRow>(), categoriesForCurrency(byCategory, null))
    }

    @Test
    fun donutSlicesExcludesZeroSpendCategories() {
        val categories = listOf(
            categoryRow("food", "USD", 30.0),
            categoryRow("rent", "USD", 0.0),
            categoryRow("travel", "USD", 10.0),
        )

        val slices = donutSlices(categories) { id -> id }

        assertEquals(listOf("food", "travel"), slices.map { it.label })
    }

    @Test
    fun donutSlicesFractionsSumToOne() {
        val categories = listOf(
            categoryRow("food", "USD", 30.0),
            categoryRow("travel", "USD", 10.0),
        )

        val slices = donutSlices(categories) { id -> id }

        val fractionTotal = slices.sumOf { it.fraction.toDouble() }
        assertEquals(1.0, fractionTotal, 1e-6)
        assertEquals(0.75f, slices[0].fraction, 1e-6f)
        assertEquals(0.25f, slices[1].fraction, 1e-6f)
    }

    @Test
    fun donutSlicesAnglesAccumulateFromMinus90() {
        val categories = listOf(
            categoryRow("food", "USD", 30.0),
            categoryRow("travel", "USD", 10.0),
        )

        val slices = donutSlices(categories) { id -> id }

        assertEquals(-90f, slices[0].startAngle, 1e-4f)
        assertEquals(270f, slices[0].sweepAngle, 1e-4f)
        // Second slice starts where the first one ended.
        assertEquals(-90f + slices[0].sweepAngle, slices[1].startAngle, 1e-4f)
        assertEquals(90f, slices[1].sweepAngle, 1e-4f)
    }

    @Test
    fun donutSlicesUsesCategoryNameFallbackToId() {
        val categories = listOf(categoryRow("cat-1", "USD", 10.0))

        val named = donutSlices(categories) { "Groceries" }
        val unnamed = donutSlices(categories) { null }

        assertEquals("Groceries", named[0].label)
        assertEquals("cat-1", unnamed[0].label)
    }

    @Test
    fun donutSlicesColorIndexIsSequential() {
        val categories = listOf(
            categoryRow("food", "USD", 30.0),
            categoryRow("travel", "USD", 10.0),
        )

        val slices = donutSlices(categories) { id -> id }

        assertEquals(listOf(0, 1), slices.map { it.colorIndex })
    }

    @Test
    fun donutSlicesEmptyWhenAllZero() {
        val categories = listOf(
            categoryRow("food", "USD", 0.0),
            categoryRow("rent", "USD", 0.0),
        )

        assertTrue(donutSlices(categories) { id -> id }.isEmpty())
    }

    @Test
    fun donutSlicesEmptyWhenNoCategories() {
        assertTrue(donutSlices(emptyList()) { id -> id }.isEmpty())
    }

    @Test
    fun heatmapCellsExtractsDatePartOfBucketStart() {
        val daySeries = listOf(
            row("2026-07-01T00:00:00.000Z", "USD", spend = 4.0),
            row("2026-07-02T00:00:00.000Z", "USD", spend = 8.0),
        )

        val cells = heatmapCells(daySeries)

        assertEquals(listOf("2026-07-01", "2026-07-02"), cells.map { it.date })
    }

    @Test
    fun heatmapCellsIntensityIsSpendOverMax() {
        val daySeries = listOf(
            row("2026-07-01T00:00:00.000Z", "USD", spend = 5.0),
            row("2026-07-02T00:00:00.000Z", "USD", spend = 10.0),
        )

        val cells = heatmapCells(daySeries)

        assertEquals(0.5f, cells[0].intensity, 1e-6f)
        assertEquals(1.0f, cells[1].intensity, 1e-6f)
        assertEquals(5.0, cells[0].spend, 1e-9)
    }

    @Test
    fun heatmapCellsIntensityZeroWhenMaxSpendZero() {
        val daySeries = listOf(
            row("2026-07-01T00:00:00.000Z", "USD", spend = 0.0),
            row("2026-07-02T00:00:00.000Z", "USD", spend = 0.0),
        )

        val cells = heatmapCells(daySeries)

        assertEquals(listOf(0f, 0f), cells.map { it.intensity })
    }

    @Test
    fun heatmapCellsEmptyOnEmpty() {
        assertTrue(heatmapCells(emptyList()).isEmpty())
    }
}
