package app.openlinks.spendtracker.ui.screens.charts

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import app.openlinks.spendtracker.data.CategoryRow
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings
import app.openlinks.spendtracker.ui.DonutSlice
import app.openlinks.spendtracker.ui.Formatting
import app.openlinks.spendtracker.ui.donutSlices
import app.openlinks.spendtracker.ui.theme.ChartTheme
import app.openlinks.spendtracker.ui.theme.rememberChartTheme

/**
 * A donut chart of spend by category, hand-drawn with Compose [Canvas] because
 * Vico has no pie/donut layer. Each slice is a stroked arc (a ring, not a filled
 * wedge) colored from the themed identity palette. A legend below the ring lists
 * each category with its color, name and formatted spend. Renders
 * [ChartEmptyState] (never a degenerate ring) when there is no positive spend.
 *
 * The ring is capped at one slice per palette slot, with everything past the cap
 * folded into a single neutral "Other categories" slice (see donutSlices). Without
 * the cap this drew one arc per category, and production holds 43 of them: the ring
 * became dozens of sub-degree hairlines above a 43-row legend, and the old
 * `palette[index % size]` wrapped seven times, so eight different categories shared
 * a colour. Slices therefore index the palette DIRECTLY - re-adding a modulo would
 * put that bug straight back.
 */
@Composable
fun CategoryDonutChart(
    categories: List<CategoryRow>,
    categoryName: (String) -> String?,
    modifier: Modifier = Modifier,
) {
    val chartTheme = rememberChartTheme()
    val slices = donutSlices(
        categories = categories,
        maxSlices = chartTheme.palette.size,
        otherLabel = Strings.get(StringKey.ChartOtherCategories),
        categoryName = categoryName,
    )
    if (slices.isEmpty()) {
        ChartEmptyState(modifier)
        return
    }

    val currency = categories.firstOrNull()?.currency ?: ""

    Column(modifier = modifier.fillMaxWidth()) {
        Box(
            modifier = Modifier.fillMaxWidth().height(200.dp),
            contentAlignment = Alignment.Center,
        ) {
            DonutRing(slices = slices, chartTheme = chartTheme)
        }
        DonutLegend(
            slices = slices,
            currency = currency,
            chartTheme = chartTheme,
            modifier = Modifier.padding(top = 12.dp),
        )
    }
}

/** The colour of [slice]: its identity hue, or the neutral bucket token for the folded remainder. */
private fun sliceColor(slice: DonutSlice, chartTheme: ChartTheme): Color =
    slice.colorIndex?.let { index -> chartTheme.palette[index] } ?: chartTheme.other

@Composable
private fun DonutRing(slices: List<DonutSlice>, chartTheme: ChartTheme, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier.size(160.dp)) {
        val strokeWidth = size.minDimension * 0.18f
        // Inset by half the stroke so the ring stays fully inside the canvas.
        val inset = strokeWidth / 2f
        val arcSize = Size(size.width - strokeWidth, size.height - strokeWidth)
        val topLeft = Offset(inset, inset)
        slices.forEach { slice ->
            drawArc(
                color = sliceColor(slice, chartTheme),
                startAngle = slice.startAngle,
                sweepAngle = slice.sweepAngle,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = strokeWidth),
            )
        }
    }
}

@Composable
private fun DonutLegend(
    slices: List<DonutSlice>,
    currency: String,
    chartTheme: ChartTheme,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        slices.forEach { slice ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(sliceColor(slice, chartTheme)),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = slice.label,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = Formatting.money(slice.value, currency),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}
