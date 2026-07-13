package com.openlinks.spendtracker.ui

import com.openlinks.spendtracker.data.AccountRow
import com.openlinks.spendtracker.data.CategoryRow
import com.openlinks.spendtracker.data.SeriesRow
import com.openlinks.spendtracker.data.TagRow

/**
 * Pure data-shaping helpers for the analytics charts. Kept free of Android and
 * Compose dependencies so they are unit tested in isolation (see ChartDataTest).
 */

/**
 * The analytics [series] rows for [currency], in their original order. The
 * backend already sorts by bucket, so filtering preserves chronological order.
 * A null [currency] never matches (SeriesRow.currency is non-null), so the
 * result is empty, which the charts render as an empty state.
 */
fun seriesForCurrency(series: List<SeriesRow>, currency: String?): List<SeriesRow> =
    series.filter { row -> row.currency == currency }

/**
 * The [byTag] rows for [currency], in their original order. The backend already
 * sorts by spend descending, so filtering preserves that order. A null
 * [currency] never matches, so the result is empty.
 */
fun tagsForCurrency(byTag: List<TagRow>, currency: String?): List<TagRow> =
    byTag.filter { row -> row.currency == currency }

/**
 * The [byAccount] rows for [currency], in their original order. A null
 * [currency] never matches, so the result is empty.
 */
fun accountsForCurrency(byAccount: List<AccountRow>, currency: String?): List<AccountRow> =
    byAccount.filter { row -> row.currency == currency }

/**
 * The [byCategory] rows for [currency], in their original order. The backend
 * already sorts by spend descending, so filtering preserves that order. A null
 * [currency] never matches, so the result is empty.
 */
fun categoriesForCurrency(byCategory: List<CategoryRow>, currency: String?): List<CategoryRow> =
    byCategory.filter { row -> row.currency == currency }

/**
 * One slice of the category donut. [fraction] is the slice's share of the total
 * spend (0..1). [startAngle]/[sweepAngle] are Compose drawArc angles in degrees,
 * accumulated clockwise from -90 (12 o'clock). [colorIndex] is a running 0-based
 * index the caller mods into the chart palette.
 */
data class DonutSlice(
    val label: String,
    val value: Double,
    val fraction: Float,
    val startAngle: Float,
    val sweepAngle: Float,
    val colorIndex: Int,
)

/**
 * Turns spend-by-category rows into donut slices. Only categories with spend > 0
 * are included (a zero slice would draw nothing yet consume a color). Angles start
 * at -90 (top) and accumulate clockwise, so the slices tile the full circle. The
 * label is [categoryName] of the category id, falling back to the raw id. When
 * there is no positive spend at all the result is empty, so the chart can render
 * its empty state instead of a degenerate ring.
 */
fun donutSlices(categories: List<CategoryRow>, categoryName: (String) -> String?): List<DonutSlice> {
    val spendingCategories = categories.filter { row -> row.spend > 0.0 }
    val totalSpend = spendingCategories.sumOf { row -> row.spend }
    if (totalSpend <= 0.0) return emptyList()

    var startAngle = -90f
    return spendingCategories.mapIndexed { index, row ->
        val fraction = (row.spend / totalSpend).toFloat()
        val sweepAngle = fraction * 360f
        val slice = DonutSlice(
            label = categoryName(row.categoryId) ?: row.categoryId,
            value = row.spend,
            fraction = fraction,
            startAngle = startAngle,
            sweepAngle = sweepAngle,
            colorIndex = index,
        )
        startAngle += sweepAngle
        slice
    }
}

/**
 * One day's cell in the calendar heatmap. [date] is the "YYYY-MM-DD" part of the
 * bucket start. [intensity] is the day's spend relative to the busiest day (0..1),
 * used to scale the cell's color alpha.
 */
data class HeatmapCell(val date: String, val spend: Double, val intensity: Float)

/**
 * Turns day-bucketed analytics rows into heatmap cells. [intensity] is each day's
 * spend divided by the maximum spend across [daySeries]; when the max is not
 * positive (no spend anywhere) every intensity is 0. An empty series yields an
 * empty list so the chart can render its empty state.
 */
fun heatmapCells(daySeries: List<SeriesRow>): List<HeatmapCell> {
    if (daySeries.isEmpty()) return emptyList()
    val maxSpend = daySeries.maxOf { row -> row.spend }
    return daySeries.map { row ->
        val intensity = if (maxSpend > 0.0) (row.spend / maxSpend).toFloat() else 0f
        HeatmapCell(
            date = row.bucketStart.substringBefore("T"),
            spend = row.spend,
            intensity = intensity,
        )
    }
}

private val monthAbbreviations = listOf(
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

/**
 * A short axis label for an ISO bucket start such as "2026-07-01T00:00:00.000Z",
 * rendered as "Jul 01". Parsing is done by hand (no java.time) so it is safe on
 * every Android API level and never throws: any string that does not look like a
 * date is returned unchanged.
 */
fun bucketLabel(bucketStart: String): String {
    val datePart = bucketStart.substringBefore("T")
    val segments = datePart.split("-")
    if (segments.size < 3) return bucketStart
    val month = segments[1].toIntOrNull() ?: return bucketStart
    val day = segments[2].toIntOrNull() ?: return bucketStart
    if (month < 1 || month > 12) return bucketStart
    val monthName = monthAbbreviations[month - 1]
    return "$monthName ${day.toString().padStart(2, '0')}"
}
