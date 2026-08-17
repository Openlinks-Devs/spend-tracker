package app.openlinks.spendtracker.ui

import android.content.Context
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import app.openlinks.spendtracker.data.Account
import app.openlinks.spendtracker.data.AnalyticsPayload
import app.openlinks.spendtracker.data.ApiClient
import app.openlinks.spendtracker.data.ApiException
import app.openlinks.spendtracker.data.AuthRepository
import app.openlinks.spendtracker.data.AuthState
import app.openlinks.spendtracker.data.Category
import app.openlinks.spendtracker.data.Connection
import app.openlinks.spendtracker.data.EmailLogItem
import app.openlinks.spendtracker.data.NewTransaction
import app.openlinks.spendtracker.data.emailRowKey
import app.openlinks.spendtracker.data.SessionStore
import app.openlinks.spendtracker.data.SpendApi
import app.openlinks.spendtracker.data.Transaction
import app.openlinks.spendtracker.data.TransactionFilters
import app.openlinks.spendtracker.data.TransactionPage
import app.openlinks.spendtracker.data.TransactionUpdate
import app.openlinks.spendtracker.data.TransferInput
import app.openlinks.spendtracker.i18n.StringKey
import app.openlinks.spendtracker.i18n.Strings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Everything the screens render from. Immutable snapshot exposed as StateFlow. */
data class SpendUiState(
    val loading: Boolean = false,
    val transactions: List<Transaction> = emptyList(),
    val accounts: List<Account> = emptyList(),
    val categories: List<Category> = emptyList(),
    val tags: List<String> = emptyList(),
    val filters: TransactionFilters = TransactionFilters(),
    val analytics: AnalyticsPayload? = null,
    // Day-granularity analytics fetched alongside [analytics], used by the
    // calendar heatmap which always needs per-day buckets regardless of [bucket].
    val dayAnalytics: AnalyticsPayload? = null,
    // Day, not month: the default range is "this month", so a month bucket
    // produces a single-bar chart. Day also lets the heatmap reuse this fetch.
    val bucket: String = "day",
    val error: String? = null,
) {
    val summary: SummaryTotals get() = SummaryCalculator.compute(transactions)

    // Which currency the dashboard should render totals in: the filter's explicit
    // choice when the analytics summary actually has data in it, otherwise
    // whichever currency shows up most in the current filtered result set.
    val displayCurrency: String? get() = resolveDisplayCurrency(filters.currency, analytics?.summary ?: emptyList())

    // Built once per state snapshot so per-row name lookups are O(1), not a
    // linear scan of accounts/categories for every rendered transaction row.
    private val accountNameById: Map<String, String> by lazy {
        accounts.associate { account -> account.id to account.name }
    }
    private val categoryNameById: Map<String, String> by lazy {
        categories.associate { category -> category.id to category.name }
    }

    fun transactionById(id: String): Transaction? =
        transactions.firstOrNull { transaction -> transaction.id == id }

    fun accountName(accountId: String?): String? = accountId?.let { id -> accountNameById[id] }

    fun categoryName(categoryId: String?): String? = categoryId?.let { id -> categoryNameById[id] }
}

/** Auth-flow UI status, separate from data-loading [SpendUiState]. */
data class AuthUiState(
    val signingIn: Boolean = false,
    val error: String? = null,
)

/**
 * Integrations screen status. [premiumRequired] is the backend's 402 answer to a
 * Gmail link attempt past the plan's limit, and [liveModeRequired] its 503 in mock
 * mode, where connections cannot exist because they key off a real user row.
 */
data class ConnectionsUiState(
    val loading: Boolean = false,
    val connections: List<Connection> = emptyList(),
    val linking: Boolean = false,
    val premiumRequired: Boolean = false,
    val liveModeRequired: Boolean = false,
    val error: String? = null,
    /**
     * Whether the user waved away the broken-connection banner. Held here rather
     * than persisted on purpose: the ViewModel survives rotation and dies with
     * the process, which scopes the dismissal to this app launch. A broken
     * account cannot be silenced for good while it is still costing imports.
     */
    val alertDismissed: Boolean = false,
)

/**
 * Inbox screen status: the emails the importer processed, newest first.
 * [liveModeRequired] is the backend's 503 in mock mode, where these rows cannot
 * exist because they key off real connection rows. [total] is the server's count,
 * so the screen knows whether another page is worth asking for.
 */
data class InboxUiState(
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val emails: List<EmailLogItem> = emptyList(),
    val total: Int = 0,
    val liveModeRequired: Boolean = false,
    val error: String? = null,
) {
    val canLoadMore: Boolean get() = emails.size < total
}

/**
 * The transaction behind the detail screen when it is not in the currently loaded
 * filtered list, which is what a deep link to an older transaction hits.
 * [notFound] is the backend's 404, kept apart from [error] so a deleted
 * transaction says so instead of showing a generic failure.
 */
data class TransactionDetailUiState(
    val loading: Boolean = false,
    val transaction: Transaction? = null,
    val notFound: Boolean = false,
    val error: String? = null,
    /** Which transaction this snapshot describes. Null before anything is asked for. */
    val requestedId: String? = null,
) {
    /**
     * Whether this snapshot describes [id] at all. A screen composes before its
     * effects run, so the first frame of a second detail screen still sees the
     * previous transaction's result; answering only for the id that was asked
     * about keeps it from rendering, and acting on, the wrong row.
     */
    fun answersFor(id: String): Boolean = requestedId == id

    /** The loaded transaction, but only when it is the one [id] asked for. */
    fun transactionFor(id: String): Transaction? =
        transaction?.takeIf { loaded -> loaded.id == id && answersFor(id) }
}

/**
 * The linked Gmail accounts that lost access and stopped importing. Pure, so the
 * rule is tested in plain JUnit rather than through a screen.
 *
 * `disabled` is excluded deliberately: it means the connection sits over the
 * plan's account cap, which the user cannot repair by reconnecting. The
 * backend's Telegram alert draws the same line.
 */
fun brokenGmailConnections(connections: List<Connection>): List<Connection> =
    connections.filter { connection -> connection.provider == "gmail" && connection.status == "needs_reauth" }

// The backend's mock-mode refusal, which is expected rather than a failure.
private const val LIVE_MODE_REQUIRED_ERROR = "connections_require_live_mode"

private fun isLiveModeRequired(error: Exception): Boolean =
    error is ApiException && error.message == LIVE_MODE_REQUIRED_ERROR

/**
 * Owns the [SpendApi] and app state. Constructor-injectable ([api], [dispatcher])
 * so the logic is exercised with a fake API and a test dispatcher in plain JUnit,
 * no Robolectric required. The production path builds a real [ApiClient] via the
 * companion [factory].
 *
 * [sessionStore] and [authRepository] are only wired in live builds (the gate uses
 * [authState]); they default to null so pure ViewModel tests need not supply them.
 */
class SessionViewModel(
    private val api: SpendApi,
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default,
    private val sessionStore: SessionStore? = null,
    private val authRepository: AuthRepository? = null,
    // How many emails one Inbox page asks for. Injectable so pagination is
    // exercised without building a hundred fixtures.
    private val pageSize: Int = 50,
) : ViewModel() {

    private val mutableState = MutableStateFlow(SpendUiState())
    val state: StateFlow<SpendUiState> = mutableState.asStateFlow()

    private val mutableAuthState = MutableStateFlow(sessionStore?.authState() ?: AuthState.SignedOut)
    val authState: StateFlow<AuthState> = mutableAuthState.asStateFlow()

    private val mutableAuthUiState = MutableStateFlow(AuthUiState())
    val authUiState: StateFlow<AuthUiState> = mutableAuthUiState.asStateFlow()

    private val mutableConnectionsState = MutableStateFlow(ConnectionsUiState())
    val connectionsState: StateFlow<ConnectionsUiState> = mutableConnectionsState.asStateFlow()

    private val mutableInboxState = MutableStateFlow(InboxUiState())
    val inboxState: StateFlow<InboxUiState> = mutableInboxState.asStateFlow()

    private val mutableTransactionDetailState = MutableStateFlow(TransactionDetailUiState())
    val transactionDetailState: StateFlow<TransactionDetailUiState> = mutableTransactionDetailState.asStateFlow()

    /** Loads the first page of processed emails, replacing whatever is shown. */
    fun loadInbox() {
        viewModelScope.launch {
            mutableInboxState.value = mutableInboxState.value.copy(loading = true, error = null)
            try {
                val page = withContext(dispatcher) { api.getEmails(limit = pageSize, offset = 0) }
                mutableInboxState.value = InboxUiState(
                    loading = false,
                    emails = page.items,
                    total = page.total,
                    liveModeRequired = false,
                    error = null,
                )
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutableInboxState.value = InboxUiState(
                    loading = false,
                    emails = emptyList(),
                    total = 0,
                    liveModeRequired = isLiveModeRequired(error),
                    error = if (isLiveModeRequired(error)) null else error.message
                        ?: Strings.get(StringKey.ErrorGeneric),
                )
                refreshAuthState()
            }
        }
    }

    /**
     * Appends the next page. Offset is the number of rows already held rather
     * than a page counter, so it stays correct even if a page came back short.
     */
    fun loadMoreEmails() {
        val current = mutableInboxState.value
        if (!current.canLoadMore || current.loading || current.loadingMore) return
        viewModelScope.launch {
            mutableInboxState.value = mutableInboxState.value.copy(loadingMore = true, error = null)
            try {
                val offset = mutableInboxState.value.emails.size
                val page = withContext(dispatcher) { api.getEmails(limit = pageSize, offset = offset) }
                val alreadyHeld = mutableInboxState.value.emails
                // Offset pagination over a newest-first list skews whenever the
                // poller inserts a row mid-read, which repeats a row we already
                // hold. Duplicated rows would collide on the list's key.
                val heldKeys = alreadyHeld.map { email -> emailRowKey(email) }.toSet()
                mutableInboxState.value = mutableInboxState.value.copy(
                    loadingMore = false,
                    emails = alreadyHeld + page.items.filterNot { email -> emailRowKey(email) in heldKeys },
                    total = page.total,
                    error = null,
                )
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                // Only an error, never [liveModeRequired]: that flag replaces the
                // whole screen with a placeholder, which would throw away the page
                // the user is already reading.
                mutableInboxState.value = mutableInboxState.value.copy(
                    loadingMore = false,
                    error = error.message ?: Strings.get(StringKey.ErrorGeneric),
                )
                refreshAuthState()
            }
        }
    }

    /**
     * Resolves the transaction the detail screen was opened for. The loaded
     * filtered list is only ever one page, so a link from the Inbox or from an
     * older date lands on a transaction that is not in it; that case fetches by
     * id instead of rendering a bare error. A 404 is its own state, since a
     * deleted transaction is a fact rather than a failure.
     */
    fun loadTransaction(id: String) {
        val alreadyLoaded = mutableState.value.transactionById(id)
        if (alreadyLoaded != null) {
            mutableTransactionDetailState.value =
                TransactionDetailUiState(transaction = alreadyLoaded, requestedId = id)
            return
        }
        viewModelScope.launch {
            mutableTransactionDetailState.value = TransactionDetailUiState(loading = true, requestedId = id)
            try {
                val transaction = withContext(dispatcher) { api.getTransaction(id) }
                mutableTransactionDetailState.value =
                    TransactionDetailUiState(transaction = transaction, requestedId = id)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                val notFound = error is ApiException && error.status == 404
                mutableTransactionDetailState.value = TransactionDetailUiState(
                    notFound = notFound,
                    error = if (notFound) null else error.message ?: Strings.get(StringKey.ErrorGeneric),
                    requestedId = id,
                )
                refreshAuthState()
            }
        }
    }

    /**
     * Runs the Credential Manager sign-in, then re-reads the session so the gate
     * swaps to the Shell. The initial data load is owned by the Shell's
     * LaunchedEffect(Unit) in SpendTrackerApp, so this does not call refresh().
     */
    fun signInWithGoogle(context: Context) {
        val repository = authRepository ?: return
        viewModelScope.launch {
            mutableAuthUiState.value = AuthUiState(signingIn = true, error = null)
            try {
                repository.signInWithGoogle(context)
                mutableAuthUiState.value = AuthUiState(signingIn = false, error = null)
                refreshAuthState()
            } catch (cancelled: GetCredentialCancellationException) {
                // User dismissed the Google chooser: no-op, not an error.
                mutableAuthUiState.value = AuthUiState(signingIn = false, error = null)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutableAuthUiState.value = AuthUiState(
                    signingIn = false,
                    error = error.message ?: Strings.get(StringKey.AuthError),
                )
            }
        }
    }

    /** Signs out server-side + locally and returns the gate to the auth screen. */
    fun signOut(context: Context) {
        val repository = authRepository ?: return
        viewModelScope.launch {
            runCatching { repository.signOut(context) }
            refreshAuthState()
        }
    }

    private fun refreshAuthState() {
        sessionStore?.let { mutableAuthState.value = it.authState() }
    }

    /**
     * Loads the linked integrations. Called at app start so the navigation bar
     * and the summary banner can report a broken account from anywhere, when the
     * Integrations screen opens, and again when it resumes, since linking Gmail
     * happens outside the app (in a browser tab) and coming back is the only
     * signal that the list may have changed.
     */
    fun loadConnections() {
        viewModelScope.launch {
            mutableConnectionsState.value = mutableConnectionsState.value.copy(loading = true, error = null)
            try {
                val connections = withContext(dispatcher) { api.getConnections() }
                mutableConnectionsState.value = mutableConnectionsState.value.copy(
                    loading = false,
                    connections = connections,
                    liveModeRequired = false,
                    error = null,
                    // A dismissal only ever silences the accounts that were
                    // broken when the user waved it away. Once they are all
                    // healthy again the flag has nothing to suppress, so clear
                    // it and let a later breakage speak up.
                    alertDismissed = mutableConnectionsState.value.alertDismissed &&
                        brokenGmailConnections(connections).isNotEmpty(),
                )
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutableConnectionsState.value = mutableConnectionsState.value.copy(
                    loading = false,
                    connections = emptyList(),
                    liveModeRequired = isLiveModeRequired(error),
                    error = if (isLiveModeRequired(error)) null else error.message
                        ?: Strings.get(StringKey.ErrorGeneric),
                )
                refreshAuthState()
            }
        }
    }

    /** Hides the broken-connection banner until the next app launch. */
    fun dismissConnectionAlert() {
        mutableConnectionsState.value = mutableConnectionsState.value.copy(alertDismissed = true)
    }

    /**
     * Asks the backend for a Google consent URL and hands it to [onUrl] to open.
     * A 402 means the account is at its Gmail limit, which is an upsell, not an
     * error, so it gets its own flag.
     */
    fun linkGmail(onUrl: (String) -> Unit) {
        viewModelScope.launch {
            mutableConnectionsState.value = mutableConnectionsState.value.copy(
                linking = true,
                premiumRequired = false,
                error = null,
            )
            try {
                val url = withContext(dispatcher) { api.gmailLinkUrl() }
                mutableConnectionsState.value = mutableConnectionsState.value.copy(linking = false)
                onUrl(url)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                val premiumRequired = error is ApiException && error.status == 402
                mutableConnectionsState.value = mutableConnectionsState.value.copy(
                    linking = false,
                    premiumRequired = premiumRequired,
                    liveModeRequired = isLiveModeRequired(error),
                    error = when {
                        premiumRequired || isLiveModeRequired(error) -> null
                        else -> error.message ?: Strings.get(StringKey.ErrorGeneric)
                    },
                )
            }
        }
    }

    /** Mints a Telegram pairing code and hands its deep link to [onDeepLink]. */
    fun pairTelegram(onDeepLink: (String) -> Unit) {
        viewModelScope.launch {
            mutableConnectionsState.value = mutableConnectionsState.value.copy(linking = true, error = null)
            try {
                val deepLink = withContext(dispatcher) { api.telegramPairCode() }
                mutableConnectionsState.value = mutableConnectionsState.value.copy(linking = false)
                onDeepLink(deepLink)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutableConnectionsState.value = mutableConnectionsState.value.copy(
                    linking = false,
                    liveModeRequired = isLiveModeRequired(error),
                    error = if (isLiveModeRequired(error)) null else error.message
                        ?: Strings.get(StringKey.ErrorGeneric),
                )
            }
        }
    }

    /** Unlinks an integration, then reloads the list so the row disappears. */
    fun removeConnection(connectionId: String) {
        viewModelScope.launch {
            try {
                withContext(dispatcher) { api.deleteConnection(connectionId) }
                loadConnections()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutableConnectionsState.value = mutableConnectionsState.value.copy(
                    error = error.message ?: Strings.get(StringKey.ErrorGeneric),
                )
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(loading = true, error = null)
            try {
                val filters = mutableState.value.filters
                val bucket = mutableState.value.bucket
                // The five reads are independent; run them concurrently so a load
                // costs one round-trip, not five.
                val loaded = withContext(dispatcher) {
                    coroutineScope {
                        val transactionsDeferred = async { api.getTransactionsFiltered(filters, TransactionPage()) }
                        val analyticsDeferred = async { api.getAnalytics(filters, bucket) }
                        // The heatmap always needs day buckets. Skip the second call
                        // when the primary bucket is already "day".
                        val dayAnalyticsDeferred =
                            if (bucket == "day") null else async { api.getAnalytics(filters, "day") }
                        val accountsDeferred = async { api.getAccounts() }
                        val categoriesDeferred = async { api.getCategories() }
                        val tagsDeferred = async {
                            // Tags are optional, but never swallow cancellation.
                            runCatching { api.getTags() }.getOrElse { error ->
                                if (error is CancellationException) throw error
                                emptyList()
                            }
                        }
                        val analytics = analyticsDeferred.await()
                        SpendUiState(
                            loading = false,
                            transactions = transactionsDeferred.await().items,
                            analytics = analytics,
                            dayAnalytics = dayAnalyticsDeferred?.await() ?: analytics,
                            accounts = accountsDeferred.await(),
                            categories = categoriesDeferred.await(),
                            tags = tagsDeferred.await(),
                            filters = filters,
                            bucket = bucket,
                            error = null,
                        )
                    }
                }
                mutableState.value = loaded
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(
                    loading = false,
                    error = error.message ?: "Something went wrong",
                )
                // A data-fetch 401 makes ApiClient clear the live session; re-read the
                // auth state so the gate re-evaluates and routes back to AuthScreen.
                refreshAuthState()
            }
        }
    }

    /** Applies [transform] to the current filters and re-fetches the filtered transactions and analytics. */
    fun updateFilters(transform: (TransactionFilters) -> TransactionFilters) {
        val next = transform(mutableState.value.filters)
        mutableState.value = mutableState.value.copy(filters = next)
        viewModelScope.launch {
            try {
                reloadFilteredData()
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(error = error.message ?: "Something went wrong")
                refreshAuthState()
            }
        }
    }

    /** Changes the analytics bucket granularity (e.g. "week", "month") and re-fetches. */
    fun setBucket(bucket: String) {
        mutableState.value = mutableState.value.copy(bucket = bucket)
        viewModelScope.launch {
            try {
                reloadFilteredData()
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(error = error.message ?: "Something went wrong")
                refreshAuthState()
            }
        }
    }

    /** Resets filters to their defaults and re-fetches. */
    fun clearFilters() {
        updateFilters { TransactionFilters() }
    }

    /**
     * Sets the currency filter. The transactions list filters by currency
     * server-side, so this re-fetches it; analytics is currency-agnostic by
     * design (its switcher needs every currency), so it is left alone.
     */
    fun setCurrency(currency: String?) {
        mutableState.value = mutableState.value.copy(
            filters = mutableState.value.filters.copy(currency = currency),
        )
        viewModelScope.launch {
            try {
                reloadTransactions()
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(error = error.message ?: "Something went wrong")
                refreshAuthState()
            }
        }
    }

    fun createTransaction(transaction: NewTransaction, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            try {
                withContext(dispatcher) { api.createTransaction(transaction) }
                reloadFilteredData()
                onDone(true)
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(error = error.message ?: "Something went wrong")
                refreshAuthState()
                onDone(false)
            }
        }
    }

    /** Creates both legs of a transfer, then reloads the list and analytics. */
    fun createTransfer(transfer: TransferInput, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            try {
                withContext(dispatcher) { api.createTransfer(transfer) }
                reloadFilteredData()
                onDone(true)
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(error = error.message ?: "Something went wrong")
                refreshAuthState()
                onDone(false)
            }
        }
    }

    fun updateTransaction(id: String, update: TransactionUpdate, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            try {
                withContext(dispatcher) { api.updateTransaction(id, update) }
                reloadFilteredData()
                onDone(true)
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(error = error.message ?: "Something went wrong")
                refreshAuthState()
                onDone(false)
            }
        }
    }

    fun deleteTransaction(id: String, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            try {
                withContext(dispatcher) { api.deleteTransaction(id) }
                reloadFilteredData()
                onDone(true)
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(error = error.message ?: "Something went wrong")
                refreshAuthState()
                onDone(false)
            }
        }
    }

    /**
     * Re-fetches only the transactions list for the current filters. Used by the
     * currency filter, which changes the list query but not the analytics one.
     */
    private suspend fun reloadTransactions() {
        val filters = mutableState.value.filters
        val transactions = withContext(dispatcher) {
            api.getTransactionsFiltered(filters, TransactionPage()).items
        }
        mutableState.value = mutableState.value.copy(transactions = transactions, error = null)
    }

    /**
     * Re-fetches the transactions list and analytics for the current filters/bucket,
     * without touching accounts/categories/tags (those don't depend on filters).
     * Used after create/update/delete and after any filter or bucket change.
     */
    private suspend fun reloadFilteredData() {
        val filters = mutableState.value.filters
        val bucket = mutableState.value.bucket
        val reloaded = withContext(dispatcher) {
            coroutineScope {
                val transactionsDeferred = async { api.getTransactionsFiltered(filters, TransactionPage()) }
                val analyticsDeferred = async { api.getAnalytics(filters, bucket) }
                // The heatmap always needs day buckets. Skip the second call when
                // the primary bucket is already "day".
                val dayAnalyticsDeferred =
                    if (bucket == "day") null else async { api.getAnalytics(filters, "day") }
                val transactions = transactionsDeferred.await().items
                val analytics = analyticsDeferred.await()
                val dayAnalytics = dayAnalyticsDeferred?.await() ?: analytics
                Triple(transactions, analytics, dayAnalytics)
            }
        }
        val (transactions, analytics, dayAnalytics) = reloaded
        mutableState.value = mutableState.value.copy(
            transactions = transactions,
            analytics = analytics,
            dayAnalytics = dayAnalytics,
            error = null,
        )
    }

    companion object {
        /** Builds a ViewModel backed by a real network [ApiClient] and live auth. */
        fun factory(sessionStore: SessionStore): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    val apiClient = ApiClient(sessionStore)
                    val authRepository = AuthRepository(apiClient, sessionStore)
                    return SessionViewModel(apiClient, Dispatchers.IO, sessionStore, authRepository) as T
                }
            }
    }
}
