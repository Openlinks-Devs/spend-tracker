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
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
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

    fun transactionById(id: String): Transaction? =
        transactions.firstOrNull { transaction -> transaction.id == id }

    fun accountName(accountId: String?): String? =
        accounts.firstOrNull { account -> account.id == accountId }?.name

    fun categoryName(categoryId: String?): String? =
        categories.firstOrNull { category -> category.id == categoryId }?.name
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
                val transactions = withContext(dispatcher) { api.getTransactions() }
                val accounts = withContext(dispatcher) { api.getAccounts() }
                val categories = withContext(dispatcher) { api.getCategories() }
                val tags = withContext(dispatcher) { runCatching { api.getTags() }.getOrDefault(emptyList()) }
                mutableState.value = SpendUiState(
                    loading = false,
                    transactions = transactions,
                    accounts = accounts,
                    categories = categories,
                    tags = tags,
                    error = null,
                )
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
