package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.ApiClient
import com.openlinks.spendtracker.data.ApiException
import com.openlinks.spendtracker.data.InMemoryKeyValueStore
import com.openlinks.spendtracker.data.NewTransaction
import com.openlinks.spendtracker.data.SessionStore
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
}
