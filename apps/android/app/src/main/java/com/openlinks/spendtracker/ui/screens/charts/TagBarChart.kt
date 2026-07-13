package com.openlinks.spendtracker.ui.screens.charts

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.TagRow
import com.openlinks.spendtracker.ui.theme.ChartColors
import com.patrykandpatrick.vico.compose.cartesian.CartesianChartHost
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberBottom
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberStart
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberColumnCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.rememberCartesianChart
import com.patrykandpatrick.vico.compose.common.component.rememberLineComponent
import com.patrykandpatrick.vico.compose.common.fill
import com.patrykandpatrick.vico.core.cartesian.axis.HorizontalAxis
import com.patrykandpatrick.vico.core.cartesian.axis.VerticalAxis
import com.patrykandpatrick.vico.core.cartesian.data.CartesianChartModelProducer
import com.patrykandpatrick.vico.core.cartesian.data.columnSeries
import com.patrykandpatrick.vico.core.cartesian.layer.ColumnCartesianLayer

private const val MAX_TAGS_SHOWN = 8

/**
 * A column chart of spend per tag. [rows] arrive already sorted by spend
 * descending (per the backend), so only the top [MAX_TAGS_SHOWN] are plotted
 * to keep the chart readable. The bottom axis labels each column with the tag
 * name. Renders an empty-state Text (never an empty chart) when there is no
 * data, so it cannot crash on an empty model.
 */
@Composable
fun TagBarChart(rows: List<TagRow>, modifier: Modifier = Modifier) {
    if (rows.isEmpty()) {
        ChartEmptyState(modifier)
        return
    }

    val topRows = rows.take(MAX_TAGS_SHOWN)
    val modelProducer = remember { CartesianChartModelProducer() }
    LaunchedEffect(topRows) {
        modelProducer.runTransaction {
            columnSeries { series(topRows.map { row -> row.spend }) }
        }
    }

    val labels = topRows.map { row -> row.tag }

    CartesianChartHost(
        chart = rememberCartesianChart(
            rememberColumnCartesianLayer(
                columnProvider = ColumnCartesianLayer.ColumnProvider.series(
                    rememberLineComponent(fill = fill(ChartColors.chartPalette[1]), thickness = 12.dp),
                ),
            ),
            startAxis = VerticalAxis.rememberStart(),
            bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = labelIndexFormatter(labels)),
        ),
        modelProducer = modelProducer,
        modifier = modifier.fillMaxWidth().height(220.dp),
    )
}
