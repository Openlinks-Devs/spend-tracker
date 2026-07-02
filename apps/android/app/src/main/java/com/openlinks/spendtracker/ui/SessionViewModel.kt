package com.openlinks.spendtracker.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.openlinks.spendtracker.data.Account
import com.openlinks.spendtracker.data.ApiClient
import com.openlinks.spendtracker.data.Category
import com.openlinks.spendtracker.data.NewTransaction
import com.openlinks.spendtracker.data.SessionStore
import com.openlinks.spendtracker.data.SpendApi
import com.openlinks.spendtracker.data.Transaction
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
    val error: String? = null,
) {
    val summary: SummaryTotals get() = SummaryCalculator.compute(transactions)

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
                // The four reads are independent; run them concurrently so a load
                // costs one round-trip, not four.
                val loaded = withContext(dispatcher) {
                    coroutineScope {
                        val transactionsDeferred = async { api.getTransactions() }
                        val accountsDeferred = async { api.getAccounts() }
                        val categoriesDeferred = async { api.getCategories() }
                        val tagsDeferred = async {
                            // Tags are optional, but never swallow cancellation.
                            runCatching { api.getTags() }.getOrElse { error ->
                                if (error is CancellationException) throw error
                                emptyList()
                            }
                        }
                        SpendUiState(
                            loading = false,
                            transactions = transactionsDeferred.await(),
                            accounts = accountsDeferred.await(),
                            categories = categoriesDeferred.await(),
                            tags = tagsDeferred.await(),
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

    fun createTransaction(transaction: NewTransaction, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            try {
                withContext(dispatcher) { api.createTransaction(transaction) }
                reloadTransactions()
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
                reloadTransactions()
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
                reloadTransactions()
                onDone(true)
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(error = error.message ?: "Something went wrong")
                onDone(false)
            }
        }
    }

    private suspend fun reloadTransactions() {
        val transactions = withContext(dispatcher) { api.getTransactions() }
        mutableState.value = mutableState.value.copy(transactions = transactions, error = null)
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
