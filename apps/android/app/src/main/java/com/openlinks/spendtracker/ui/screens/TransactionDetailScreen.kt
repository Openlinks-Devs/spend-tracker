package com.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.Transaction
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.Formatting
import com.openlinks.spendtracker.ui.SpendUiState

@Composable
fun TransactionDetailScreen(
    transactionId: String,
    state: SpendUiState,
    onEdit: (String) -> Unit,
    onDelete: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val transaction: Transaction? = state.transactionById(transactionId)
    if (transaction == null) {
        Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
            Text(text = Strings.get(StringKey.ErrorGeneric))
        }
        return
    }

    Column(
        modifier = modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = transaction.description,
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = Formatting.money(transaction.amount, transaction.currency),
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.primary,
        )
        DetailField(Strings.get(StringKey.FieldAccount), state.accountName(transaction.accountId) ?: transaction.accountId)
        DetailField(
            Strings.get(StringKey.FieldCategory),
            state.categoryName(transaction.categoryId) ?: Strings.get(StringKey.FieldNone),
        )
        DetailField(
            Strings.get(StringKey.FieldTags),
            transaction.tags.takeIf { it.isNotEmpty() }?.joinToString(", ")
                ?: Strings.get(StringKey.FieldNone),
        )
        DetailField(Strings.get(StringKey.FieldCreatedAt), transaction.createdAt)
        DetailField(
            Strings.get(StringKey.FieldUpdatedAt),
            transaction.updatedAt ?: Strings.get(StringKey.FieldNone),
        )

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Button(onClick = { onEdit(transaction.id) }, modifier = Modifier.weight(1f)) {
                Text(text = Strings.get(StringKey.ActionEdit))
            }
            OutlinedButton(onClick = { onDelete(transaction.id) }, modifier = Modifier.weight(1f)) {
                Text(text = Strings.get(StringKey.ActionDelete))
            }
        }
    }
}

@Composable
private fun DetailField(label: String, value: String) {
    Column {
        Text(text = label, style = MaterialTheme.typography.labelMedium)
        Text(text = value, style = MaterialTheme.typography.bodyLarge)
    }
}
