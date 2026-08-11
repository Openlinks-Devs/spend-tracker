package app.openlinks.spendtracker.ui.screens.charts

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
import app.openlinks.spendtracker.data.SeriesRow
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings
import app.openlinks.spendtracker.ui.bucketLabel
import app.openlinks.spendtracker.ui.theme.ChartTheme
import app.openlinks.spendtracker.ui.theme.rememberChartTheme
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
import com.patrykandpatrick.vico.core.cartesian.data.CartesianLayerRangeProvider
import com.patrykandpatrick.vico.core.cartesian.data.columnSeries
import com.patrykandpatrick.vico.core.cartesian.data.lineSeries
import com.patrykandpatrick.vico.core.cartesian.layer.ColumnCartesianLayer
import com.patrykandpatrick.vico.core.cartesian.layer.LineCartesianLayer

/**
 * A grouped income/spend column chart with a net line overlaid, per time bucket.
 * [rows] are already filtered to a single currency and sorted chronologically by
 * the backend. A Compose legend below the chart labels the three semantic colors,
 * drawing from the same tokens the chart does so the two cannot drift apart.
 * Renders an empty-state Text (never an empty chart) when there is no data.
 *
 * Income and spend are POLARITY, so they take the reserved blue/red pair rather
 * than the finance-convention green/red, which a red-green colourblind viewer
 * cannot separate (protan dE 1.6-5.7 against a floor of 8). Net is the neutral ink,
 * not a third hue: it is a reference line across the pair, not a third category.
 */
@Composable
fun IncomeExpenseChart(rows: List<SeriesRow>, modifier: Modifier = Modifier) {
    if (rows.isEmpty()) {
        ChartEmptyState(modifier)
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

    val labels = rows.map { row -> bucketLabel(row.bucketStart) }
    val chartTheme = rememberChartTheme()
    val currency = rows.firstOrNull()?.currency

    Column(modifier = modifier.fillMaxWidth()) {
        CartesianChartHost(
            chart = rememberCartesianChart(
                rememberColumnCartesianLayer(
                    columnProvider = ColumnCartesianLayer.ColumnProvider.series(
                        rememberLineComponent(fill = fill(chartTheme.income), thickness = 8.dp),
                        rememberLineComponent(fill = fill(chartTheme.spend), thickness = 8.dp),
                    ),
                    mergeMode = { ColumnCartesianLayer.MergeMode.Grouped() },
                    // Income and spend are both magnitudes, so zero is the true
                    // baseline; auto-ranging flattens the smaller of the pair.
                    rangeProvider = CartesianLayerRangeProvider.fixed(minY = 0.0),
                ),
                rememberLineCartesianLayer(
                    lineProvider = LineCartesianLayer.LineProvider.series(
                        LineCartesianLayer.rememberLine(
                            fill = LineCartesianLayer.LineFill.single(fill(chartTheme.net)),
                        ),
                    ),
                ),
                startAxis = VerticalAxis.rememberStart(valueFormatter = moneyValueFormatter(currency)),
                bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = labelIndexFormatter(labels)),
            ),
            modelProducer = modelProducer,
            modifier = Modifier.fillMaxWidth().height(220.dp),
        )
        ChartLegend(
            chartTheme = chartTheme,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        )
    }
}

/** Takes the same [chartTheme] instance the chart painted with, so a swatch cannot disagree with its series. */
@Composable
private fun ChartLegend(chartTheme: ChartTheme, modifier: Modifier = Modifier) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        LegendEntry(color = chartTheme.income, label = Strings.get(StringKey.SummaryIncome))
        LegendEntry(color = chartTheme.spend, label = Strings.get(StringKey.SummarySpend))
        LegendEntry(color = chartTheme.net, label = Strings.get(StringKey.SummaryNet))
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
