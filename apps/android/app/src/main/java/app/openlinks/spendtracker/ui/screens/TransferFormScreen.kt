package app.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.openlinks.spendtracker.data.Category
import app.openlinks.spendtracker.data.TransferInput
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings
import app.openlinks.spendtracker.ui.SpendUiState
import app.openlinks.spendtracker.ui.TransferFormInput
import app.openlinks.spendtracker.ui.TransferFormResult
import app.openlinks.spendtracker.ui.TransferFormValidator

// A transfer defaults its two legs to the "Balance" categories: money leaves the
// source under "Balance -" and lands in the destination under "Balance +".
private const val OUT_CATEGORY_NAME = "Balance -"
private const val IN_CATEGORY_NAME = "Balance +"

private const val DEFAULT_TRANSFER_TAG = "transfer"

/** The category the given leg defaults to: the named Balance one, else the first. */
fun defaultTransferCategoryId(categories: List<Category>, name: String): String? =
    categories.firstOrNull { category -> category.name == name }?.id ?: categories.firstOrNull()?.id

/** One side of the move: a labelled container for its account, amount and category. */
@Composable
private fun TransferLegCard(label: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            content()
        }
    }
}

/**
 * Moves money between two accounts. Both legs are editable because a transfer can
 * cross currencies (exchange) or lose a cut on the way (fees), so the amount that
 * lands is not always the amount that left.
 */
@Composable
fun TransferFormScreen(
    state: SpendUiState,
    onSubmit: (TransferInput) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val accounts = state.accounts
    val categories = state.categories

    var fromAccountId by remember { mutableStateOf(accounts.firstOrNull()?.id) }
    var toAccountId by remember {
        mutableStateOf(accounts.getOrNull(1)?.id ?: accounts.firstOrNull()?.id)
    }
    var fromAmount by remember { mutableStateOf("") }
    var toAmount by remember { mutableStateOf("") }
    var fromCategoryId by remember {
        mutableStateOf(defaultTransferCategoryId(categories, OUT_CATEGORY_NAME))
    }
    var toCategoryId by remember {
        mutableStateOf(defaultTransferCategoryId(categories, IN_CATEGORY_NAME))
    }
    var description by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf(DEFAULT_TRANSFER_TAG) }
    var errors by remember { mutableStateOf<List<StringKey>>(emptyList()) }
    // Once the received amount is edited by hand, stop mirroring the sent amount
    // into it (same-currency transfers usually match; fees and exchange do not).
    var receivedEdited by remember { mutableStateOf(false) }

    // The screen may compose before refresh() populates accounts/categories, and
    // remember seeds defaults only once, so fill them in when the data lands.
    LaunchedEffect(accounts) {
        if (fromAccountId == null) fromAccountId = accounts.firstOrNull()?.id
        if (toAccountId == null) toAccountId = accounts.getOrNull(1)?.id ?: accounts.firstOrNull()?.id
    }
    LaunchedEffect(categories) {
        if (fromCategoryId == null) fromCategoryId = defaultTransferCategoryId(categories, OUT_CATEGORY_NAME)
        if (toCategoryId == null) toCategoryId = defaultTransferCategoryId(categories, IN_CATEGORY_NAME)
    }

    val fromAccount = accounts.firstOrNull { account -> account.id == fromAccountId }
    val toAccount = accounts.firstOrNull { account -> account.id == toAccountId }
    val sameCurrency = fromAccount?.currency == toAccount?.currency

    fun amountLabel(labelKey: StringKey, currency: String?): String =
        if (currency.isNullOrBlank()) Strings.get(labelKey) else "${Strings.get(labelKey)} ($currency)"

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = Strings.get(StringKey.TransferSubtitle),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // The currency is part of the label: it is what tells the user whether the
        // two amount fields are an exchange or a plain same-currency move.
        val accountOptions = accounts.map { account -> account.id to "${account.name} (${account.currency})" }
        val categoryOptions = categories.map { category -> category.id to category.name }

        // Grouped as the two legs of the move rather than as eight loose fields,
        // so "what leaves" and "what lands" read as a pair.
        TransferLegCard(label = Strings.get(StringKey.TransferLegOut)) {
            LabeledDropdown(
                label = Strings.get(StringKey.TransferFromAccount),
                selectedId = fromAccountId,
                options = accountOptions,
                onSelect = { accountId -> fromAccountId = accountId },
            )
            OutlinedTextField(
                value = fromAmount,
                onValueChange = { newAmount ->
                    fromAmount = newAmount
                    if (!receivedEdited && sameCurrency) toAmount = newAmount
                },
                label = { Text(amountLabel(StringKey.TransferAmountSent, fromAccount?.currency)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            LabeledDropdown(
                label = Strings.get(StringKey.TransferCategoryOut),
                selectedId = fromCategoryId,
                options = categoryOptions,
                onSelect = { categoryId -> fromCategoryId = categoryId },
            )
        }

        Icon(
            imageVector = Icons.Filled.ArrowDownward,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        )

        TransferLegCard(label = Strings.get(StringKey.TransferLegIn)) {
            LabeledDropdown(
                label = Strings.get(StringKey.TransferToAccount),
                selectedId = toAccountId,
                options = accountOptions,
                onSelect = { accountId -> toAccountId = accountId },
            )
            OutlinedTextField(
                value = toAmount,
                onValueChange = { newAmount ->
                    receivedEdited = true
                    toAmount = newAmount
                },
                label = { Text(amountLabel(StringKey.TransferAmountReceived, toAccount?.currency)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            LabeledDropdown(
                label = Strings.get(StringKey.TransferCategoryIn),
                selectedId = toCategoryId,
                options = categoryOptions,
                onSelect = { categoryId -> toCategoryId = categoryId },
            )
        }

        OutlinedTextField(
            value = description,
            onValueChange = { newDescription -> description = newDescription },
            label = { Text(Strings.get(StringKey.TransferDescriptionOptional)) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        OutlinedTextField(
            value = tags,
            onValueChange = { newTags -> tags = newTags },
            label = { Text(Strings.get(StringKey.FieldTags)) },
            placeholder = { Text(Strings.get(StringKey.TagsHint)) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        errors.forEach { errorKey ->
            Text(
                text = Strings.get(errorKey),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
        state.error?.let { errorMessage ->
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedButton(onClick = onCancel, modifier = Modifier.weight(1f)) {
                Text(Strings.get(StringKey.ActionCancel))
            }
            Button(
                onClick = {
                    val result = TransferFormValidator.validate(
                        TransferFormInput(
                            fromAccountId = fromAccountId,
                            toAccountId = toAccountId,
                            fromAmount = fromAmount,
                            toAmount = toAmount,
                            fromCategoryId = fromCategoryId,
                            toCategoryId = toCategoryId,
                            description = description,
                            tags = tags,
                        ),
                        accounts,
                    )
                    when (result) {
                        is TransferFormResult.Invalid -> errors = result.errors
                        is TransferFormResult.Valid -> {
                            errors = emptyList()
                            onSubmit(result.value)
                        }
                    }
                },
                modifier = Modifier.weight(1f),
            ) {
                Text(Strings.get(StringKey.ActionCreateTransfer))
            }
        }
    }
}
