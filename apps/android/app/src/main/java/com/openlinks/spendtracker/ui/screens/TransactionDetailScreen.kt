package com.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.Transaction
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.Formatting
import com.openlinks.spendtracker.ui.SpendUiState
import com.openlinks.spendtracker.ui.theme.MoneyColors

@Composable
fun TransactionDetailScreen(
    transactionId: String,
    state: SpendUiState,
    onEdit: (String) -> Unit,
    onDuplicate: (String) -> Unit,
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
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // The amount is the headline, not the description: it is what the user
        // opened this screen to check.
        Column {
            Text(
                text = Formatting.money(transaction.amount, transaction.currency),
                style = MaterialTheme.typography.displaySmall,
                fontWeight = FontWeight.SemiBold,
                color = MoneyColors.forAmount(transaction.amount),
            )
            Text(
                text = transaction.description,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column {
                DetailRow(
                    label = Strings.get(StringKey.FieldAccount),
                    value = state.accountName(transaction.accountId) ?: transaction.accountId,
                )
                DetailDivider()
                DetailRow(
                    label = Strings.get(StringKey.FieldCategory),
                    value = state.categoryName(transaction.categoryId) ?: Strings.get(StringKey.FieldNone),
                )
                DetailDivider()
                DetailRow(
                    label = Strings.get(StringKey.FieldTags),
                    value = transaction.tags.takeIf { tags -> tags.isNotEmpty() }?.joinToString(", ")
                        ?: Strings.get(StringKey.FieldNone),
                )
                DetailDivider()
                DetailRow(
                    label = Strings.get(StringKey.FieldCreatedAt),
                    value = Formatting.dateTime(transaction.createdAt),
                )
                transaction.updatedAt?.let { updatedAt ->
                    DetailDivider()
                    DetailRow(
                        label = Strings.get(StringKey.FieldUpdatedAt),
                        value = Formatting.dateTime(updatedAt),
                    )
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(onClick = { onEdit(transaction.id) }, modifier = Modifier.weight(1f)) {
                Text(text = Strings.get(StringKey.ActionEdit))
            }
            OutlinedButton(onClick = { onDuplicate(transaction.id) }, modifier = Modifier.weight(1f)) {
                Text(text = Strings.get(StringKey.ActionDuplicate))
            }
        }
        // Destructive, so it is separated from the two safe actions and colored
        // as an error rather than sitting in the same row looking equivalent.
        OutlinedButton(
            onClick = { onDelete(transaction.id) },
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = MaterialTheme.colorScheme.error,
            ),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(text = Strings.get(StringKey.ActionDelete))
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(start = 16.dp),
        )
    }
}

@Composable
private fun DetailDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = 16.dp),
        color = MaterialTheme.colorScheme.outlineVariant,
    )
}
