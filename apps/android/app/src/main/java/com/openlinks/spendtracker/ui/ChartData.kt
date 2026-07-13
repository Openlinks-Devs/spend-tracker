package com.openlinks.spendtracker.ui

import com.openlinks.spendtracker.data.AccountRow
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
