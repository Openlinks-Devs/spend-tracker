package app.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.openlinks.spendtracker.data.Transaction
import app.openlinks.spendtracker.data.TransactionFilters
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings
import app.openlinks.spendtracker.ui.Formatting
import app.openlinks.spendtracker.ui.SpendUiState
import app.openlinks.spendtracker.ui.groupTransactionsByDay
import app.openlinks.spendtracker.ui.theme.MoneyColors
import java.time.LocalDate

// Clears the floating action button, which would otherwise sit on top of the
// last row's amount.
private val LIST_BOTTOM_INSET = 96.dp

@Composable
fun TransactionsListScreen(
    state: SpendUiState,
    onOpenTransaction: (String) -> Unit,
    onUpdateFilters: ((TransactionFilters) -> TransactionFilters) -> Unit,
    onClearFilters: () -> Unit,
    onSetCurrency: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var filtersExpanded by remember { mutableStateOf(false) }
    val chips = activeFilterChips(
        filters = state.filters,
        accountName = { accountId -> state.accountName(accountId) },
        categoryName = { categoryId -> state.categoryName(categoryId) },
    )
    val groups = remember(state.transactions) {
        groupTransactionsByDay(state.transactions, LocalDate.now())
    }

    Column(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SearchField(
                query = state.filters.query,
                onQueryChange = { newQuery -> onUpdateFilters { it.copy(query = newQuery) } },
            )
            ActiveFilterChips(
                chips = chips,
                onRemove = { chip -> onUpdateFilters(removeChipTransform(chip)) },
                onClearAll = onClearFilters,
            )
            FilterPanel(
                state = state,
                onUpdateFilters = onUpdateFilters,
                onSetCurrency = onSetCurrency,
                expanded = filtersExpanded,
                onToggle = { filtersExpanded = !filtersExpanded },
            )
        }

        Box(modifier = Modifier.fillMaxSize()) {
            when {
                state.loading && state.transactions.isEmpty() -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
                state.error != null && state.transactions.isEmpty() -> {
                    Text(
                        text = state.error,
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.align(Alignment.Center).padding(32.dp),
                    )
                }
                state.transactions.isEmpty() -> {
                    Text(
                        text = Strings.get(StringKey.TransactionsEmpty),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.align(Alignment.Center).padding(32.dp),
                    )
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = 16.dp,
                            end = 16.dp,
                            bottom = LIST_BOTTOM_INSET,
                        ),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        groups.forEach { group ->
                            item(key = "header-${group.heading}") {
                                DayHeader(
                                    heading = group.heading,
                                    netByCurrency = group.netByCurrency,
                                )
                            }
                            item(key = "group-${group.heading}") {
                                DayCard(
                                    transactions = group.transactions,
                                    state = state,
                                    onOpenTransaction = onOpenTransaction,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DayHeader(heading: String, netByCurrency: List<Pair<String, Double>>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 16.dp, bottom = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = heading,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = netByCurrency.joinToString("  ") { (currency, net) -> Formatting.money(net, currency) },
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** One rounded card per day, with hairline dividers instead of a gap per row. */
@Composable
private fun DayCard(
    transactions: List<Transaction>,
    state: SpendUiState,
    onOpenTransaction: (String) -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            transactions.forEachIndexed { index, transaction ->
                if (index > 0) {
                    HorizontalDivider(
                        modifier = Modifier.padding(start = 16.dp),
                        color = MaterialTheme.colorScheme.outlineVariant,
                    )
                }
                TransactionRow(
                    transaction = transaction,
                    categoryName = state.categoryName(transaction.categoryId),
                    accountName = state.accountName(transaction.accountId),
                    onClick = { onOpenTransaction(transaction.id) },
                )
            }
        }
    }
}

@Composable
private fun TransactionRow(
    transaction: Transaction,
    categoryName: String?,
    accountName: String?,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(
                text = transaction.description,
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val subtitle = listOfNotNull(accountName, categoryName).joinToString(" · ")
            if (subtitle.isNotEmpty()) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Text(
            text = Formatting.money(transaction.amount, transaction.currency),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
            color = MoneyColors.forAmount(transaction.amount),
            maxLines = 1,
        )
    }
}
