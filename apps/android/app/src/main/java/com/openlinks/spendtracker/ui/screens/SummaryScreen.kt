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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.Transaction
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.Formatting
import com.openlinks.spendtracker.ui.SpendUiState

@Composable
fun SummaryScreen(
    state: SpendUiState,
    onOpenTransaction: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val summary = state.summary
    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SummaryCard(
                label = Strings.get(StringKey.SummaryTotalBalance),
                value = Formatting.money(summary.netTotal, summary.currency),
                modifier = Modifier.weight(1f),
            )
            SummaryCard(
                label = Strings.get(StringKey.SummaryTotalSpend),
                value = Formatting.money(summary.totalSpend, summary.currency),
                modifier = Modifier.weight(1f),
            )
        }
        Row(modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
            SummaryCard(
                label = Strings.get(StringKey.SummaryTransactionCount),
                value = summary.transactionCount.toString(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Text(
            text = Strings.get(StringKey.SummaryRecent),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 24.dp, bottom = 8.dp),
        )
        if (state.transactions.isEmpty()) {
            Text(
                text = Strings.get(StringKey.SummaryEmpty),
                style = MaterialTheme.typography.bodyMedium,
            )
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
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

@Composable
private fun SummaryCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = label, style = MaterialTheme.typography.labelMedium)
            Text(
                text = value,
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(top = 4.dp),
            )
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
