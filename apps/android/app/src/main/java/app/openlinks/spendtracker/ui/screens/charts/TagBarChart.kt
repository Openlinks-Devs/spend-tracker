package app.openlinks.spendtracker.ui.screens.charts

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.openlinks.spendtracker.data.TagRow
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings
import app.openlinks.spendtracker.ui.tagBars
import app.openlinks.spendtracker.ui.theme.rememberChartTheme
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
import com.patrykandpatrick.vico.core.cartesian.data.ColumnCartesianLayerModel
import com.patrykandpatrick.vico.core.cartesian.data.columnSeries
import com.patrykandpatrick.vico.core.cartesian.layer.ColumnCartesianLayer
import com.patrykandpatrick.vico.core.common.component.LineComponent
import com.patrykandpatrick.vico.core.common.data.ExtraStore
import kotlin.math.roundToInt

private const val MAX_TAG_BARS = 8

/**
 * A column chart of spend per tag, ranked and capped at [MAX_TAG_BARS] bars to stay
 * readable. The cap used to be a plain `take(8)` that dropped tags 9+ with no
 * indication at all; they are now folded into one trailing "Other tags" bar, so the
 * chart still adds up to what the user spent.
 *
 * The bars are ONE colour, not a rainbow: the bottom axis already names each tag, so
 * a per-bar hue would imply a distinction that does not exist. That colour is
 * identity slot 0, NOT the blue this chart used to use - blue is reserved for the
 * income pole, so a blue tag bar read as an income series. The folded bar takes the
 * neutral "other" token, matching the donut. The value axis prints formatted money.
 * Renders an empty-state Text (never an empty chart) when there is no data.
 */
@Composable
fun TagBarChart(rows: List<TagRow>, modifier: Modifier = Modifier) {
    if (rows.isEmpty()) {
        ChartEmptyState(modifier)
        return
    }

    val otherLabel = Strings.get(StringKey.ChartOtherTags)
    val bars = remember(rows, otherLabel) { tagBars(rows, MAX_TAG_BARS, otherLabel) }
    val modelProducer = remember { CartesianChartModelProducer() }
    LaunchedEffect(bars) {
        modelProducer.runTransaction {
            columnSeries { series(bars.map { bar -> bar.value }) }
        }
    }

    val labels = bars.map { bar -> bar.label }
    val currency = rows.firstOrNull()?.currency
    val chartTheme = rememberChartTheme()

    val tagColumn = rememberLineComponent(fill = fill(chartTheme.palette[0]), thickness = 12.dp)
    val otherColumn = rememberLineComponent(fill = fill(chartTheme.other), thickness = 12.dp)
    // The folded bar is the only one that is not a real tag, and it is always last
    // (withOtherBucket appends it), so its column index is what tells it apart.
    val otherIndex = bars.indexOfFirst { bar -> bar.colorIndex == null }
    val columnProvider = remember(tagColumn, otherColumn, otherIndex) {
        IndexedColumnProvider(
            defaultColumn = tagColumn,
            exceptionColumn = otherColumn,
            exceptionIndex = otherIndex,
        )
    }

    CartesianChartHost(
        chart = rememberCartesianChart(
            rememberColumnCartesianLayer(
                columnProvider = columnProvider,
                // Spend is never negative, so the baseline belongs at zero;
                // auto-ranging would hide every column shorter than the tallest.
                rangeProvider = CartesianLayerRangeProvider.fixed(minY = 0.0),
            ),
            startAxis = VerticalAxis.rememberStart(valueFormatter = moneyValueFormatter(currency)),
            bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = labelIndexFormatter(labels)),
        ),
        modelProducer = modelProducer,
        modifier = modifier.fillMaxWidth().height(220.dp),
    )
}

/**
 * Paints every column [defaultColumn] except the one at [exceptionIndex], which gets
 * [exceptionColumn]. Vico's built-in `ColumnProvider.series` picks a component per
 * SERIES index, and this is a single-series chart where one entry differs, so the
 * choice has to be made per entry. An [exceptionIndex] of -1 means "no exception".
 * [getWidestSeriesColumn] only affects layout sizing (both components share the same
 * thickness), so it can return either one.
 */
private class IndexedColumnProvider(
    private val defaultColumn: LineComponent,
    private val exceptionColumn: LineComponent,
    private val exceptionIndex: Int,
) : ColumnCartesianLayer.ColumnProvider {
    override fun getColumn(
        entry: ColumnCartesianLayerModel.Entry,
        seriesIndex: Int,
        extraStore: ExtraStore,
    ): LineComponent =
        if (entry.x.roundToInt() == exceptionIndex) exceptionColumn else defaultColumn

    override fun getWidestSeriesColumn(seriesIndex: Int, extraStore: ExtraStore): LineComponent = defaultColumn
}
