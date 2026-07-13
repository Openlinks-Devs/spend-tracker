package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.Account
import com.openlinks.spendtracker.data.AnalyticsPayload
import com.openlinks.spendtracker.data.ApiException
import com.openlinks.spendtracker.data.AuthState
import com.openlinks.spendtracker.data.Category
import com.openlinks.spendtracker.data.InMemoryKeyValueStore
import com.openlinks.spendtracker.data.NewTransaction
import com.openlinks.spendtracker.data.SessionStore
import com.openlinks.spendtracker.data.SpendApi
import com.openlinks.spendtracker.data.SummaryRow
import com.openlinks.spendtracker.data.Transaction
import com.openlinks.spendtracker.data.TransactionFilters
import com.openlinks.spendtracker.data.TransactionListResponse
import com.openlinks.spendtracker.data.TransactionPage
import com.openlinks.spendtracker.data.TransactionUpdate
import com.openlinks.spendtracker.ui.GateDestination
import com.openlinks.spendtracker.ui.SessionViewModel
import com.openlinks.spendtracker.ui.authGateDestination
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
import org.junit.Assert.assertTrue
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
        // When set, the filtered fetch mimics ApiClient's live 401 handling: it
        // clears the session (as ApiClient does on a 401) and throws ApiException(401).
        var sessionClearedOnUnauthorized: SessionStore? = null
        var created: NewTransaction? = null
        var deletedId: String? = null
        var analyticsPayload = AnalyticsPayload(
            summary = listOf(SummaryRow(currency = "USD", income = 0.0, spend = 0.0, net = 0.0, count = 1)),
        )

        val recordedFilterCalls = mutableListOf<TransactionFilters>()
        val recordedBucketCalls = mutableListOf<String>()

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
        override suspend fun getTransactionsFiltered(
            filters: TransactionFilters,
            page: TransactionPage,
        ): TransactionListResponse {
            recordedFilterCalls.add(filters)
            sessionClearedOnUnauthorized?.let { session ->
                session.clear()
                throw ApiException(401, "Unauthorized")
            }
            if (failTransactions) throw RuntimeException("boom")
            return TransactionListResponse(items = transactions.toList(), total = transactions.size)
        }
        override suspend fun getAnalytics(filters: TransactionFilters, bucket: String): AnalyticsPayload {
            recordedFilterCalls.add(filters)
            recordedBucketCalls.add(bucket)
            return analyticsPayload
        }
        override suspend fun exchangeGoogleIdToken(idToken: String): String = "session-token"
        override suspend fun signOutRemote() {}
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
    fun refreshPopulatesTransactionsAndAnalyticsFromFilteredCalls() = runTest(dispatcher) {
        val api = FakeApi()
        api.transactions.add(
            Transaction("t1", "Coffee", -4.5, "USD", "acc-1", "cat-1", emptyList(), "2026-07-02T00:00:00Z", null),
        )
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.refresh()
        advanceUntilIdle()

        val state = viewModel.state.value
        assertEquals(1, state.transactions.size)
        assertNotNull(state.analytics)
        assertEquals(api.analyticsPayload, state.analytics)
        // The filtered-transactions read plus the primary (month) and day-bucketed
        // analytics reads all carry the default filters.
        assertEquals(3, api.recordedFilterCalls.size)
        assertTrue(api.recordedFilterCalls.all { filters -> filters == TransactionFilters() })
        // Primary bucket plus a day-granularity fetch for the heatmap.
        assertEquals(setOf("month", "day"), api.recordedBucketCalls.toSet())
    }

    @Test
    fun refreshPopulatesDayAnalyticsForHeatmap() = runTest(dispatcher) {
        val api = FakeApi()
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.refresh()
        advanceUntilIdle()

        val state = viewModel.state.value
        assertNotNull(state.dayAnalytics)
        assertEquals(api.analyticsPayload, state.dayAnalytics)
        assertTrue(api.recordedBucketCalls.contains("day"))
    }

    @Test
    fun updateFiltersRefreshesDayAnalytics() = runTest(dispatcher) {
        val api = FakeApi()
        val viewModel = SessionViewModel(api, dispatcher)
        viewModel.refresh()
        advanceUntilIdle()
        api.recordedBucketCalls.clear()

        viewModel.updateFilters { filters -> filters.copy(type = "expense") }
        advanceUntilIdle()

        assertNotNull(viewModel.state.value.dayAnalytics)
        assertTrue(api.recordedBucketCalls.contains("day"))
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
    fun refreshOnLiveUnauthorizedRoutesGateBackToAuth() = runTest(dispatcher) {
        // Live-style setup: a signed-in session whose bearer token expires. The
        // filtered fetch 401s, ApiClient clears the token (simulated by the fake),
        // and the ViewModel must re-read auth state so the gate returns to AUTH.
        val sessionStore = SessionStore(InMemoryKeyValueStore())
        sessionStore.saveToken("expired-bearer-token")
        val api = FakeApi().apply { sessionClearedOnUnauthorized = sessionStore }
        val viewModel = SessionViewModel(api, dispatcher, sessionStore)

        // Gate starts on the Shell for the signed-in live session.
        assertEquals(GateDestination.SHELL, authGateDestination(false, viewModel.authState.value))

        viewModel.refresh()
        advanceUntilIdle()

        // The 401 cleared the token; the ViewModel re-read auth state to SignedOut so
        // the gate (in live mode) now routes back to AuthScreen.
        assertEquals(AuthState.SignedOut, viewModel.authState.value)
        assertEquals(GateDestination.AUTH, authGateDestination(false, viewModel.authState.value))
        assertNotNull(viewModel.state.value.error)
    }

    @Test
    fun updateFiltersCallsApiWithNewFiltersAndUpdatesState() = runTest(dispatcher) {
        val api = FakeApi()
        api.transactions.add(
            Transaction("t1", "Coffee", -4.5, "USD", "acc-1", "cat-1", emptyList(), "2026-07-02T00:00:00Z", null),
        )
        val viewModel = SessionViewModel(api, dispatcher)
        viewModel.refresh()
        advanceUntilIdle()
        api.recordedFilterCalls.clear()

        viewModel.updateFilters { filters -> filters.copy(type = "expense") }
        advanceUntilIdle()

        assertEquals("expense", viewModel.state.value.filters.type)
        // Filtered transactions plus the primary and day-bucketed analytics reads.
        assertEquals(3, api.recordedFilterCalls.size)
        assertEquals(true, api.recordedFilterCalls.all { filters -> filters.type == "expense" })
    }

    @Test
    fun setBucketCallsGetAnalyticsWithNewBucket() = runTest(dispatcher) {
        val api = FakeApi()
        val viewModel = SessionViewModel(api, dispatcher)
        viewModel.refresh()
        advanceUntilIdle()
        api.recordedBucketCalls.clear()

        viewModel.setBucket("week")
        advanceUntilIdle()

        assertEquals("week", viewModel.state.value.bucket)
        // The primary (week) read plus the day-bucketed read for the heatmap.
        assertEquals(setOf("week", "day"), api.recordedBucketCalls.toSet())
    }

    @Test
    fun setCurrencyUpdatesFiltersWithoutRefetching() = runTest(dispatcher) {
        val api = FakeApi()
        val viewModel = SessionViewModel(api, dispatcher)
        viewModel.refresh()
        advanceUntilIdle()
        val callCountBeforeSetCurrency = api.recordedFilterCalls.size

        viewModel.setCurrency("EUR")
        advanceUntilIdle()

        assertEquals("EUR", viewModel.state.value.filters.currency)
        assertEquals(callCountBeforeSetCurrency, api.recordedFilterCalls.size)
    }

    @Test
    fun clearFiltersResetsFiltersAndRefetches() = runTest(dispatcher) {
        val api = FakeApi()
        val viewModel = SessionViewModel(api, dispatcher)
        viewModel.refresh()
        advanceUntilIdle()
        viewModel.updateFilters { filters -> filters.copy(type = "expense", query = "coffee") }
        advanceUntilIdle()
        api.recordedFilterCalls.clear()

        viewModel.clearFilters()
        advanceUntilIdle()

        assertEquals(TransactionFilters(), viewModel.state.value.filters)
        assertEquals(true, api.recordedFilterCalls.isNotEmpty())
        assertEquals(true, api.recordedFilterCalls.all { filters -> filters == TransactionFilters() })
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
