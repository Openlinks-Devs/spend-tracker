package app.openlinks.spendtracker

import app.openlinks.spendtracker.data.Connection
import app.openlinks.spendtracker.ui.brokenGmailConnections
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BrokenConnectionsTest {

    private fun connection(status: String, provider: String = "gmail", email: String = "me@example.com") =
        Connection("conn-$status-$provider", provider, status, email, "2026-08-01T00:00:00Z")

    @Test
    fun picksTheGmailAccountsThatLostAccess() {
        val broken = brokenGmailConnections(
            listOf(connection("needs_reauth", email = "broken@example.com"), connection("active")),
        )

        assertEquals(1, broken.size)
        assertEquals("broken@example.com", broken.first().externalId)
    }

    @Test
    fun ignoresHealthyConnections() {
        assertTrue(brokenGmailConnections(listOf(connection("active"))).isEmpty())
    }

    /**
     * A disabled connection is over the plan's account cap. The user cannot
     * repair that by reconnecting, so it is a billing state rather than a
     * breakage, and the backend's Telegram alert draws the same line.
     */
    @Test
    fun ignoresConnectionsParkedByThePlanLimit() {
        assertTrue(brokenGmailConnections(listOf(connection("disabled"))).isEmpty())
    }

    @Test
    fun ignoresTelegramRegardlessOfStatus() {
        assertTrue(brokenGmailConnections(listOf(connection("needs_reauth", provider = "telegram"))).isEmpty())
    }

    @Test
    fun returnsEveryBrokenAccountWhenSeveralAreDown() {
        val broken = brokenGmailConnections(
            listOf(
                connection("needs_reauth", email = "one@example.com"),
                connection("needs_reauth", email = "two@example.com"),
            ),
        )

        assertEquals(listOf("one@example.com", "two@example.com"), broken.map { it.externalId })
    }
}
