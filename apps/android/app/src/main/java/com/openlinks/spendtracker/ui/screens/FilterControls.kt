package com.openlinks.spendtracker.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.openlinks.spendtracker.data.TransactionFilters
import com.openlinks.spendtracker.i18n.StringKey
import com.openlinks.spendtracker.i18n.Strings
import com.openlinks.spendtracker.ui.SpendUiState
import kotlinx.coroutines.delay

/** The removable active-filter chip model and its kind. Pure data, unit tested. */
enum class FilterChipKind { QUERY, RANGE, TYPE, ACCOUNT, CATEGORY, TAG, MIN, MAX }

data class ActiveFilterChip(val kind: FilterChipKind, val value: String, val label: String)

/** The selectable date-range presets, in display order. */
private val rangePresets: List<Pair<String, StringKey>> = listOf(
    "this-month" to StringKey.RangeThisMonth,
    "last-3-months" to StringKey.RangeLast3Months,
    "this-year" to StringKey.RangeThisYear,
    "all" to StringKey.RangeAllTime,
)

private const val DEFAULT_RANGE = "this-month"
private const val TYPE_ALL = "all"

private fun rangeLabel(range: String): String {
    val key = rangePresets.firstOrNull { (code, _) -> code == range }?.second
    return if (key != null) Strings.get(key) else range
}

private fun typeLabel(type: String): String = when (type) {
    "income" -> Strings.get(StringKey.FilterTypeIncome)
    "expense" -> Strings.get(StringKey.FilterTypeExpense)
    else -> Strings.get(StringKey.FilterTypeAll)
}

/**
 * Maps the active [filters] to the removable chips shown above the list. Pure so it
 * can be unit tested: account/category display names are resolved through the
 * provided lookups (falling back to the raw id when unknown). The default `range`
 * (`this-month`) and `type` (`all`) are omitted since they are not active filters.
 */
fun activeFilterChips(
    filters: TransactionFilters,
    accountName: (String) -> String?,
    categoryName: (String) -> String?,
): List<ActiveFilterChip> {
    val chips = mutableListOf<ActiveFilterChip>()

    if (filters.query.isNotBlank()) {
        chips += ActiveFilterChip(FilterChipKind.QUERY, filters.query, filters.query)
    }
    if (filters.range != DEFAULT_RANGE) {
        chips += ActiveFilterChip(FilterChipKind.RANGE, filters.range, rangeLabel(filters.range))
    }
    filters.accountIds.forEach { accountId ->
        chips += ActiveFilterChip(FilterChipKind.ACCOUNT, accountId, accountName(accountId) ?: accountId)
    }
    filters.categoryIds.forEach { categoryId ->
        chips += ActiveFilterChip(FilterChipKind.CATEGORY, categoryId, categoryName(categoryId) ?: categoryId)
    }
    filters.tags.forEach { tag ->
        chips += ActiveFilterChip(FilterChipKind.TAG, tag, tag)
    }
    filters.amountMin?.let { amountMin ->
        val value = amountMin.toString()
        chips += ActiveFilterChip(FilterChipKind.MIN, value, "${Strings.get(StringKey.FilterMinAmount)} $value")
    }
    filters.amountMax?.let { amountMax ->
        val value = amountMax.toString()
        chips += ActiveFilterChip(FilterChipKind.MAX, value, "${Strings.get(StringKey.FilterMaxAmount)} $value")
    }
    if (filters.type != TYPE_ALL) {
        chips += ActiveFilterChip(FilterChipKind.TYPE, filters.type, typeLabel(filters.type))
    }

    return chips
}

/** Maps a removed chip back to the filter transform that clears it. */
fun removeChipTransform(chip: ActiveFilterChip): (TransactionFilters) -> TransactionFilters = { filters ->
    when (chip.kind) {
        FilterChipKind.QUERY -> filters.copy(query = "")
        FilterChipKind.RANGE -> filters.copy(range = DEFAULT_RANGE)
        FilterChipKind.TYPE -> filters.copy(type = TYPE_ALL)
        FilterChipKind.ACCOUNT -> filters.copy(accountIds = filters.accountIds - chip.value)
        FilterChipKind.CATEGORY -> filters.copy(categoryIds = filters.categoryIds - chip.value)
        FilterChipKind.TAG -> filters.copy(tags = filters.tags - chip.value)
        FilterChipKind.MIN -> filters.copy(amountMin = null)
        FilterChipKind.MAX -> filters.copy(amountMax = null)
    }
}

/**
 * Debounced search box. Local text is seeded from [query] and pushed back through
 * [onQueryChange] only after the user pauses (300ms), so a fetch is not fired per
 * keystroke. When [query] changes externally (e.g. a chip is removed) the field
 * re-seeds to stay in sync.
 */
@Composable
fun SearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var localText by remember { mutableStateOf(query) }

    LaunchedEffect(query) {
        if (query != localText) localText = query
    }
    LaunchedEffect(localText) {
        if (localText != query) {
            delay(300)
            onQueryChange(localText)
        }
    }

    OutlinedTextField(
        value = localText,
        onValueChange = { newText -> localText = newText },
        modifier = modifier.fillMaxWidth(),
        singleLine = true,
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        placeholder = { Text(Strings.get(StringKey.SearchHint)) },
    )
}

/**
 * Collapsible filter panel: a "Filters" toggle plus, when [expanded], sections for
 * type, date range, accounts, categories, tags (with any/all match) and amount
 * bounds. Every change is applied through [onUpdateFilters].
 */
@Composable
fun FilterPanel(
    state: SpendUiState,
    onUpdateFilters: ((TransactionFilters) -> TransactionFilters) -> Unit,
    expanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val filters = state.filters
    Column(modifier = modifier.fillMaxWidth()) {
        TextButton(onClick = onToggle) {
            Icon(Icons.Filled.FilterList, contentDescription = null)
            Text(
                text = Strings.get(StringKey.FiltersLabel),
                modifier = Modifier.padding(start = 8.dp),
            )
        }

        if (expanded) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                TypeSection(filters, onUpdateFilters)
                DateRangeSection(filters, onUpdateFilters)
                if (state.accounts.isNotEmpty()) {
                    AccountsSection(state, onUpdateFilters)
                }
                if (state.categories.isNotEmpty()) {
                    CategoriesSection(state, onUpdateFilters)
                }
                if (state.tags.isNotEmpty()) {
                    TagsSection(state, onUpdateFilters)
                }
                AmountSection(filters, onUpdateFilters)
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text = text, style = MaterialTheme.typography.labelLarge)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TypeSection(
    filters: TransactionFilters,
    onUpdateFilters: ((TransactionFilters) -> TransactionFilters) -> Unit,
) {
    val typeOptions = listOf(
        "all" to StringKey.FilterTypeAll,
        "income" to StringKey.FilterTypeIncome,
        "expense" to StringKey.FilterTypeExpense,
    )
    Column {
        SectionLabel(Strings.get(StringKey.FilterType))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            typeOptions.forEach { (typeValue, labelKey) ->
                FilterChip(
                    selected = filters.type == typeValue,
                    onClick = { onUpdateFilters { it.copy(type = typeValue) } },
                    label = { Text(Strings.get(labelKey)) },
                )
            }
        }
    }
}

@Composable
private fun DateRangeSection(
    filters: TransactionFilters,
    onUpdateFilters: ((TransactionFilters) -> TransactionFilters) -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    Column {
        SectionLabel(Strings.get(StringKey.FilterDateRange))
        Box {
            OutlinedButton(onClick = { menuOpen = true }) {
                Text(rangeLabel(filters.range))
                Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                rangePresets.forEach { (rangeCode, labelKey) ->
                    DropdownMenuItem(
                        text = { Text(Strings.get(labelKey)) },
                        onClick = {
                            onUpdateFilters { it.copy(range = rangeCode) }
                            menuOpen = false
                        },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AccountsSection(
    state: SpendUiState,
    onUpdateFilters: ((TransactionFilters) -> TransactionFilters) -> Unit,
) {
    val selectedAccountIds = state.filters.accountIds
    Column {
        SectionLabel(Strings.get(StringKey.FilterAccounts))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            state.accounts.forEach { account ->
                val selected = account.id in selectedAccountIds
                FilterChip(
                    selected = selected,
                    onClick = {
                        onUpdateFilters { filters ->
                            val nextAccountIds =
                                if (selected) filters.accountIds - account.id
                                else filters.accountIds + account.id
                            filters.copy(accountIds = nextAccountIds)
                        }
                    },
                    label = { Text(account.name) },
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CategoriesSection(
    state: SpendUiState,
    onUpdateFilters: ((TransactionFilters) -> TransactionFilters) -> Unit,
) {
    val selectedCategoryIds = state.filters.categoryIds
    Column {
        SectionLabel(Strings.get(StringKey.FilterCategories))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            state.categories.forEach { category ->
                val selected = category.id in selectedCategoryIds
                FilterChip(
                    selected = selected,
                    onClick = {
                        onUpdateFilters { filters ->
                            val nextCategoryIds =
                                if (selected) filters.categoryIds - category.id
                                else filters.categoryIds + category.id
                            filters.copy(categoryIds = nextCategoryIds)
                        }
                    },
                    label = { Text(category.name) },
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TagsSection(
    state: SpendUiState,
    onUpdateFilters: ((TransactionFilters) -> TransactionFilters) -> Unit,
) {
    val filters = state.filters
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionLabel(Strings.get(StringKey.FilterTags))
            Row(
                modifier = Modifier.padding(start = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = filters.tagMatch == "any",
                    onClick = { onUpdateFilters { it.copy(tagMatch = "any") } },
                    label = { Text(Strings.get(StringKey.FilterTagMatchAny)) },
                )
                FilterChip(
                    selected = filters.tagMatch == "all",
                    onClick = { onUpdateFilters { it.copy(tagMatch = "all") } },
                    label = { Text(Strings.get(StringKey.FilterTagMatchAll)) },
                )
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            state.tags.forEach { tag ->
                val selected = tag in filters.tags
                FilterChip(
                    selected = selected,
                    onClick = {
                        onUpdateFilters { current ->
                            val nextTags = if (selected) current.tags - tag else current.tags + tag
                            current.copy(tags = nextTags)
                        }
                    },
                    label = { Text(tag) },
                )
            }
        }
    }
}

@Composable
private fun AmountSection(
    filters: TransactionFilters,
    onUpdateFilters: ((TransactionFilters) -> TransactionFilters) -> Unit,
) {
    var minText by remember { mutableStateOf(filters.amountMin?.toString() ?: "") }
    var maxText by remember { mutableStateOf(filters.amountMax?.toString() ?: "") }

    LaunchedEffect(filters.amountMin) {
        if (filters.amountMin != minText.toDoubleOrNull()) {
            minText = filters.amountMin?.toString() ?: ""
        }
    }
    LaunchedEffect(filters.amountMax) {
        if (filters.amountMax != maxText.toDoubleOrNull()) {
            maxText = filters.amountMax?.toString() ?: ""
        }
    }

    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(
            value = minText,
            onValueChange = { input ->
                minText = input
                val parsed = input.toDoubleOrNull()
                if (input.isBlank() || parsed != null) {
                    onUpdateFilters { it.copy(amountMin = parsed) }
                }
            },
            modifier = Modifier.weight(1f),
            singleLine = true,
            label = { Text(Strings.get(StringKey.FilterMinAmount)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        OutlinedTextField(
            value = maxText,
            onValueChange = { input ->
                maxText = input
                val parsed = input.toDoubleOrNull()
                if (input.isBlank() || parsed != null) {
                    onUpdateFilters { it.copy(amountMax = parsed) }
                }
            },
            modifier = Modifier.weight(1f),
            singleLine = true,
            label = { Text(Strings.get(StringKey.FilterMaxAmount)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
    }
}

/**
 * The always-visible row of removable active-filter chips plus a "Clear all"
 * button. Renders nothing when there are no active filters.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ActiveFilterChips(
    chips: List<ActiveFilterChip>,
    onRemove: (ActiveFilterChip) -> Unit,
    onClearAll: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (chips.isEmpty()) return

    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        chips.forEach { chip ->
            InputChip(
                selected = false,
                onClick = { onRemove(chip) },
                label = { Text(chip.label) },
                trailingIcon = {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = Strings.get(StringKey.FilterRemove),
                    )
                },
            )
        }
        TextButton(
            onClick = onClearAll,
            modifier = Modifier.wrapContentWidth(),
        ) {
            Text(Strings.get(StringKey.FilterClearAll))
        }
    }
}
