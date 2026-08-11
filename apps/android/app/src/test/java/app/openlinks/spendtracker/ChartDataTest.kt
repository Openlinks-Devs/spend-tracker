package app.openlinks.spendtracker

import app.openlinks.spendtracker.data.AccountRow
import app.openlinks.spendtracker.data.CategoryRow
import app.openlinks.spendtracker.data.SeriesRow
import app.openlinks.spendtracker.data.TagRow
import app.openlinks.spendtracker.ui.accountsForCurrency
import app.openlinks.spendtracker.ui.dayFilterWindow
import app.openlinks.spendtracker.ui.bucketLabel
import app.openlinks.spendtracker.ui.categoriesForCurrency
import app.openlinks.spendtracker.ui.donutSlices
import app.openlinks.spendtracker.ui.heatmapCells
import app.openlinks.spendtracker.ui.seriesForCurrency
import app.openlinks.spendtracker.ui.tagBars
import app.openlinks.spendtracker.ui.tagsForCurrency
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChartDataTest {

    // The donut's cap in production is the identity palette's length; the tests pick
    // their own so the fixtures stay small.
    private val otherCategories = "Other categories"
    private val otherTags = "Other tags"

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

    /**
     * The wire format bucket starts actually arrive in: the backend dropped the "Z"
     * because a bucket boundary is a LOCAL calendar instant, not a UTC one. Pinned
     * here (and in the heatmap test below) so nobody "fixes" the hand-rolled parsing
     * into a strict Instant.parse, which would throw on exactly this string.
     */
    @Test
    fun bucketLabelFormatsZonelessBucketStart() {
        assertEquals("Jul 01", bucketLabel("2026-07-01T00:00:00.000"))
        assertEquals("Dec 25", bucketLabel("2026-12-25T12:34:56.000"))
    }

    /** A month bucket, which the backend sends with no time part at all. */
    @Test
    fun bucketLabelFormatsBareDate() {
        assertEquals("May 19", bucketLabel("2026-05-19"))
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

        val slices = donutSlices(categories, 6, otherCategories) { id -> id }

        assertEquals(listOf("food", "travel"), slices.map { it.label })
    }

    @Test
    fun donutSlicesFractionsSumToOne() {
        val categories = listOf(
            categoryRow("food", "USD", 30.0),
            categoryRow("travel", "USD", 10.0),
        )

        val slices = donutSlices(categories, 6, otherCategories) { id -> id }

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

        val slices = donutSlices(categories, 6, otherCategories) { id -> id }

        assertEquals(-90f, slices[0].startAngle, 1e-4f)
        assertEquals(270f, slices[0].sweepAngle, 1e-4f)
        // Second slice starts where the first one ended.
        assertEquals(-90f + slices[0].sweepAngle, slices[1].startAngle, 1e-4f)
        assertEquals(90f, slices[1].sweepAngle, 1e-4f)
    }

    @Test
    fun donutSlicesUsesCategoryNameFallbackToId() {
        val categories = listOf(categoryRow("cat-1", "USD", 10.0))

        val named = donutSlices(categories, 6, otherCategories) { "Groceries" }
        val unnamed = donutSlices(categories, 6, otherCategories) { null }

        assertEquals("Groceries", named[0].label)
        assertEquals("cat-1", unnamed[0].label)
    }

    @Test
    fun donutSlicesColorIndexIsSequential() {
        val categories = listOf(
            categoryRow("food", "USD", 30.0),
            categoryRow("travel", "USD", 10.0),
        )

        val slices = donutSlices(categories, 6, otherCategories) { id -> id }

        assertEquals(listOf(0, 1), slices.map { it.colorIndex })
    }

    /** Under the cap, nothing is folded and every slice keeps its own identity slot. */
    @Test
    fun donutSlicesUnderTheCapPassThroughUntouched() {
        val categories = (1..3).map { rank -> categoryRow("cat-$rank", "USD", rank * 10.0) }

        val slices = donutSlices(categories, 4, otherCategories) { id -> id }

        assertEquals(listOf("cat-3", "cat-2", "cat-1"), slices.map { it.label })
        assertEquals(listOf(0, 1, 2), slices.map { it.colorIndex })
    }

    /**
     * The cap is what stops colour from lying: production holds 43 categories, and the
     * old running index wrapped the palette seven times, so eight categories drew the
     * identical colour. A cap of N means N-1 identity slices plus one Other.
     */
    @Test
    fun donutSlicesOverTheCapFoldTheRemainderIntoOneOtherSlice() {
        val categories = (1..10).map { rank -> categoryRow("cat-$rank", "USD", rank * 10.0) }

        val slices = donutSlices(categories, 4, otherCategories) { id -> id }

        assertEquals(4, slices.size)
        assertEquals(listOf("cat-10", "cat-9", "cat-8", otherCategories), slices.map { it.label })
        assertEquals(listOf(0, 1, 2), slices.dropLast(1).map { it.colorIndex })
        // Folded remainder: categories 1..7, i.e. 10 + 20 + ... + 70.
        assertEquals(280.0, slices.last().value, 1e-9)
    }

    /** The Other slice takes the neutral bucket colour, so it has no palette slot at all. */
    @Test
    fun donutSlicesOtherSliceHasNoColorIndexAndSortsLast() {
        val categories = (1..10).map { rank -> categoryRow("cat-$rank", "USD", rank * 10.0) }

        val slices = donutSlices(categories, 4, otherCategories) { id -> id }

        assertNull(slices.last().colorIndex)
        assertTrue(slices.dropLast(1).all { it.colorIndex != null })
    }

    /**
     * The Other slice is last even when it outweighs every identity slice, because it
     * is a remainder, not a rank.
     */
    @Test
    fun donutSlicesOtherSliceSortsLastEvenWhenItIsTheLargest() {
        val categories = listOf(
            categoryRow("big", "USD", 30.0),
            categoryRow("a", "USD", 25.0),
            categoryRow("b", "USD", 25.0),
            categoryRow("c", "USD", 25.0),
        )

        val slices = donutSlices(categories, 2, otherCategories) { id -> id }

        assertEquals(listOf("big", otherCategories), slices.map { it.label })
        assertEquals(75.0, slices.last().value, 1e-9)
    }

    /** Summing a column of doubles drifts; the folded total is money, so it is cents-exact. */
    @Test
    fun donutSlicesOtherSliceIsRoundedToCents() {
        val categories = listOf(
            categoryRow("food", "USD", 100.0),
            categoryRow("a", "USD", 0.1),
            categoryRow("b", "USD", 0.2),
        )

        val slices = donutSlices(categories, 2, otherCategories) { id -> id }

        assertEquals("0.3", slices.last().value.toString())
    }

    @Test
    fun donutSlicesEmptyWhenAllZero() {
        val categories = listOf(
            categoryRow("food", "USD", 0.0),
            categoryRow("rent", "USD", 0.0),
        )

        assertTrue(donutSlices(categories, 6, otherCategories) { id -> id }.isEmpty())
    }

    @Test
    fun donutSlicesEmptyWhenNoCategories() {
        assertTrue(donutSlices(emptyList(), 6, otherCategories) { id -> id }.isEmpty())
    }

    @Test
    fun tagBarsUnderTheCapPassThroughUntouched() {
        val byTag = listOf(
            tagRow("groceries", "USD", spend = 30.0),
            tagRow("travel", "USD", spend = 10.0),
        )

        val bars = tagBars(byTag, 8, otherTags)

        assertEquals(listOf("groceries", "travel"), bars.map { it.label })
        assertEquals(listOf(0, 1), bars.map { it.colorIndex })
    }

    /**
     * Tags past the cap used to be dropped silently by a bare take(8). They are now
     * visible as one trailing bar, so the chart still adds up to what was spent.
     */
    @Test
    fun tagBarsFoldTheTailIntoOneOtherBar() {
        val byTag = (1..12).map { rank -> tagRow("tag-$rank", "USD", spend = rank * 10.0) }

        val bars = tagBars(byTag, 8, otherTags)

        assertEquals(8, bars.size)
        assertEquals(otherTags, bars.last().label)
        assertNull(bars.last().colorIndex)
        // Folded remainder: tags 1..5, i.e. 10 + 20 + 30 + 40 + 50.
        assertEquals(150.0, bars.last().value, 1e-9)
    }

    @Test
    fun tagBarsRanksBySpendDescending() {
        val byTag = listOf(
            tagRow("small", "USD", spend = 1.0),
            tagRow("large", "USD", spend = 99.0),
        )

        assertEquals(listOf("large", "small"), tagBars(byTag, 8, otherTags).map { it.label })
    }

    @Test
    fun tagBarsEmptyOnEmpty() {
        assertTrue(tagBars(emptyList(), 8, otherTags).isEmpty())
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

    /**
     * The zone-less wire format (see bucketLabelFormatsZonelessBucketStart). The day
     * key is taken by splitting the string, never by parsing it, so the calendar day
     * a cell reports is the one the backend bucketed by rather than a UTC shift of it.
     */
    @Test
    fun heatmapCellsExtractsDateFromZonelessBucketStart() {
        val daySeries = listOf(
            row("2026-07-01T00:00:00.000", "USD", spend = 4.0),
            row("2026-05-19", "USD", spend = 8.0),
        )

        val cells = heatmapCells(daySeries)

        assertEquals(listOf("2026-07-01", "2026-05-19"), cells.map { it.date })
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

    // The window feeds the transactions filter, where the backend compares
    // created_at >= from AND created_at < to, so `to` is the exclusive start of
    // the next day. Mirrors the web client's toDayWindow.
    @Test
    fun `dayFilterWindow spans one day, half-open`() {
        assertEquals(
            "2026-05-19T00:00:00.000" to "2026-05-20T00:00:00.000",
            dayFilterWindow("2026-05-19"),
        )
    }

    @Test
    fun `dayFilterWindow rolls over month, year and leap day`() {
        assertEquals(
            "2026-05-31T00:00:00.000" to "2026-06-01T00:00:00.000",
            dayFilterWindow("2026-05-31"),
        )
        assertEquals(
            "2026-12-31T00:00:00.000" to "2027-01-01T00:00:00.000",
            dayFilterWindow("2026-12-31"),
        )
        assertEquals(
            "2028-02-29T00:00:00.000" to "2028-03-01T00:00:00.000",
            dayFilterWindow("2028-02-29"),
        )
    }

    // Zone-less on purpose: a UTC suffix here would reintroduce the off-by-one
    // day the backend fix removed.
    @Test
    fun `dayFilterWindow emits no zone suffix`() {
        val window = requireNotNull(dayFilterWindow("2026-05-19"))
        assertEquals(false, window.first.endsWith("Z"))
        assertEquals(false, window.second.endsWith("Z"))
    }

    @Test
    fun `dayFilterWindow returns null for a malformed key`() {
        assertEquals(null, dayFilterWindow("not-a-date"))
        assertEquals(null, dayFilterWindow("2026-05-19T00:00:00.000"))
    }

}
