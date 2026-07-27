package com.openlinks.spendtracker.ui.screens.charts

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.SeriesRow
import com.openlinks.spendtracker.ui.bucketLabel
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
import com.patrykandpatrick.vico.core.cartesian.data.CartesianLayerRangeProvider
import com.patrykandpatrick.vico.core.cartesian.data.columnSeries
import com.patrykandpatrick.vico.core.cartesian.layer.ColumnCartesianLayer

/**
 * A column chart of spend per time bucket. [rows] are already filtered to a
 * single currency and sorted chronologically by the backend, so the column at
 * index i corresponds to rows[i]. The bottom axis labels each column with
 * [bucketLabel]. Renders an empty-state Text (never an empty chart) when there
 * is no data, so it cannot crash on an empty model.
 */
@Composable
fun SpendingOverTimeChart(rows: List<SeriesRow>, modifier: Modifier = Modifier) {
    if (rows.isEmpty()) {
        ChartEmptyState(modifier)
        return
    }

    val modelProducer = remember { CartesianChartModelProducer() }
    LaunchedEffect(rows) {
        modelProducer.runTransaction {
            columnSeries { series(rows.map { row -> row.spend }) }
        }
    }

    val labels = rows.map { row -> bucketLabel(row.bucketStart) }

    CartesianChartHost(
        chart = rememberCartesianChart(
            rememberColumnCartesianLayer(
                columnProvider = ColumnCartesianLayer.ColumnProvider.series(
                    rememberLineComponent(fill = fill(ChartColors.spendColor), thickness = 12.dp),
                ),
                // Pin the baseline to zero. Left to auto-range, one big column
                // pushes the axis minimum above every smaller column, which then
                // renders with no visible height at all.
                rangeProvider = CartesianLayerRangeProvider.fixed(minY = 0.0),
            ),
            startAxis = VerticalAxis.rememberStart(),
            bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = labelIndexFormatter(labels)),
        ),
        modelProducer = modelProducer,
        modifier = modifier.fillMaxWidth().height(220.dp),
    )
}
