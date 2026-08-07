package app.openlinks.spendtracker

import app.openlinks.spendtracker.data.Account
import app.openlinks.spendtracker.data.TransactionFilters
import app.openlinks.spendtracker.ui.screens.ActiveFilterChip
import app.openlinks.spendtracker.ui.screens.FilterChipKind
import app.openlinks.spendtracker.ui.screens.activeFilterChips
import app.openlinks.spendtracker.ui.screens.currencyFilterOptions
import app.openlinks.spendtracker.ui.screens.removeChipTransform
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ActiveFilterChipsTest {

    private val noName: (String) -> String? = { null }

    @Test
    fun defaultFiltersProduceNoChips() {
        val chips = activeFilterChips(TransactionFilters(), noName, noName)

        assertTrue(chips.isEmpty())
    }

    @Test
    fun populatedFiltersProduceExpectedChipsInOrder() {
        val filters = TransactionFilters(
            query = "coffee",
            range = "last-3-months",
            accountIds = listOf("acc-1"),
            categoryIds = listOf("cat-1"),
            tags = listOf("food"),
            amountMin = 5.0,
            amountMax = 100.0,
            type = "income",
        )

        val chips = activeFilterChips(
            filters,
            accountName = { accountId -> if (accountId == "acc-1") "Checking" else null },
            categoryName = { categoryId -> if (categoryId == "cat-1") "Groceries" else null },
        )

        assertEquals(
            listOf(
                ActiveFilterChip(FilterChipKind.QUERY, "coffee", "coffee"),
                ActiveFilterChip(FilterChipKind.RANGE, "last-3-months", "Last 3 months"),
                ActiveFilterChip(FilterChipKind.ACCOUNT, "acc-1", "Checking"),
                ActiveFilterChip(FilterChipKind.CATEGORY, "cat-1", "Groceries"),
                ActiveFilterChip(FilterChipKind.TAG, "food", "food"),
                ActiveFilterChip(FilterChipKind.MIN, "5.0", "Min 5.0"),
                ActiveFilterChip(FilterChipKind.MAX, "100.0", "Max 100.0"),
                ActiveFilterChip(FilterChipKind.TYPE, "income", "Income"),
            ),
            chips,
        )
    }

    @Test
    fun rangeOmittedAtDefaultAndTypeOmittedAtAll() {
        val filters = TransactionFilters(query = "rent", range = "this-month", type = "all")

        val chips = activeFilterChips(filters, noName, noName)

        assertEquals(
            listOf(ActiveFilterChip(FilterChipKind.QUERY, "rent", "rent")),
            chips,
        )
    }

    @Test
    fun unresolvedAccountAndCategoryNamesFallBackToTheirIds() {
        val filters = TransactionFilters(
            accountIds = listOf("acc-x"),
            categoryIds = listOf("cat-y"),
        )

        val chips = activeFilterChips(filters, noName, noName)

        assertEquals(
            listOf(
                ActiveFilterChip(FilterChipKind.ACCOUNT, "acc-x", "acc-x"),
                ActiveFilterChip(FilterChipKind.CATEGORY, "cat-y", "cat-y"),
            ),
            chips,
        )
    }

    @Test
    fun expenseTypeResolvesToExpenseLabel() {
        val chips = activeFilterChips(TransactionFilters(type = "expense"), noName, noName)

        assertEquals(
            listOf(ActiveFilterChip(FilterChipKind.TYPE, "expense", "Expense")),
            chips,
        )
    }

    @Test
    fun currencyProducesARemovableChip() {
        val chips = activeFilterChips(TransactionFilters(currency = "PEN"), noName, noName)

        assertEquals(
            listOf(ActiveFilterChip(FilterChipKind.CURRENCY, "PEN", "Currency: PEN")),
            chips,
        )
    }

    @Test
    fun removingTheCurrencyChipClearsTheCurrencyFilter() {
        val chip = ActiveFilterChip(FilterChipKind.CURRENCY, "PEN", "Currency: PEN")

        val cleared = removeChipTransform(chip)(TransactionFilters(currency = "PEN"))

        assertEquals(null, cleared.currency)
    }

    @Test
    fun currencyFilterOptionsAreDistinctAndSorted() {
        val accounts = listOf(
            Account(id = "acc-1", name = "Savings", type = "bank", currency = "USD"),
            Account(id = "acc-2", name = "Wallet", type = "cash", currency = "PEN"),
            Account(id = "acc-3", name = "Checking", type = "bank", currency = "USD"),
        )

        assertEquals(listOf("PEN", "USD"), currencyFilterOptions(accounts))
    }
}
