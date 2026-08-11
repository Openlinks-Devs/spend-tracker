package app.openlinks.spendtracker.ui

import java.time.LocalDate

import app.openlinks.spendtracker.data.AccountRow
import app.openlinks.spendtracker.data.CategoryRow
import app.openlinks.spendtracker.data.SeriesRow
import app.openlinks.spendtracker.data.TagRow

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
 * One labelled, ranked value on its way to a chart. [colorIndex] is the 0-based
 * slot in the chart's identity palette, or null for the aggregated "Other"
 * remainder, which is painted with the neutral bucket token instead of a palette
 * hue. The index is never wrapped with a modulo: see [withOtherBucket] for why.
 */
data class RankedValue(val label: String, val value: Double, val colorIndex: Int?)

/**
 * Ranks [entries] by value descending and caps them at [maxEntries] rows, folding
 * everything past the cap into ONE trailing bucket labelled [otherLabel].
 *
 * The cap is the whole point. Colour identifies an entity only while every entity
 * has its own colour: the previous code handed every row a running index and the
 * charts did `palette[index % palette.size]`, so with the 43 categories production
 * actually holds, categories 0, 6, 12, 18, 24, 30, 36 and 42 all drew the identical
 * colour and the ring became 43 sub-degree hairlines above a 43-row legend. Folding
 * the tail into one neutral bucket keeps the mapping honest, so callers index the
 * palette directly and must NOT reintroduce a defensive modulo.
 *
 * [maxEntries] counts the Other bucket, so a cap of 6 yields at most 5 identity
 * rows. The bucket's value is rounded to cents because it is a sum of doubles (web
 * surfaced one such total as 37636.219999999994). Ranking is done here rather than
 * trusting the backend's ORDER BY, because a "top N" that silently depends on an
 * upstream sort picks the wrong N the day that sort changes.
 */
fun withOtherBucket(
    entries: List<RankedValue>,
    maxEntries: Int,
    otherLabel: String,
): List<RankedValue> {
    if (maxEntries < 1) return emptyList()
    val ranked = entries.sortedByDescending { entry -> entry.value }
    if (ranked.size <= maxEntries) {
        return ranked.mapIndexed { index, entry -> entry.copy(colorIndex = index) }
    }

    val identityCount = maxEntries - 1
    val identityEntries = ranked.take(identityCount)
        .mapIndexed { index, entry -> entry.copy(colorIndex = index) }
    val foldedTotal = ranked.drop(identityCount).sumOf { entry -> entry.value }
    return identityEntries + RankedValue(
        label = otherLabel,
        value = Formatting.roundToCents(foldedTotal),
        colorIndex = null,
    )
}

/**
 * One slice of the category donut. [fraction] is the slice's share of the total
 * spend (0..1). [startAngle]/[sweepAngle] are Compose drawArc angles in degrees,
 * accumulated clockwise from -90 (12 o'clock). [colorIndex] is the slice's slot in
 * the identity palette, or null for the aggregated "Other" slice (see
 * [withOtherBucket]); the chart indexes the palette with it directly, no modulo.
 */
data class DonutSlice(
    val label: String,
    val value: Double,
    val fraction: Float,
    val startAngle: Float,
    val sweepAngle: Float,
    val colorIndex: Int?,
)

/**
 * Turns spend-by-category rows into donut slices, capped at [maxSlices] and folded
 * per [withOtherBucket] (so the caller passes its palette size and the trailing
 * bucket is labelled [otherLabel]). Only categories with spend > 0 are included (a
 * zero slice would draw nothing yet consume a color). Angles start at -90 (top) and
 * accumulate clockwise, so the slices tile the full circle. The label is
 * [categoryName] of the category id, falling back to the raw id. When there is no
 * positive spend at all the result is empty, so the chart can render its empty state
 * instead of a degenerate ring.
 */
fun donutSlices(
    categories: List<CategoryRow>,
    maxSlices: Int,
    otherLabel: String,
    categoryName: (String) -> String?,
): List<DonutSlice> {
    val spendingCategories = categories.filter { row -> row.spend > 0.0 }
    val totalSpend = spendingCategories.sumOf { row -> row.spend }
    if (totalSpend <= 0.0) return emptyList()

    val ranked = withOtherBucket(
        entries = spendingCategories.map { row ->
            RankedValue(
                label = categoryName(row.categoryId) ?: row.categoryId,
                value = row.spend,
                colorIndex = null,
            )
        },
        maxEntries = maxSlices,
        otherLabel = otherLabel,
    )

    var startAngle = -90f
    return ranked.map { entry ->
        val fraction = (entry.value / totalSpend).toFloat()
        val sweepAngle = fraction * 360f
        val slice = DonutSlice(
            label = entry.label,
            value = entry.value,
            fraction = fraction,
            startAngle = startAngle,
            sweepAngle = sweepAngle,
            colorIndex = entry.colorIndex,
        )
        startAngle += sweepAngle
        slice
    }
}

/**
 * Turns spend-by-tag rows into the bars of the tag chart: ranked by spend, capped
 * at [maxBars] and folded per [withOtherBucket] so tags past the cap are visible as
 * one [otherLabel] bar instead of silently vanishing. Every bar of a ranked
 * single-measure chart is painted one colour (the axis already names each bar, so a
 * per-bar hue would imply a distinction that does not exist), so the returned
 * [RankedValue.colorIndex] matters only for telling the Other bar apart.
 */
fun tagBars(tags: List<TagRow>, maxBars: Int, otherLabel: String): List<RankedValue> =
    withOtherBucket(
        entries = tags.map { row -> RankedValue(label = row.tag, value = row.spend, colorIndex = null) },
        maxEntries = maxBars,
        otherLabel = otherLabel,
    )

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
 * A short axis label for a bucket start such as "2026-07-01T00:00:00.000",
 * rendered as "Jul 01". The backend emits bucket starts ZONE-LESS (no trailing
 * "Z"): a bucket boundary is a local calendar instant, not a UTC one, and the
 * suffix used to make clients shift it across a day boundary. Parsing is done by
 * hand (no java.time) so it is safe on every Android API level, never throws, and
 * is indifferent to whether the suffix is there: any string that does not look
 * like a date is returned unchanged.
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

/**
 * The half-open filter window for one calendar day, mirroring the web client's
 * toDayWindow so a heatmap tap narrows both clients the same way.
 *
 * The backend compares `created_at >= from AND created_at < to`, so [to] is the
 * exclusive start of the NEXT day; an inclusive end would drag in the following
 * midnight's transactions. Both bounds are deliberately ZONE-LESS, matching the
 * zone-less bucket starts the analytics endpoint emits: `created_at` is
 * `timestamp without time zone`, and appending a UTC suffix here would reintroduce
 * exactly the off-by-one-day bug that the suffix removal fixed.
 *
 * Date arithmetic (rather than string surgery) is what carries month, year and
 * leap-day rollovers. Returns null for anything that is not a plain "YYYY-MM-DD",
 * so a malformed key filters nothing instead of throwing.
 */
fun dayFilterWindow(dayKey: String): Pair<String, String>? {
    val day = runCatching { LocalDate.parse(dayKey) }.getOrNull() ?: return null
    return "${day}T00:00:00.000" to "${day.plusDays(1)}T00:00:00.000"
}
