package com.openlinks.spendtracker.ui.screens.charts

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.AccountRow
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
import com.patrykandpatrick.vico.core.cartesian.data.ColumnCartesianLayerModel
import com.patrykandpatrick.vico.core.cartesian.data.columnSeries
import com.patrykandpatrick.vico.core.cartesian.layer.ColumnCartesianLayer
import com.patrykandpatrick.vico.core.common.component.LineComponent
import com.patrykandpatrick.vico.core.common.data.ExtraStore

/**
 * A column chart of net (income minus spend) per account. [rows] can carry a
 * negative [AccountRow.net], so columns are colored by sign: positive net uses
 * the income color, negative net uses the spend color. This is done with a
 * custom [ColumnCartesianLayer.ColumnProvider] that inspects each entry's y
 * value, since Vico's built-in `ColumnProvider.series` picks a color per
 * series index, not per entry. The bottom axis labels each column with
 * [accountName] (falling back to the raw account id). Renders an empty-state
 * Text (never an empty chart) when there is no data.
 */
@Composable
fun AccountNetChart(
    rows: List<AccountRow>,
    accountName: (String) -> String?,
    modifier: Modifier = Modifier,
) {
    if (rows.isEmpty()) {
        ChartEmptyState(modifier)
        return
    }

    val modelProducer = remember { CartesianChartModelProducer() }
    LaunchedEffect(rows) {
        modelProducer.runTransaction {
            columnSeries { series(rows.map { row -> row.net }) }
        }
    }

    val labels = rows.map { row -> accountName(row.accountId) ?: row.accountId }

    val positiveColumn = rememberLineComponent(fill = fill(ChartColors.incomeColor), thickness = 12.dp)
    val negativeColumn = rememberLineComponent(fill = fill(ChartColors.spendColor), thickness = 12.dp)
    val columnProvider = remember(positiveColumn, negativeColumn) {
        SignedColumnProvider(positiveColumn = positiveColumn, negativeColumn = negativeColumn)
    }

    CartesianChartHost(
        chart = rememberCartesianChart(
            rememberColumnCartesianLayer(columnProvider = columnProvider),
            startAxis = VerticalAxis.rememberStart(),
            bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = labelIndexFormatter(labels)),
        ),
        modelProducer = modelProducer,
        modifier = modifier.fillMaxWidth().height(220.dp),
    )
}

/**
 * Colors each column by the sign of its entry's y value: [positiveColumn] for
 * a net of zero or above, [negativeColumn] for a negative net.
 * [getWidestSeriesColumn] only affects layout sizing (both components share
 * the same thickness), so it can return either one.
 */
private class SignedColumnProvider(
    private val positiveColumn: LineComponent,
    private val negativeColumn: LineComponent,
) : ColumnCartesianLayer.ColumnProvider {
    override fun getColumn(
        entry: ColumnCartesianLayerModel.Entry,
        seriesIndex: Int,
        extraStore: ExtraStore,
    ): LineComponent = if (entry.y >= 0) positiveColumn else negativeColumn

    override fun getWidestSeriesColumn(seriesIndex: Int, extraStore: ExtraStore): LineComponent = positiveColumn
}
