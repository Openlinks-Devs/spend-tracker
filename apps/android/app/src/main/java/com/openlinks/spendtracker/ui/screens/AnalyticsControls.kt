package com.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.SummaryRow
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.Formatting

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
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SummaryTile(
            label = Strings.get(StringKey.SummaryIncome),
            value = Formatting.money(row?.income ?: 0.0, currencyLabel),
            modifier = Modifier.weight(1f),
        )
        SummaryTile(
            label = Strings.get(StringKey.SummarySpend),
            value = Formatting.money(row?.spend ?: 0.0, currencyLabel),
            modifier = Modifier.weight(1f),
        )
        SummaryTile(
            label = Strings.get(StringKey.SummaryNet),
            value = Formatting.money(row?.net ?: 0.0, currencyLabel),
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun SummaryTile(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = label, style = MaterialTheme.typography.labelMedium)
            Text(
                text = value,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

/**
 * Dropdown that switches the display currency among [currencies]. Renders
 * nothing when there is only one currency (or none) to switch between, since
 * a switcher is meaningless with a single option.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CurrencySwitcher(
    currencies: List<String>,
    value: String?,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (currencies.size <= 1) return

    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = value ?: "",
            onValueChange = {},
            readOnly = true,
            label = { Text(Strings.get(StringKey.CurrencyLabel)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
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
