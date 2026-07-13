package com.openlinks.spendtracker.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.openlinks.spendtracker.data.Account
import com.openlinks.spendtracker.data.AnalyticsPayload
import com.openlinks.spendtracker.data.ApiClient
import com.openlinks.spendtracker.data.Category
import com.openlinks.spendtracker.data.NewTransaction
import com.openlinks.spendtracker.data.SessionStore
import com.openlinks.spendtracker.data.SpendApi
import com.openlinks.spendtracker.data.Transaction
import com.openlinks.spendtracker.data.TransactionFilters
import com.openlinks.spendtracker.data.TransactionPage
import com.openlinks.spendtracker.data.TransactionUpdate
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
    val bucket: String = "month",
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

/**
 * Owns the [SpendApi] and app state. Constructor-injectable ([api], [dispatcher])
 * so the logic is exercised with a fake API and a test dispatcher in plain JUnit,
 * no Robolectric required. The production path builds a real [ApiClient] via the
 * companion [factory].
 */
class SessionViewModel(
    private val api: SpendApi,
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default,
) : ViewModel() {

    private val mutableState = MutableStateFlow(SpendUiState())
    val state: StateFlow<SpendUiState> = mutableState.asStateFlow()

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
            }
        }
    }

    /** Resets filters to their defaults and re-fetches. */
    fun clearFilters() {
        updateFilters { TransactionFilters() }
    }

    /**
     * Sets the display currency. Purely a rendering preference (per B1, currency
     * is never sent to the backend), so this does NOT re-fetch transactions or
     * analytics, unlike [updateFilters].
     */
    fun setCurrency(currency: String?) {
        mutableState.value = mutableState.value.copy(
            filters = mutableState.value.filters.copy(currency = currency),
        )
    }

    fun createTransaction(transaction: NewTransaction, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            try {
                withContext(dispatcher) { api.createTransaction(transaction) }
                reloadFilteredData()
                onDone(true)
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(error = error.message ?: "Something went wrong")
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
                onDone(false)
            }
        }
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
        /** Builds a ViewModel backed by a real network [ApiClient]. */
        fun factory(sessionStore: SessionStore): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    SessionViewModel(ApiClient(sessionStore), Dispatchers.IO) as T
            }
    }
}
