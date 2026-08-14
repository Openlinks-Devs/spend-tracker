package app.openlinks.spendtracker

import app.openlinks.spendtracker.data.Account
import app.openlinks.spendtracker.data.AnalyticsPayload
import app.openlinks.spendtracker.data.ApiException
import app.openlinks.spendtracker.data.AuthState
import app.openlinks.spendtracker.data.Category
import app.openlinks.spendtracker.data.Connection
import app.openlinks.spendtracker.data.EmailListResponse
import app.openlinks.spendtracker.data.EmailLogItem
import app.openlinks.spendtracker.data.InMemoryKeyValueStore
import app.openlinks.spendtracker.data.NewTransaction
import app.openlinks.spendtracker.data.SessionStore
import app.openlinks.spendtracker.data.SpendApi
import app.openlinks.spendtracker.data.SummaryRow
import app.openlinks.spendtracker.data.Transaction
import app.openlinks.spendtracker.data.TransactionFilters
import app.openlinks.spendtracker.data.TransactionListResponse
import app.openlinks.spendtracker.data.TransactionPage
import app.openlinks.spendtracker.data.TransactionUpdate
import app.openlinks.spendtracker.data.TransferInput
import app.openlinks.spendtracker.data.TransferResult
import app.openlinks.spendtracker.ui.GateDestination
import app.openlinks.spendtracker.ui.SessionViewModel
import app.openlinks.spendtracker.ui.authGateDestination
import app.openlinks.spendtracker.ui.brokenGmailConnections
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
            transactions.firstOrNull { it.id == id } ?: throw ApiException(404, "not_found")
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

        var createdTransfer: TransferInput? = null
        var connections = listOf<Connection>()
        var connectionsError: Exception? = null
        var gmailLinkError: Exception? = null
        var removedConnectionId: String? = null

        override suspend fun createTransfer(transfer: TransferInput): TransferResult {
            createdTransfer = transfer
            val leg = Transaction(
                id = "transfer-leg",
                description = transfer.fromDescription,
                amount = -transfer.fromAmount,
                currency = transfer.fromCurrency,
                accountId = transfer.fromAccountId,
                categoryId = transfer.fromCategoryId,
                tags = transfer.tags,
                createdAt = "2026-07-02T00:00:00Z",
            )
            return TransferResult(from = leg, to = leg.copy(id = "transfer-leg-2", amount = transfer.toAmount))
        }

        override suspend fun getConnections(): List<Connection> {
            connectionsError?.let { error -> throw error }
            return connections
        }

        override suspend fun deleteConnection(id: String) {
            removedConnectionId = id
            connections = connections.filterNot { connection -> connection.id == id }
        }

        override suspend fun gmailLinkUrl(): String {
            gmailLinkError?.let { error -> throw error }
            return "https://accounts.google.com/consent"
        }

        override suspend fun telegramPairCode(): String = "https://t.me/bot?start=code"

        var emails = listOf<EmailLogItem>()
        var emailsError: Exception? = null
        val recordedEmailPages = mutableListOf<Pair<Int, Int>>()

        override suspend fun getEmails(limit: Int, offset: Int): EmailListResponse {
            emailsError?.let { error -> throw error }
            recordedEmailPages.add(limit to offset)
            return EmailListResponse(
                items = emails.drop(offset).take(limit),
                total = emails.size,
                limit = limit,
                offset = offset,
            )
        }
    }

    private fun emailLogItem(messageId: String, verdict: String = "imported") = EmailLogItem(
        messageId = messageId,
        connectionId = "conn-1",
        accountEmail = "me@example.com",
        sender = "Bank <no-reply@bank.com>",
        subject = "Your purchase",
        emailDate = "2026-08-01T10:00:00Z",
        receivedAt = "2026-08-01T10:01:00Z",
        verdict = verdict,
        attempts = 1,
        transaction = null,
    )

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
        // The filtered-transactions read plus one analytics read, both carrying
        // the default filters. The default bucket is already "day", so the
        // heatmap reuses that payload instead of fetching a second time.
        assertEquals(2, api.recordedFilterCalls.size)
        assertTrue(api.recordedFilterCalls.all { filters -> filters == TransactionFilters() })
        assertEquals(setOf("day"), api.recordedBucketCalls.toSet())
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
        // Filtered transactions plus one analytics read: the default bucket is
        // "day", so the heatmap shares that payload.
        assertEquals(2, api.recordedFilterCalls.size)
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
    fun setCurrencyRefetchesTheListButNotAnalytics() = runTest(dispatcher) {
        val api = FakeApi()
        val viewModel = SessionViewModel(api, dispatcher)
        viewModel.refresh()
        advanceUntilIdle()
        api.recordedBucketCalls.clear()

        viewModel.setCurrency("EUR")
        advanceUntilIdle()

        assertEquals("EUR", viewModel.state.value.filters.currency)
        assertEquals("EUR", api.recordedFilterCalls.last().currency)
        // Analytics rows are bucketed per currency already, so nothing to refetch.
        assertTrue(api.recordedBucketCalls.isEmpty())
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

    @Test
    fun createTransferSendsBothLegsAndReloads() = runTest(dispatcher) {
        val api = FakeApi()
        val viewModel = SessionViewModel(api, dispatcher)

        var reported = false
        viewModel.createTransfer(
            TransferInput(
                fromAccountId = "acc-1",
                toAccountId = "acc-2",
                fromAmount = 100.0,
                toAmount = 370.0,
                fromCurrency = "USD",
                toCurrency = "PEN",
                fromCategoryId = "cat-out",
                toCategoryId = "cat-in",
                fromDescription = "Transfer to Soles",
                toDescription = "Transfer from Checking",
                tags = listOf("transfer"),
            ),
        ) { success -> reported = success }
        advanceUntilIdle()

        assertEquals("acc-2", api.createdTransfer?.toAccountId)
        assertEquals(370.0, api.createdTransfer?.toAmount!!, 0.0)
        assertTrue(reported)
    }

    @Test
    fun setCurrencyFiltersTheListServerSide() = runTest(dispatcher) {
        val api = FakeApi()
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.setCurrency("PEN")
        advanceUntilIdle()

        assertEquals("PEN", viewModel.state.value.filters.currency)
        assertEquals("PEN", api.recordedFilterCalls.last().currency)
    }

    @Test
    fun loadConnectionsPopulatesTheList() = runTest(dispatcher) {
        val api = FakeApi()
        api.connections = listOf(
            Connection("conn-1", "gmail", "active", "me@example.com", "2026-07-02T00:00:00Z"),
        )
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadConnections()
        advanceUntilIdle()

        assertEquals(1, viewModel.connectionsState.value.connections.size)
        assertFalse(viewModel.connectionsState.value.loading)
        assertNull(viewModel.connectionsState.value.error)
    }

    @Test
    fun mockModeRefusalIsAStateNotAnError() = runTest(dispatcher) {
        val api = FakeApi()
        api.connectionsError = ApiException(503, "connections_require_live_mode")
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadConnections()
        advanceUntilIdle()

        assertTrue(viewModel.connectionsState.value.liveModeRequired)
        assertNull(viewModel.connectionsState.value.error)
    }

    @Test
    fun mockModeSurfacesNoBrokenConnections() = runTest(dispatcher) {
        val api = FakeApi()
        api.connectionsError = ApiException(503, "connections_require_live_mode")
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadConnections()
        advanceUntilIdle()

        assertTrue(brokenGmailConnections(viewModel.connectionsState.value.connections).isEmpty())
    }

    @Test
    fun dismissingTheConnectionAlertHidesItForThisLaunch() = runTest(dispatcher) {
        val api = FakeApi()
        api.connections = listOf(
            Connection("conn-1", "gmail", "needs_reauth", "broken@example.com", "2026-07-02T00:00:00Z"),
        )
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadConnections()
        advanceUntilIdle()
        assertFalse(viewModel.connectionsState.value.alertDismissed)

        viewModel.dismissConnectionAlert()

        assertTrue(viewModel.connectionsState.value.alertDismissed)
        // The connection itself stays broken: dismissal hides the banner, it
        // does not resolve anything.
        assertEquals(1, brokenGmailConnections(viewModel.connectionsState.value.connections).size)
    }

    @Test
    fun reloadingConnectionsBringsTheAlertBackWhenAnAccountBreaksAgain() = runTest(dispatcher) {
        val api = FakeApi()
        api.connections = listOf(
            Connection("conn-1", "gmail", "needs_reauth", "broken@example.com", "2026-07-02T00:00:00Z"),
        )
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadConnections()
        advanceUntilIdle()
        viewModel.dismissConnectionAlert()

        // Reconnecting clears the breakage, so the dismissal has nothing left to
        // suppress and must not outlive it.
        api.connections = listOf(
            Connection("conn-1", "gmail", "active", "broken@example.com", "2026-07-02T00:00:00Z"),
        )
        viewModel.loadConnections()
        advanceUntilIdle()

        assertFalse(viewModel.connectionsState.value.alertDismissed)
    }

    @Test
    fun gmailLinkYieldsAConsentUrl() = runTest(dispatcher) {
        val api = FakeApi()
        val viewModel = SessionViewModel(api, dispatcher)

        var openedUrl: String? = null
        viewModel.linkGmail { url -> openedUrl = url }
        advanceUntilIdle()

        assertEquals("https://accounts.google.com/consent", openedUrl)
        assertFalse(viewModel.connectionsState.value.linking)
    }

    @Test
    fun gmailLinkOver402ShowsTheUpsellRatherThanAnError() = runTest(dispatcher) {
        val api = FakeApi()
        api.gmailLinkError = ApiException(402, "premium_required")
        val viewModel = SessionViewModel(api, dispatcher)

        var openedUrl: String? = null
        viewModel.linkGmail { url -> openedUrl = url }
        advanceUntilIdle()

        assertNull(openedUrl)
        assertTrue(viewModel.connectionsState.value.premiumRequired)
        assertNull(viewModel.connectionsState.value.error)
    }

    @Test
    fun removingAConnectionReloadsTheList() = runTest(dispatcher) {
        val api = FakeApi()
        api.connections = listOf(
            Connection("conn-1", "telegram", "active", "12345", "2026-07-02T00:00:00Z"),
        )
        val viewModel = SessionViewModel(api, dispatcher)
        viewModel.loadConnections()
        advanceUntilIdle()

        viewModel.removeConnection("conn-1")
        advanceUntilIdle()

        assertEquals("conn-1", api.removedConnectionId)
        assertEquals(0, viewModel.connectionsState.value.connections.size)
    }

    @Test
    fun loadInboxPopulatesTheEmailList() = runTest(dispatcher) {
        val api = FakeApi()
        api.emails = listOf(emailLogItem("msg-1"), emailLogItem("msg-2", "not_transaction"))
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadInbox()
        advanceUntilIdle()

        assertEquals(2, viewModel.inboxState.value.emails.size)
        assertEquals(2, viewModel.inboxState.value.total)
        assertFalse(viewModel.inboxState.value.loading)
        assertNull(viewModel.inboxState.value.error)
        assertFalse(viewModel.inboxState.value.canLoadMore)
    }

    @Test
    fun inboxMockModeRefusalIsAStateNotAnError() = runTest(dispatcher) {
        val api = FakeApi()
        api.emailsError = ApiException(503, "connections_require_live_mode")
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadInbox()
        advanceUntilIdle()

        assertTrue(viewModel.inboxState.value.liveModeRequired)
        assertNull(viewModel.inboxState.value.error)
        assertTrue(viewModel.inboxState.value.emails.isEmpty())
    }

    @Test
    fun inboxFailureSurfacesAnError() = runTest(dispatcher) {
        val api = FakeApi()
        api.emailsError = RuntimeException("boom")
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadInbox()
        advanceUntilIdle()

        assertEquals("boom", viewModel.inboxState.value.error)
        assertFalse(viewModel.inboxState.value.liveModeRequired)
    }

    @Test
    fun loadingMoreEmailsAppendsTheNextPage() = runTest(dispatcher) {
        val api = FakeApi()
        api.emails = (1..4).map { index -> emailLogItem("msg-$index") }
        val viewModel = SessionViewModel(api, dispatcher, pageSize = 2)

        viewModel.loadInbox()
        advanceUntilIdle()
        assertEquals(2, viewModel.inboxState.value.emails.size)
        assertTrue(viewModel.inboxState.value.canLoadMore)

        viewModel.loadMoreEmails()
        advanceUntilIdle()

        assertEquals(4, viewModel.inboxState.value.emails.size)
        assertFalse(viewModel.inboxState.value.canLoadMore)
        assertEquals(listOf("msg-1", "msg-2", "msg-3", "msg-4"), viewModel.inboxState.value.emails.map { it.messageId })
        assertEquals(listOf(2 to 0, 2 to 2), api.recordedEmailPages)
    }

    @Test
    fun loadingMoreDoesNothingWhenTheListIsComplete() = runTest(dispatcher) {
        val api = FakeApi()
        api.emails = listOf(emailLogItem("msg-1"))
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadInbox()
        advanceUntilIdle()
        api.recordedEmailPages.clear()

        viewModel.loadMoreEmails()
        advanceUntilIdle()

        assertTrue(api.recordedEmailPages.isEmpty())
        assertEquals(1, viewModel.inboxState.value.emails.size)
    }

    @Test
    fun aRowAlreadyHeldIsNotAppendedTwice() = runTest(dispatcher) {
        // Offset pagination over a newest-first list skews when the poller inserts
        // a row between two fetches, so page two can repeat a row from page one.
        val api = FakeApi()
        api.emails = listOf(emailLogItem("msg-1"), emailLogItem("msg-2"), emailLogItem("msg-3"))
        val viewModel = SessionViewModel(api, dispatcher, pageSize = 2)

        viewModel.loadInbox()
        advanceUntilIdle()
        // The list shifts under us: a newer email arrives at the head.
        api.emails = listOf(emailLogItem("msg-0")) + api.emails

        viewModel.loadMoreEmails()
        advanceUntilIdle()

        val messageIds = viewModel.inboxState.value.emails.map { email -> email.messageId }
        assertEquals(messageIds.distinct(), messageIds)
    }

    @Test
    fun aFailedLoadMoreKeepsTheRowsAlreadyRead() = runTest(dispatcher) {
        val api = FakeApi()
        api.emails = (1..4).map { index -> emailLogItem("msg-$index") }
        val viewModel = SessionViewModel(api, dispatcher, pageSize = 2)

        viewModel.loadInbox()
        advanceUntilIdle()
        api.emailsError = ApiException(503, "connections_require_live_mode")

        viewModel.loadMoreEmails()
        advanceUntilIdle()

        // Whatever the second page failed with, the page the user is reading stays.
        assertEquals(2, viewModel.inboxState.value.emails.size)
        assertFalse(viewModel.inboxState.value.liveModeRequired)
    }

    @Test
    fun openingATransactionAlreadyLoadedDoesNotHitTheApi() = runTest(dispatcher) {
        val api = FakeApi()
        api.transactions.add(
            Transaction("t1", "Coffee", -4.5, "USD", "acc-1", "cat-1", emptyList(), "2026-07-02T00:00:00Z", null),
        )
        val viewModel = SessionViewModel(api, dispatcher)
        viewModel.refresh()
        advanceUntilIdle()

        viewModel.loadTransaction("t1")
        advanceUntilIdle()

        assertEquals("t1", viewModel.transactionDetailState.value.transaction?.id)
        assertFalse(viewModel.transactionDetailState.value.loading)
        assertFalse(viewModel.transactionDetailState.value.notFound)
    }

    @Test
    fun openingATransactionOutsideTheLoadedListFetchesIt() = runTest(dispatcher) {
        // A deep link to an older transaction: it is not in the current filtered
        // page, so the screen has to ask the backend for it by id.
        val api = FakeApi()
        api.transactions.add(
            Transaction("old-1", "Rent", -900.0, "USD", "acc-1", "cat-1", emptyList(), "2025-01-02T00:00:00Z", null),
        )
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadTransaction("old-1")
        advanceUntilIdle()

        assertEquals("old-1", viewModel.transactionDetailState.value.transaction?.id)
        assertNull(viewModel.transactionDetailState.value.error)
    }

    @Test
    fun aMissingTransactionReportsNotFoundRatherThanAGenericError() = runTest(dispatcher) {
        val api = FakeApi()
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadTransaction("gone")
        advanceUntilIdle()

        val detailState = viewModel.transactionDetailState.value
        assertTrue(detailState.notFound)
        assertNull(detailState.transaction)
        assertNull(detailState.error)
    }

    @Test
    fun detailStateNeverAnswersForATransactionItWasNotAskedAbout() = runTest(dispatcher) {
        // The screen composes before its LaunchedEffect runs, so on the first frame
        // of a second detail screen the state still holds the previous fetch. It
        // must not answer with it, or the action buttons target the wrong row.
        val api = FakeApi()
        api.transactions.add(
            Transaction("old-1", "Rent", -900.0, "USD", "acc-1", "cat-1", emptyList(), "2025-01-02T00:00:00Z", null),
        )
        val viewModel = SessionViewModel(api, dispatcher)

        viewModel.loadTransaction("old-1")
        advanceUntilIdle()

        val detailState = viewModel.transactionDetailState.value
        assertEquals("old-1", detailState.transactionFor("old-1")?.id)
        assertNull(detailState.transactionFor("old-2"))
        assertFalse(detailState.answersFor("old-2"))
        assertTrue(detailState.answersFor("old-1"))
    }
}
