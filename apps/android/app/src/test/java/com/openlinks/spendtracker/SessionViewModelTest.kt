package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.Account
import com.openlinks.spendtracker.data.Category
import com.openlinks.spendtracker.data.NewTransaction
import com.openlinks.spendtracker.data.SpendApi
import com.openlinks.spendtracker.data.Transaction
import com.openlinks.spendtracker.data.TransactionUpdate
import com.openlinks.spendtracker.ui.SessionViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SessionViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private class FakeApi : SpendApi {
        val transactions = mutableListOf<Transaction>()
        var accounts = listOf(Account("acc-1", "Checking", "bank", "USD"))
        var categories = listOf(Category("cat-1", "Food", "expense"))
        var failTransactions = false
        var created: NewTransaction? = null
        var deletedId: String? = null

        override suspend fun getTransactions(): List<Transaction> {
            if (failTransactions) throw RuntimeException("boom")
            return transactions.toList()
        }
        override suspend fun getTransaction(id: String): Transaction =
            transactions.first { it.id == id }
        override suspend fun createTransaction(transaction: NewTransaction): Transaction {
            created = transaction
            val row = Transaction(
                id = "new-${transactions.size + 1}",
                description = transaction.description,
                amount = transaction.amount,
                currency = transaction.currency,
                accountId = transaction.accountId,
                categoryId = transaction.categoryId,
                tags = transaction.tags,
                createdAt = "2026-07-02T00:00:00Z",
                updatedAt = null,
            )
            transactions.add(row)
            return row
        }
        override suspend fun updateTransaction(id: String, update: TransactionUpdate): Transaction =
            transactions.first { it.id == id }
        override suspend fun deleteTransaction(id: String) {
            deletedId = id
            transactions.removeAll { it.id == id }
        }
        override suspend fun getAccounts(): List<Account> = accounts
        override suspend fun getCategories(): List<Category> = categories
        override suspend fun getTags(): List<String> = listOf("food", "rent")
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun refreshPopulatesState() = runTest(dispatcher) {
        val api = FakeApi()
        api.transactions.add(
            Transaction("t1", "Coffee", -4.5, "USD", "acc-1", "cat-1", listOf("food"), "2026-07-02T00:00:00Z", null),
        )
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.refresh()
        advanceUntilIdle()

        val state = viewModel.state.value
        assertFalse(state.loading)
        assertEquals(1, state.transactions.size)
        assertEquals(1, state.accounts.size)
        assertEquals(1, state.categories.size)
        assertEquals(listOf("food", "rent"), state.tags)
        assertNull(state.error)
        assertEquals("Checking", state.accountName("acc-1"))
        assertEquals("Food", state.categoryName("cat-1"))
    }

    @Test
    fun refreshFailureSetsError() = runTest(dispatcher) {
        val api = FakeApi().apply { failTransactions = true }
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.refresh()
        advanceUntilIdle()

        val state = viewModel.state.value
        assertFalse(state.loading)
        assertNotNull(state.error)
    }

    @Test
    fun createTransactionReloadsList() = runTest(dispatcher) {
        val api = FakeApi()
        val viewModel = SessionViewModel(api, dispatcher)

        var reported = false
        viewModel.createTransaction(
            NewTransaction("Lunch", -12.0, "USD", "acc-1", "cat-1", emptyList()),
        ) { success -> reported = success }
        advanceUntilIdle()

        assertEquals("Lunch", api.created?.description)
        assertEquals(1, viewModel.state.value.transactions.size)
        assertEquals(true, reported)
    }

    @Test
    fun deleteTransactionRemovesFromState() = runTest(dispatcher) {
        val api = FakeApi()
        api.transactions.add(
            Transaction("t1", "Coffee", -4.5, "USD", "acc-1", "cat-1", emptyList(), "2026-07-02T00:00:00Z", null),
        )
        val viewModel = SessionViewModel(api, dispatcher)
        viewModel.refresh()
        advanceUntilIdle()

        viewModel.deleteTransaction("t1")
        advanceUntilIdle()

        assertEquals("t1", api.deletedId)
        assertEquals(0, viewModel.state.value.transactions.size)
    }
}
