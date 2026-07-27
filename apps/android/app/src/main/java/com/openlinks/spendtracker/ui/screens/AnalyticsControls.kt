package com.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.SummaryRow
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.Formatting
import com.openlinks.spendtracker.ui.theme.MoneyColors

/**
 * The distinct currencies present in [summary], in first-seen order. Pure and
 * unit tested: drives the [CurrencySwitcher] options.
 */
fun currenciesIn(summary: List<SummaryRow>): List<String> = summary.map { row -> row.currency }.distinct()

/**
 * The summary row for [currency], or null when [summary] has no row for it
 * (including when [currency] itself is null). Pure and unit tested.
 */
fun summaryRowFor(summary: List<SummaryRow>, currency: String?): SummaryRow? =
    summary.firstOrNull { row -> row.currency == currency }

/**
 * Income / spend / net tiles for [currency], derived from the analytics
 * [summary]. No transaction-count tile (removed to match the web dashboard).
 * When [summary] has no row for [currency], all tiles show zero.
 */
@Composable
fun SummaryTiles(summary: List<SummaryRow>, currency: String?, modifier: Modifier = Modifier) {
    val row = summaryRowFor(summary, currency)
    val currencyLabel = currency ?: ""
    val income = row?.income ?: 0.0
    val spend = row?.spend ?: 0.0
    val net = row?.net ?: 0.0
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Income and spend are always the same sign by definition, so their color
        // is fixed; only net earns its color from the number.
        SummaryTile(
            label = Strings.get(StringKey.SummaryIncome),
            value = Formatting.money(income, currencyLabel),
            valueColor = MoneyColors.income(),
            modifier = Modifier.weight(1f),
        )
        SummaryTile(
            label = Strings.get(StringKey.SummarySpend),
            value = Formatting.money(spend, currencyLabel),
            valueColor = MoneyColors.expense(),
            modifier = Modifier.weight(1f),
        )
        SummaryTile(
            label = Strings.get(StringKey.SummaryNet),
            value = Formatting.money(net, currencyLabel),
            valueColor = MoneyColors.forAmount(net),
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun SummaryTile(
    label: String,
    value: String,
    valueColor: Color,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = modifier,
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 14.dp)) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = value,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = valueColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}

/**
 * Dropdown that switches the display currency among [currencies]. Renders
 * nothing when there is only one currency (or none) to switch between, since
 * a switcher is meaningless with a single option.
 */
@Composable
fun CurrencySwitcher(
    currencies: List<String>,
    value: String?,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (currencies.size <= 1) return

    // A labelled text field is far too heavy for a three-letter toggle: it used
    // to be tall enough to overlap the bucket chips sitting beside it. An assist
    // chip is the same control at a fraction of the footprint.
    var expanded by remember { mutableStateOf(false) }
    Box(modifier = modifier) {
        AssistChip(
            onClick = { expanded = true },
            label = { Text(value ?: Strings.get(StringKey.CurrencyLabel)) },
            trailingIcon = { Icon(Icons.Filled.ArrowDropDown, contentDescription = null) },
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            currencies.forEach { currencyOption ->
                DropdownMenuItem(
                    text = { Text(currencyOption) },
                    onClick = {
                        onChange(currencyOption)
                        expanded = false
                    },
                )
            }
        }
    }
}

private val bucketOptions: List<Pair<String, StringKey>> = listOf(
    "day" to StringKey.BucketDay,
    "week" to StringKey.BucketWeek,
    "month" to StringKey.BucketMonth,
)

/** Day / week / month segmented toggle for the analytics bucket granularity. */
@Composable
fun BucketToggle(bucket: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        bucketOptions.forEach { (bucketValue, labelKey) ->
            FilterChip(
                selected = bucket == bucketValue,
                onClick = { onChange(bucketValue) },
                label = { Text(Strings.get(labelKey)) },
            )
        }
    }
}
