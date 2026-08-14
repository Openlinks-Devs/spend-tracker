package app.openlinks.spendtracker

import app.openlinks.spendtracker.data.EmailLogItem
import app.openlinks.spendtracker.data.EmailTransactionRef
import app.openlinks.spendtracker.ui.screens.emailVerdictIsError
import app.openlinks.spendtracker.ui.screens.emailVerdictLabel
import app.openlinks.spendtracker.ui.screens.openableTransactionId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EmailVerdictTest {

    @Test
    fun everyVerdictHasItsOwnCopy() {
        assertEquals("Imported", emailVerdictLabel("imported"))
        assertEquals("Not a transaction", emailVerdictLabel("not_transaction"))
        assertEquals("No accounts or categories set up", emailVerdictLabel("not_configured"))
        assertEquals("Could not read the details", emailVerdictLabel("extract_failed"))
        assertEquals("Processing failed", emailVerdictLabel("failed"))
        assertEquals("Unknown", emailVerdictLabel("unknown"))
    }

    @Test
    fun anUnrecognisedVerdictFallsBackToItsRawValue() {
        assertEquals("something_new", emailVerdictLabel("something_new"))
        assertFalse(emailVerdictIsError("something_new"))
    }

    @Test
    fun onlyRealFailuresReadAsProblems() {
        assertTrue(emailVerdictIsError("failed"))
        assertTrue(emailVerdictIsError("extract_failed"))
        // The overwhelmingly common case, every newsletter. It must read as neutral.
        assertFalse(emailVerdictIsError("not_transaction"))
        assertFalse(emailVerdictIsError("imported"))
        assertFalse(emailVerdictIsError("not_configured"))
        assertFalse(emailVerdictIsError("unknown"))
    }

    @Test
    fun anImportedRowOpensItsTransaction() {
        val email = emailLogItem(
            verdict = "imported",
            transaction = EmailTransactionRef("txn-1", "Coffee", -4.5, "USD"),
        )
        assertEquals("txn-1", openableTransactionId(email))
    }

    @Test
    fun anImportedRowWhoseTransactionWasDeletedOffersNoDeadLink() {
        val email = emailLogItem(verdict = "imported", transaction = null)
        assertNull(openableTransactionId(email))
    }

    @Test
    fun aRowWithoutATransactionIsNotOpenable() {
        assertNull(openableTransactionId(emailLogItem(verdict = "not_transaction", transaction = null)))
    }

    private fun emailLogItem(verdict: String, transaction: EmailTransactionRef?) = EmailLogItem(
        messageId = "msg-1",
        connectionId = "conn-1",
        accountEmail = "me@example.com",
        sender = "Bank <no-reply@bank.com>",
        subject = "Your purchase",
        emailDate = "2026-08-01T10:00:00Z",
        receivedAt = "2026-08-01T10:01:00Z",
        verdict = verdict,
        attempts = 1,
        transaction = transaction,
    )
}
