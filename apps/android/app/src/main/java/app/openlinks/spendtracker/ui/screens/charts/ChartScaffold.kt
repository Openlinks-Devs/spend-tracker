package app.openlinks.spendtracker.ui.screens.charts

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings
import app.openlinks.spendtracker.ui.Formatting
import com.patrykandpatrick.vico.core.cartesian.data.CartesianValueFormatter

/**
 * The empty-state shown by every chart instead of an empty Vico chart, so a
 * chart with no rows never has to build a Vico model (and therefore cannot
 * crash by handing Vico zero entries).
 */
@Composable
fun ChartEmptyState(modifier: Modifier = Modifier) {
    Text(
        text = Strings.get(StringKey.ChartNoData),
        style = MaterialTheme.typography.bodyMedium,
        modifier = modifier,
    )
}

/**
 * A bottom-axis [CartesianValueFormatter] that maps a Vico entry index to the
 * matching entry of [labels] (built by the caller from the same rows used to
 * populate the chart model, so index i in the model lines up with labels[i]).
 * Returns "" for an out-of-range index instead of throwing.
 */
fun labelIndexFormatter(labels: List<String>): CartesianValueFormatter =
    CartesianValueFormatter { _, value, _ -> labels.getOrNull(value.toInt()) ?: "" }

/**
 * A value-axis [CartesianValueFormatter] that prints money in [currency] instead of
 * Vico's raw decimals. Every chart's value axis uses it, because the summary tiles
 * and transaction rows on the same screen print formatted money and an axis reading
 * "37636.219999999994" beside them is the same number told badly.
 *
 * [Formatting.compactMoney], not [Formatting.money]: the axis gutter is narrow, so
 * full amounts either clip or steal width from the plot. A null [currency] (no rows
 * to read one off) formats the number with no symbol rather than failing.
 */
fun moneyValueFormatter(currency: String?): CartesianValueFormatter =
    CartesianValueFormatter { _, value, _ -> Formatting.compactMoney(value, currency.orEmpty()) }
