package com.openlinks.spendtracker.data

import com.openlinks.spendtracker.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/** Raised when the backend returns a non-2xx status. Carries the parsed message. */
class ApiException(val status: Int, message: String) : Exception(message)

/**
 * OkHttp + kotlinx.serialization transport for the backend /api routes. The
 * interceptor reads the live session on every request and picks the auth header
 * via [authHeaders], keeping the mock/live seam in one place. Config values
 * default from [BuildConfig] but are injectable so tests can point at a
 * MockWebServer without any Android BuildConfig dependency.
 */
class ApiClient(
    private val session: SessionStore,
    baseUrl: String = BuildConfig.API_BASE_URL,
    private val useMockAuth: Boolean = BuildConfig.USE_MOCK_AUTH,
    private val mockUser: String = BuildConfig.MOCK_USER,
    private val http: OkHttpClient = OkHttpClient.Builder().build(),
) : SpendApi {

    // Normalize so we can safely concatenate "/api/..." paths.
    private val root: String = baseUrl.trimEnd('/')

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private fun newRequest(path: String): Request.Builder {
        val builder = Request.Builder()
            .url(root + path)
            .header("Accept", "application/json")
        authHeaders(useMockAuth, mockUser, session.authState()).forEach { (key, value) ->
            builder.header(key, value)
        }
        return builder
    }

    private fun errorMessage(body: String, status: Int): String = try {
        json.decodeFromString(ApiError.serializer(), body).error
    } catch (_: Exception) {
        "Request failed with status $status"
    }

    private inline fun <reified T> decodeBody(response: Response): T {
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            if (response.code == 401 && !useMockAuth) session.clear()
            throw ApiException(response.code, errorMessage(body, response.code))
        }
        return json.decodeFromString(json.serializersModule.serializer(), body)
    }

    private suspend inline fun <reified T> getJson(path: String): T = withContext(Dispatchers.IO) {
        http.newCall(newRequest(path).get().build()).execute().use { response ->
            decodeBody<T>(response)
        }
    }

    private suspend fun execExpectingNoContent(request: Request) = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                if (response.code == 401 && !useMockAuth) session.clear()
                throw ApiException(response.code, errorMessage(body, response.code))
            }
        }
    }

    override suspend fun getTransactions(): List<Transaction> = getJson("/api/transactions")

    override suspend fun getTransaction(id: String): Transaction = getJson("/api/transactions/$id")

    override suspend fun createTransaction(transaction: NewTransaction): Transaction =
        withContext(Dispatchers.IO) {
            val payload = json.encodeToString(NewTransaction.serializer(), transaction)
            val request = newRequest("/api/transactions")
                .post(payload.toRequestBody(jsonMediaType))
                .build()
            http.newCall(request).execute().use { response -> decodeBody<Transaction>(response) }
        }

    override suspend fun updateTransaction(id: String, update: TransactionUpdate): Transaction =
        withContext(Dispatchers.IO) {
            val payload = json.encodeToString(TransactionUpdate.serializer(), update)
            val request = newRequest("/api/transactions/$id")
                .patch(payload.toRequestBody(jsonMediaType))
                .build()
            http.newCall(request).execute().use { response -> decodeBody<Transaction>(response) }
        }

    override suspend fun deleteTransaction(id: String) {
        execExpectingNoContent(newRequest("/api/transactions/$id").delete().build())
    }

    override suspend fun getAccounts(): List<Account> = getJson("/api/accounts")

    override suspend fun getCategories(): List<Category> = getJson("/api/categories")

    override suspend fun getTags(): List<String> = getJson("/api/tags")
}
