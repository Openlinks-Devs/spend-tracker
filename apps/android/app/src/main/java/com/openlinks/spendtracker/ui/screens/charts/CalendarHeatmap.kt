package com.openlinks.spendtracker.ui.screens.charts

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.SeriesRow
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.heatmapCells
import com.openlinks.spendtracker.ui.theme.ChartColors
import java.time.LocalDate
import java.time.temporal.ChronoUnit

private val cellSize = 14.dp
private val cellGap = 3.dp
private const val WEEKDAY_COUNT = 7

/** A day placed on the heatmap grid: [column] = week index, [row] = weekday (Mon=0..Sun=6). */
private data class PlacedCell(val column: Int, val row: Int, val intensity: Float)

/**
 * A GitHub-style calendar heatmap of daily spend, hand-drawn with Compose [Canvas]
 * because Vico has no calendar layer. Columns are weeks (from the earliest day),
 * rows are weekdays (Monday at the top). Each day is a rounded rect whose color is
 * [ChartColors.spendColor] with alpha scaled by the day's spend intensity, so
 * busier days read darker; days with no data stay blank. Wide ranges scroll
 * horizontally. Renders [ChartEmptyState] when there is no day data at all.
 */
@Composable
fun CalendarHeatmap(daySeries: List<SeriesRow>, modifier: Modifier = Modifier) {
    val placedCells = remember(daySeries) { placeCells(heatmapCellsWithDates(daySeries)) }
    if (placedCells.isEmpty()) {
        ChartEmptyState(modifier)
        return
    }

    val columnCount = placedCells.maxOf { it.column } + 1
    val gridWidth = cellSize * columnCount + cellGap * (columnCount - 1)
    val gridHeight = cellSize * WEEKDAY_COUNT + cellGap * (WEEKDAY_COUNT - 1)

    Column(modifier = modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            Canvas(modifier = Modifier.width(gridWidth).height(gridHeight)) {
                val cellPx = cellSize.toPx()
                val stepPx = cellPx + cellGap.toPx()
                val cornerRadius = CornerRadius(cellPx * 0.2f, cellPx * 0.2f)
                placedCells.forEach { cell ->
                    drawRoundRect(
                        color = ChartColors.spendColor.copy(alpha = 0.15f + 0.85f * cell.intensity),
                        topLeft = Offset(cell.column * stepPx, cell.row * stepPx),
                        size = Size(cellPx, cellPx),
                        cornerRadius = cornerRadius,
                    )
                }
            }
        }
        HeatmapLegend(modifier = Modifier.padding(top = 12.dp))
    }
}

/** A small "Less [swatches] More" scale of the spend color at increasing intensity. */
@Composable
private fun HeatmapLegend(modifier: Modifier = Modifier) {
    val intensitySteps = listOf(0f, 0.25f, 0.5f, 0.75f, 1f)
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(text = Strings.get(StringKey.ChartHeatmapLess), style = MaterialTheme.typography.bodySmall)
        Spacer(modifier = Modifier.width(6.dp))
        intensitySteps.forEach { intensity ->
            Spacer(
                modifier = Modifier
                    .size(12.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(ChartColors.spendColor.copy(alpha = 0.15f + 0.85f * intensity)),
            )
            Spacer(modifier = Modifier.width(3.dp))
        }
        Spacer(modifier = Modifier.width(3.dp))
        Text(text = Strings.get(StringKey.ChartHeatmapMore), style = MaterialTheme.typography.bodySmall)
    }
}

/** A heatmap day paired with its parsed calendar date. */
private data class DatedCell(val date: LocalDate, val intensity: Float)

/**
 * Parses each heatmap cell's "YYYY-MM-DD" date, dropping any that fail to parse so
 * a malformed bucket start never crashes the chart.
 */
private fun heatmapCellsWithDates(daySeries: List<SeriesRow>): List<DatedCell> =
    heatmapCells(daySeries).mapNotNull { cell ->
        val date = runCatching { LocalDate.parse(cell.date) }.getOrNull()
        date?.let { DatedCell(it, cell.intensity) }
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
            intensity = cell.intensity,
        )
    }
}
