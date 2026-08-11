package app.openlinks.spendtracker.ui.screens.charts

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import app.openlinks.spendtracker.data.SeriesRow
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings
import app.openlinks.spendtracker.ui.heatmapCells
import app.openlinks.spendtracker.ui.theme.rememberChartTheme
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.roundToInt

private val cellSize = 14.dp
private val cellGap = 3.dp
private const val WEEKDAY_COUNT = 7

/**
 * A day placed on the heatmap grid: [column] = week index, [row] = weekday (Mon=0..Sun=6).
 * [dayKey] is the bare "YYYY-MM-DD" the backend sent, kept verbatim so a tap can report
 * the day without ever re-parsing it, and [spend] is that day's total.
 */
private data class PlacedCell(
    val column: Int,
    val row: Int,
    val dayKey: String,
    val spend: Double,
    val intensity: Float,
)

/**
 * A GitHub-style calendar heatmap of daily spend, hand-drawn with Compose [Canvas]
 * because Vico has no calendar layer. Columns are weeks (from the earliest day),
 * rows are weekdays (Monday at the top). Wide ranges scroll horizontally. Renders
 * [ChartEmptyState] when there is no day data at all.
 *
 * Each day is painted with a step of the themed sequential spend ramp. It used to be
 * one spend colour at `alpha = 0.15 + 0.85 * intensity`, which is not a ramp:
 * translucent ink composites toward whatever is behind it, so on the dark surface a
 * low-spend day drifted toward the near-black background and "less" read as "more".
 * An explicit per-theme ramp is monotonic on both surfaces by construction.
 *
 * Tapping a day calls [onSelectDay] with that bare "YYYY-MM-DD" key. It defaults to a
 * no-op so this chart stands alone. The key is emitted verbatim, NOT parsed into an
 * instant: a bucket boundary is a local calendar day, and turning it into an Instant
 * would shift it across a day boundary for anyone east or west of UTC.
 */
@Composable
fun CalendarHeatmap(
    daySeries: List<SeriesRow>,
    modifier: Modifier = Modifier,
    onSelectDay: (String) -> Unit = {},
) {
    val placedCells = remember(daySeries) { placeCells(heatmapCellsWithDates(daySeries)) }
    if (placedCells.isEmpty()) {
        ChartEmptyState(modifier)
        return
    }

    val columnCount = placedCells.maxOf { it.column } + 1
    val gridWidth = cellSize * columnCount + cellGap * (columnCount - 1)
    val gridHeight = cellSize * WEEKDAY_COUNT + cellGap * (WEEKDAY_COUNT - 1)
    val spendRamp = rememberChartTheme().spendRamp
    // The tap handler is keyed on the cells, not on the lambda, so a caller passing a
    // fresh lambda every recomposition does not restart the gesture detector.
    val currentOnSelectDay = rememberUpdatedState(onSelectDay)

    Column(modifier = modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            Canvas(
                modifier = Modifier
                    .width(gridWidth)
                    .height(gridHeight)
                    .pointerInput(placedCells) {
                        detectTapGestures { tap ->
                            // Same geometry the draw pass below uses, so the hit area
                            // is exactly the drawn cell.
                            val cellPx = cellSize.toPx()
                            val stepPx = cellPx + cellGap.toPx()
                            cellAt(placedCells, tap, cellPx, stepPx)
                                ?.let { cell -> currentOnSelectDay.value(cell.dayKey) }
                        }
                    },
            ) {
                val cellPx = cellSize.toPx()
                val stepPx = cellPx + cellGap.toPx()
                val cornerRadius = CornerRadius(cellPx * 0.2f, cellPx * 0.2f)
                placedCells.forEach { cell ->
                    drawRoundRect(
                        color = spendRamp[rampIndex(cell.intensity, spendRamp.size)],
                        topLeft = Offset(cell.column * stepPx, cell.row * stepPx),
                        size = Size(cellPx, cellPx),
                        cornerRadius = cornerRadius,
                    )
                }
            }
        }
        HeatmapLegend(spendRamp = spendRamp, modifier = Modifier.padding(top = 12.dp))
    }
}

/**
 * The ramp step a 0..1 [intensity] paints with, across [stepCount] steps. The grid
 * and the legend both go through this one function, so the scale a user reads and
 * the scale the cells use cannot drift apart.
 */
internal fun rampIndex(intensity: Float, stepCount: Int): Int {
    if (stepCount <= 1) return 0
    return (intensity * (stepCount - 1)).roundToInt().coerceIn(0, stepCount - 1)
}

/**
 * The cell a tap at [tap] landed on, or null when it fell in a gap between cells or
 * on a day with no data. [cellPx] is the drawn cell edge and [stepPx] the cell-plus-gap
 * pitch, both passed in so this stays a pure function of the same geometry that draws.
 */
private fun cellAt(
    placedCells: List<PlacedCell>,
    tap: Offset,
    cellPx: Float,
    stepPx: Float,
): PlacedCell? {
    if (tap.x < 0f || tap.y < 0f) return null
    val column = (tap.x / stepPx).toInt()
    val row = (tap.y / stepPx).toInt()
    if (tap.x - column * stepPx > cellPx || tap.y - row * stepPx > cellPx) return null
    return placedCells.firstOrNull { cell -> cell.column == column && cell.row == row }
}

/**
 * A small "Less [swatches] More" scale. The swatches are evenly spaced intensities run
 * through [rampIndex], the same mapping the grid uses, rather than a hand-picked list
 * of colours that could fall out of step with it.
 */
@Composable
private fun HeatmapLegend(spendRamp: List<Color>, modifier: Modifier = Modifier) {
    val legendIntensities = List(spendRamp.size) { step -> step / (spendRamp.size - 1f) }
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(text = Strings.get(StringKey.ChartHeatmapLess), style = MaterialTheme.typography.bodySmall)
        Spacer(modifier = Modifier.width(6.dp))
        legendIntensities.forEach { intensity ->
            Spacer(
                modifier = Modifier
                    .size(12.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(spendRamp[rampIndex(intensity, spendRamp.size)]),
            )
            Spacer(modifier = Modifier.width(3.dp))
        }
        Spacer(modifier = Modifier.width(3.dp))
        Text(text = Strings.get(StringKey.ChartHeatmapMore), style = MaterialTheme.typography.bodySmall)
    }
}

/**
 * A heatmap day paired with its parsed calendar date. [dayKey] is the original
 * "YYYY-MM-DD" string: the parsed [date] is only for grid arithmetic, and the key is
 * what leaves this file, so the day a caller receives is byte-for-byte the day the
 * backend sent.
 */
private data class DatedCell(
    val date: LocalDate,
    val dayKey: String,
    val spend: Double,
    val intensity: Float,
)

/**
 * Parses each heatmap cell's "YYYY-MM-DD" date, dropping any that fail to parse so
 * a malformed bucket start never crashes the chart.
 */
private fun heatmapCellsWithDates(daySeries: List<SeriesRow>): List<DatedCell> =
    heatmapCells(daySeries).mapNotNull { cell ->
        val date = runCatching { LocalDate.parse(cell.date) }.getOrNull()
        date?.let {
            DatedCell(date = it, dayKey = cell.date, spend = cell.spend, intensity = cell.intensity)
        }
    }

/**
 * Lays out dated cells onto the week/weekday grid. The first column is the week of
 * the earliest day (anchored to that week's Monday), so columns advance one per
 * calendar week and rows run Monday (0) to Sunday (6).
 */
private fun placeCells(datedCells: List<DatedCell>): List<PlacedCell> {
    if (datedCells.isEmpty()) return emptyList()
    val earliestDate = datedCells.minOf { it.date }
    val startMonday = earliestDate.minusDays((earliestDate.dayOfWeek.value - 1).toLong())
    return datedCells.map { cell ->
        val daysFromStart = ChronoUnit.DAYS.between(startMonday, cell.date)
        PlacedCell(
            column = (daysFromStart / WEEKDAY_COUNT).toInt(),
            row = cell.date.dayOfWeek.value - 1,
            dayKey = cell.dayKey,
            spend = cell.spend,
            intensity = cell.intensity,
        )
    }
}
