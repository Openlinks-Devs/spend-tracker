package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.ApiClient
import com.openlinks.spendtracker.data.ApiException
import com.openlinks.spendtracker.data.InMemoryKeyValueStore
import com.openlinks.spendtracker.data.NewTransaction
import com.openlinks.spendtracker.data.SessionStore
import com.openlinks.spendtracker.data.TransactionFilters
import com.openlinks.spendtracker.data.TransactionPage
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class ApiClientTest {

    private lateinit var server: MockWebServer

    private fun client(): ApiClient = ApiClient(
        session = SessionStore(InMemoryKeyValueStore()),
        baseUrl = server.url("/").toString(),
        useMockAuth = true,
        mockUser = "demo-user",
    )

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun parsesTransactionListEnvelopeAndSendsMockUserHeader() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """
                    {
                      "items": [
                        {
                          "id": "t1",
                          "description": "Coffee",
                          "amount": -4.5,
                          "currency": "USD",
                          "account_id": "acc-1",
                          "category_id": "cat-1",
                          "tags": ["food"],
                          "created_at": "2026-07-02T00:00:00Z",
                          "updated_at": null
                        }
                      ],
                      "total": 1,
                      "limit": 50,
                      "offset": 0
                    }
                    """.trimIndent(),
                ),
        )

        val transactions = client().getTransactions()

        assertEquals(1, transactions.size)
        val transaction = transactions.first()
        assertEquals("t1", transaction.id)
        assertEquals("Coffee", transaction.description)
        assertEquals(-4.5, transaction.amount, 0.0001)
        assertEquals("acc-1", transaction.accountId)
        assertEquals("cat-1", transaction.categoryId)
        assertEquals(listOf("food"), transaction.tags)
        assertNull(transaction.updatedAt)

        val recorded = server.takeRequest()
        assertEquals("/api/transactions", recorded.path)
        assertEquals("demo-user", recorded.getHeader("x-mock-user"))
    }

    @Test
    fun postSerializesBodyWithSnakeCaseKeys() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(201)
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """
                    {
                      "id": "t2",
                      "description": "Lunch",
                      "amount": -12.0,
                      "currency": "USD",
                      "account_id": "acc-1",
                      "category_id": "cat-1",
                      "tags": [],
                      "created_at": "2026-07-02T12:00:00Z",
                      "updated_at": null
                    }
                    """.trimIndent(),
                ),
        )

        val created = client().createTransaction(
            NewTransaction(
                description = "Lunch",
                amount = -12.0,
                currency = "USD",
                accountId = "acc-1",
                categoryId = "cat-1",
                tags = emptyList(),
            ),
        )

        assertEquals("t2", created.id)

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        val sentBody = recorded.body.readUtf8()
        assertTrue(sentBody.contains("\"account_id\":\"acc-1\""))
        assertTrue(sentBody.contains("\"category_id\":\"cat-1\""))
    }

    @Test
    fun nonSuccessThrowsApiExceptionWithBackendMessage() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(404)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"error":"Transaction not found"}"""),
        )

        try {
            client().getTransaction("missing")
            fail("Expected ApiException")
        } catch (error: ApiException) {
            assertEquals(404, error.status)
            assertEquals("Transaction not found", error.message)
        }
        Unit
    }

    @Test
    fun getAnalyticsParsesAllFiveRowArraysAndSendsBucketAndFilterParams() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """
                    {
                      "summary": [
                        {"currency": "USD", "income": 100.0, "spend": -40.0, "net": 60.0, "count": 5}
                      ],
                      "series": [
                        {"bucketStart": "2026-07-01", "currency": "USD", "income": 100.0, "spend": -40.0, "net": 60.0}
                      ],
                      "byCategory": [
                        {"categoryId": "cat-1", "currency": "USD", "spend": -40.0, "income": 0.0, "net": -40.0, "count": 3}
                      ],
                      "byTag": [
                        {"tag": "food", "currency": "USD", "spend": -40.0, "count": 3}
                      ],
                      "byAccount": [
                        {"accountId": "acc-1", "currency": "USD", "income": 100.0, "spend": -40.0, "net": 60.0, "count": 5}
                      ]
                    }
                    """.trimIndent(),
                ),
        )

        val filters = TransactionFilters(accountIds = listOf("acc-1"), categoryIds = listOf("cat-1"))
        val payload = client().getAnalytics(filters, "day")

        assertEquals(1, payload.summary.size)
        assertEquals("USD", payload.summary.first().currency)
        assertEquals(1, payload.series.size)
        assertEquals("2026-07-01", payload.series.first().bucketStart)
        assertEquals(1, payload.byCategory.size)
        assertEquals("cat-1", payload.byCategory.first().categoryId)
        assertEquals(1, payload.byTag.size)
        assertEquals("food", payload.byTag.first().tag)
        assertEquals(1, payload.byAccount.size)
        assertEquals("acc-1", payload.byAccount.first().accountId)

        val recorded = server.takeRequest()
        assertEquals("/api/transactions/analytics", recorded.path?.substringBefore('?'))
        val requestUrl = recorded.requestUrl!!
        assertEquals("day", requestUrl.queryParameter("bucket"))
        assertEquals(listOf("acc-1"), requestUrl.queryParameterValues("account"))
        assertEquals(listOf("cat-1"), requestUrl.queryParameterValues("category"))
    }

    @Test
    fun getTransactionsFilteredSendsFilterParamsAndParsesEnvelope() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """
                    {
                      "items": [],
                      "total": 0,
                      "limit": 25,
                      "offset": 10
                    }
                    """.trimIndent(),
                ),
        )

        val filters = TransactionFilters(
            query = "coffee",
            tags = listOf("food", "drinks"),
            currency = "USD",
        )
        val page = TransactionPage(limit = 25, offset = 10)

        val response = client().getTransactionsFiltered(filters, page)

        assertEquals(0, response.total)
        assertEquals(25, response.limit)
        assertEquals(10, response.offset)

        val recorded = server.takeRequest()
        assertEquals("/api/transactions", recorded.path?.substringBefore('?'))
        val requestUrl = recorded.requestUrl!!
        assertEquals("coffee", requestUrl.queryParameter("q"))
        assertEquals(listOf("food", "drinks"), requestUrl.queryParameterValues("tag"))
        assertEquals("25", requestUrl.queryParameter("limit"))
        assertEquals("10", requestUrl.queryParameter("offset"))
        assertNull(requestUrl.queryParameter("currency"))
    }
}
