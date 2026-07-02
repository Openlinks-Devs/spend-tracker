package com.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.openlinks.spendtracker.data.Account
import com.openlinks.spendtracker.data.Category
import com.openlinks.spendtracker.data.NewTransaction
import com.openlinks.spendtracker.data.Transaction
import com.openlinks.spendtracker.data.TransactionUpdate
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.FormResult
import com.openlinks.spendtracker.ui.SpendUiState
import com.openlinks.spendtracker.ui.TransactionFormInput
import com.openlinks.spendtracker.ui.TransactionFormValidator

/**
 * Create/edit form. When [editingId] resolves to an existing transaction the
 * form is pre-filled and submits a PATCH; otherwise it POSTs a new transaction.
 */
@Composable
fun TransactionFormScreen(
    editingId: String?,
    state: SpendUiState,
    onSubmitCreate: (NewTransaction) -> Unit,
    onSubmitUpdate: (String, TransactionUpdate) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val existing: Transaction? = editingId?.let { state.transactionById(it) }

    var description by remember { mutableStateOf(existing?.description ?: "") }
    var amount by remember { mutableStateOf(existing?.amount?.toString() ?: "") }
    var currency by remember { mutableStateOf(existing?.currency ?: "USD") }
    var accountId by remember { mutableStateOf(existing?.accountId ?: state.accounts.firstOrNull()?.id) }
    var categoryId by remember { mutableStateOf(existing?.categoryId ?: state.categories.firstOrNull()?.id) }
    var tags by remember { mutableStateOf(existing?.tags?.joinToString(", ") ?: "") }
    var errors by remember { mutableStateOf<List<StringKey>>(emptyList()) }

    // The form may compose before refresh() populates accounts/categories. remember
    // captures defaults only once, so seed them when the data arrives, but only if
    // the user has not already chosen (preserves in-progress edits).
    LaunchedEffect(state.accounts) {
        if (accountId == null) accountId = state.accounts.firstOrNull()?.id
    }
    LaunchedEffect(state.categories) {
        if (categoryId == null) categoryId = state.categories.firstOrNull()?.id
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = Strings.get(if (existing == null) StringKey.FormCreateTitle else StringKey.FormEditTitle),
            style = MaterialTheme.typography.titleLarge,
        )

        OutlinedTextField(
            value = description,
            onValueChange = { description = it },
            label = { Text(Strings.get(StringKey.FieldDescription)) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        // Amount and currency cannot change on edit (backend PATCH ignores them),
        // so they are disabled when editing an existing transaction.
        OutlinedTextField(
            value = amount,
            onValueChange = { amount = it },
            label = { Text(Strings.get(StringKey.FieldAmount)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            enabled = existing == null,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        OutlinedTextField(
            value = currency,
            onValueChange = { currency = it },
            label = { Text(Strings.get(StringKey.FieldCurrency)) },
            enabled = existing == null,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        AccountPicker(
            accounts = state.accounts,
            selectedId = accountId,
            enabled = existing == null,
            onSelect = { accountId = it },
        )

        CategoryPicker(
            categories = state.categories,
            selectedId = categoryId,
            onSelect = { categoryId = it },
        )

        OutlinedTextField(
            value = tags,
            onValueChange = { tags = it },
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

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedButton(onClick = onCancel, modifier = Modifier.weight(1f)) {
                Text(Strings.get(StringKey.ActionCancel))
            }
            Button(
                onClick = {
                    val result = TransactionFormValidator.validate(
                        TransactionFormInput(
                            description = description,
                            amount = amount,
                            currency = currency,
                            accountId = accountId,
                            categoryId = categoryId,
                            tags = tags,
                        ),
                    )
                    when (result) {
                        is FormResult.Invalid -> errors = result.errors
                        is FormResult.Valid -> {
                            errors = emptyList()
                            val valid = result.value
                            if (existing == null) {
                                onSubmitCreate(
                                    NewTransaction(
                                        description = valid.description,
                                        amount = valid.amount,
                                        currency = valid.currency,
                                        accountId = valid.accountId,
                                        categoryId = valid.categoryId,
                                        tags = valid.tags,
                                    ),
                                )
                            } else {
                                onSubmitUpdate(
                                    existing.id,
                                    TransactionUpdate(
                                        description = valid.description,
                                        categoryId = valid.categoryId,
                                        tags = valid.tags,
                                    ),
                                )
                            }
                        }
                    }
                },
                modifier = Modifier.weight(1f),
            ) {
                Text(Strings.get(StringKey.ActionSave))
            }
        }
    }
}

@Composable
private fun AccountPicker(
    accounts: List<Account>,
    selectedId: String?,
    enabled: Boolean,
    onSelect: (String) -> Unit,
) {
    val selectedLabel = accounts.firstOrNull { account -> account.id == selectedId }?.name ?: ""
    LabeledDropdown(
        label = Strings.get(StringKey.FieldAccount),
        selectedLabel = selectedLabel,
        enabled = enabled,
        options = accounts.map { account -> account.id to account.name },
        onSelect = onSelect,
    )
}

@Composable
private fun CategoryPicker(
    categories: List<Category>,
    selectedId: String?,
    onSelect: (String) -> Unit,
) {
    // Category is required, so no null "None" option.
    val selectedLabel = categories.firstOrNull { category -> category.id == selectedId }?.name ?: ""
    LabeledDropdown(
        label = Strings.get(StringKey.FieldCategory),
        selectedLabel = selectedLabel,
        enabled = true,
        options = categories.map { category -> category.id to category.name },
        onSelect = onSelect,
    )
}

@Composable
private fun LabeledDropdown(
    label: String,
    selectedLabel: String,
    enabled: Boolean,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit,
) {
    LabeledDropdownNullable(
        label = label,
        selectedLabel = selectedLabel,
        enabled = enabled,
        options = options.map { option -> option.first as String? to option.second },
        onSelect = { id -> if (id != null) onSelect(id) },
    )
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun LabeledDropdownNullable(
    label: String,
    selectedLabel: String,
    enabled: Boolean,
    options: List<Pair<String?, String>>,
    onSelect: (String?) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { if (enabled) expanded = it },
    ) {
        OutlinedTextField(
            value = selectedLabel,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(androidx.compose.material3.MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (id, optionLabel) ->
                DropdownMenuItem(
                    text = { Text(optionLabel) },
                    onClick = {
                        onSelect(id)
                        expanded = false
                    },
                )
            }
        }
    }
}
