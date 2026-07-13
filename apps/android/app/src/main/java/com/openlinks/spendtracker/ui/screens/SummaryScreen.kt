package com.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.AccountRow
import com.openlinks.spendtracker.data.SeriesRow
import com.openlinks.spendtracker.data.TagRow
import com.openlinks.spendtracker.data.Transaction
import com.openlinks.spendtracker.data.TransactionFilters
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.Formatting
import com.openlinks.spendtracker.ui.SpendUiState
import com.openlinks.spendtracker.ui.accountsForCurrency
import com.openlinks.spendtracker.ui.screens.charts.AccountNetChart
import com.openlinks.spendtracker.ui.screens.charts.IncomeExpenseChart
import com.openlinks.spendtracker.ui.screens.charts.SpendingOverTimeChart
import com.openlinks.spendtracker.ui.screens.charts.TagBarChart
import com.openlinks.spendtracker.ui.seriesForCurrency
import com.openlinks.spendtracker.ui.tagsForCurrency

@Composable
fun SummaryScreen(
    state: SpendUiState,
    onOpenTransaction: (String) -> Unit,
    onUpdateFilters: ((TransactionFilters) -> TransactionFilters) -> Unit,
    onClearFilters: () -> Unit,
    onSetCurrency: (String) -> Unit,
    onSetBucket: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var filtersExpanded by remember { mutableStateOf(false) }
    val chips = activeFilterChips(
        filters = state.filters,
        accountName = { accountId -> state.accountName(accountId) },
        categoryName = { categoryId -> state.categoryName(categoryId) },
    )
    val summary = state.analytics?.summary ?: emptyList()

    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        SearchField(
            query = state.filters.query,
            onQueryChange = { newQuery -> onUpdateFilters { it.copy(query = newQuery) } },
        )
        ActiveFilterChips(
            chips = chips,
            onRemove = { chip -> onUpdateFilters(removeChipTransform(chip)) },
            onClearAll = onClearFilters,
            modifier = Modifier.padding(top = 8.dp),
        )
        FilterPanel(
            state = state,
            onUpdateFilters = onUpdateFilters,
            expanded = filtersExpanded,
            onToggle = { filtersExpanded = !filtersExpanded },
            modifier = Modifier.padding(top = 8.dp),
        )

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            BucketToggle(bucket = state.bucket, onChange = onSetBucket)
            CurrencySwitcher(
                currencies = currenciesIn(summary),
                value = state.displayCurrency,
                onChange = onSetCurrency,
            )
        }

        SummaryTiles(
            summary = summary,
            currency = state.displayCurrency,
            modifier = Modifier.padding(top = 12.dp),
        )

        val chartRows = seriesForCurrency(state.analytics?.series ?: emptyList(), state.displayCurrency)
        val tagRows = tagsForCurrency(state.analytics?.byTag ?: emptyList(), state.displayCurrency)
        val accountRows = accountsForCurrency(state.analytics?.byAccount ?: emptyList(), state.displayCurrency)

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(top = 8.dp),
        ) {
            item {
                ChartsSection(
                    seriesRows = chartRows,
                    tagRows = tagRows,
                    accountRows = accountRows,
                    accountName = { accountId -> state.accountName(accountId) },
                )
            }
            item {
                Text(
                    text = Strings.get(StringKey.SummaryRecent),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 16.dp, bottom = 8.dp),
                )
            }
            if (state.transactions.isEmpty()) {
                item {
                    Text(
                        text = Strings.get(StringKey.SummaryEmpty),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            } else {
                items(state.transactions.take(5)) { transaction ->
                    RecentRow(
                        transaction = transaction,
                        categoryName = state.categoryName(transaction.categoryId),
                        onClick = { onOpenTransaction(transaction.id) },
                    )
                }
            }
        }
    }
}

/**
 * The analytics charts area: spending-over-time, income-vs-expense, spend-by-tag
 * and net-by-account, each in a titled card. All row lists are already filtered
 * to the display currency by the caller.
 */
@Composable
private fun ChartsSection(
    seriesRows: List<SeriesRow>,
    tagRows: List<TagRow>,
    accountRows: List<AccountRow>,
    accountName: (String) -> String?,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = Strings.get(StringKey.ChartsTitle),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 16.dp),
        )
        ChartCard(title = Strings.get(StringKey.ChartSpendingOverTime)) {
            SpendingOverTimeChart(rows = seriesRows)
        }
        ChartCard(title = Strings.get(StringKey.ChartIncomeVsExpense)) {
            IncomeExpenseChart(rows = seriesRows)
        }
        ChartCard(title = Strings.get(StringKey.ChartTagBreakdown)) {
            TagBarChart(rows = tagRows)
        }
        ChartCard(title = Strings.get(StringKey.ChartNetByAccount)) {
            AccountNetChart(rows = accountRows, accountName = accountName)
        }
    }
}

@Composable
private fun ChartCard(title: String, content: @Composable () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(bottom = 12.dp),
            )
            content()
        }
    }
}

@Composable
private fun RecentRow(transaction: Transaction, categoryName: String?, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = transaction.description,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (categoryName != null) {
                    Text(text = categoryName, style = MaterialTheme.typography.bodySmall)
                }
            }
            Text(
                text = Formatting.money(transaction.amount, transaction.currency),
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}
