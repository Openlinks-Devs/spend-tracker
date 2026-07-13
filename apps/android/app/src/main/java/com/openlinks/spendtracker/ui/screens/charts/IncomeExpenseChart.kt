package com.openlinks.spendtracker.ui.screens.charts

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.SeriesRow
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.bucketLabel
import com.openlinks.spendtracker.ui.theme.ChartColors
import com.patrykandpatrick.vico.compose.cartesian.CartesianChartHost
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberBottom
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberStart
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberColumnCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLine
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.rememberCartesianChart
import com.patrykandpatrick.vico.compose.common.component.rememberLineComponent
import com.patrykandpatrick.vico.compose.common.fill
import com.patrykandpatrick.vico.core.cartesian.axis.HorizontalAxis
import com.patrykandpatrick.vico.core.cartesian.axis.VerticalAxis
import com.patrykandpatrick.vico.core.cartesian.data.CartesianChartModelProducer
import com.patrykandpatrick.vico.core.cartesian.data.CartesianValueFormatter
import com.patrykandpatrick.vico.core.cartesian.data.columnSeries
import com.patrykandpatrick.vico.core.cartesian.data.lineSeries
import com.patrykandpatrick.vico.core.cartesian.layer.ColumnCartesianLayer
import com.patrykandpatrick.vico.core.cartesian.layer.LineCartesianLayer

/**
 * A grouped income/spend column chart with a net line overlaid, per time bucket.
 * [rows] are already filtered to a single currency and sorted chronologically by
 * the backend. A Compose legend below the chart labels the three semantic colors.
 * Renders an empty-state Text (never an empty chart) when there is no data.
 */
@Composable
fun IncomeExpenseChart(rows: List<SeriesRow>, modifier: Modifier = Modifier) {
    if (rows.isEmpty()) {
        Text(
            text = Strings.get(StringKey.ChartNoData),
            style = MaterialTheme.typography.bodyMedium,
            modifier = modifier,
        )
        return
    }

    val modelProducer = remember { CartesianChartModelProducer() }
    LaunchedEffect(rows) {
        modelProducer.runTransaction {
            columnSeries {
                series(rows.map { row -> row.income })
                series(rows.map { row -> row.spend })
            }
            lineSeries {
                series(rows.map { row -> row.net })
            }
        }
    }

    val bottomAxisFormatter = CartesianValueFormatter { _, value, _ ->
        rows.getOrNull(value.toInt())?.let { row -> bucketLabel(row.bucketStart) } ?: ""
    }

    Column(modifier = modifier.fillMaxWidth()) {
        CartesianChartHost(
            chart = rememberCartesianChart(
                rememberColumnCartesianLayer(
                    columnProvider = ColumnCartesianLayer.ColumnProvider.series(
                        rememberLineComponent(fill = fill(ChartColors.incomeColor), thickness = 8.dp),
                        rememberLineComponent(fill = fill(ChartColors.spendColor), thickness = 8.dp),
                    ),
                    mergeMode = { ColumnCartesianLayer.MergeMode.Grouped() },
                ),
                rememberLineCartesianLayer(
                    lineProvider = LineCartesianLayer.LineProvider.series(
                        LineCartesianLayer.rememberLine(
                            fill = LineCartesianLayer.LineFill.single(fill(ChartColors.netColor)),
                        ),
                    ),
                ),
                startAxis = VerticalAxis.rememberStart(),
                bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = bottomAxisFormatter),
            ),
            modelProducer = modelProducer,
            modifier = Modifier.fillMaxWidth().height(220.dp),
        )
        ChartLegend(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        )
    }
}

@Composable
private fun ChartLegend(modifier: Modifier = Modifier) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        LegendEntry(color = ChartColors.incomeColor, label = Strings.get(StringKey.SummaryIncome))
        LegendEntry(color = ChartColors.spendColor, label = Strings.get(StringKey.SummarySpend))
        LegendEntry(color = ChartColors.netColor, label = Strings.get(StringKey.SummaryNet))
    }
}

@Composable
private fun LegendEntry(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(10.dp).clip(CircleShape).background(color))
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(start = 6.dp),
        )
    }
}
