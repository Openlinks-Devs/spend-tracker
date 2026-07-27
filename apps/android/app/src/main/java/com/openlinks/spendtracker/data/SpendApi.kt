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

    /** Moves money between two accounts, creating both legs atomically. */
    suspend fun createTransfer(transfer: TransferInput): TransferResult

    /** The signed-in user's linked Gmail/Telegram integrations. */
    suspend fun getConnections(): List<Connection>

    /** Unlinks an integration (Gmail grants are revoked server-side). */
    suspend fun deleteConnection(id: String)

    /**
     * Starts Gmail linking: returns the Google consent URL to open in a browser.
     * Throws [ApiException] with status 402 when the account's Gmail limit is
     * reached (free plans allow one).
     */
    suspend fun gmailLinkUrl(): String

    /** Mints a single-use pairing code and returns the t.me deep link for it. */
    suspend fun telegramPairCode(): String

    /**
     * Exchanges a Google ID token for a Better Auth session token. POSTs to
     * /api/auth/sign-in/social without a bearer header (no session yet) and
     * returns the session token read from the set-auth-token response header.
     */
    suspend fun exchangeGoogleIdToken(idToken: String): String

    /** Best-effort server-side sign-out; callers ignore failures. */
    suspend fun signOutRemote()
}
