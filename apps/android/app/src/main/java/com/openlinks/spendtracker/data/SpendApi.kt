package com.openlinks.spendtracker.data

/**
 * The set of backend calls the app makes. An interface so the ViewModel can be
 * unit-tested against a fake, while [ApiClient] wires the real OkHttp transport.
 */
interface SpendApi {
    suspend fun getTransactions(): List<Transaction>
    suspend fun getTransaction(id: String): Transaction
    suspend fun createTransaction(transaction: NewTransaction): Transaction
    suspend fun updateTransaction(id: String, update: TransactionUpdate): Transaction
    suspend fun deleteTransaction(id: String)
    suspend fun getAccounts(): List<Account>
    suspend fun getCategories(): List<Category>
    suspend fun getTags(): List<String>
    suspend fun getTransactionsFiltered(filters: TransactionFilters, page: TransactionPage): TransactionListResponse
    suspend fun getAnalytics(filters: TransactionFilters, bucket: String): AnalyticsPayload
}
