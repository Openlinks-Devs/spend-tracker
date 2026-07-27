package com.openlinks.spendtracker

import com.openlinks.spendtracker.data.Transaction
import com.openlinks.spendtracker.ui.groupTransactionsByDay
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class TransactionGroupingTest {

    private val utc = ZoneId.of("UTC")
    private val today = LocalDate.of(2026, 7, 27)

    private fun transaction(
        id: String,
        amount: Double,
        createdAt: String,
        currency: String = "PEN",
    ) = Transaction(
        id = id,
        description = "Row $id",
        amount = amount,
        currency = currency,
        accountId = "acc-1",
        categoryId = "cat-1",
        tags = emptyList(),
        createdAt = createdAt,
        updatedAt = null,
    )

    @Test
    fun groupsByCalendarDayAndKeepsIncomingOrder() {
        val groups = groupTransactionsByDay(
            listOf(
                transaction("a", -10.0, "2026-07-27T10:00:00Z"),
                transaction("b", -20.0, "2026-07-27T08:00:00Z"),
                transaction("c", -30.0, "2026-07-26T09:00:00Z"),
            ),
            today,
            utc,
        )

        assertEquals(2, groups.size)
        assertEquals("Today", groups[0].heading)
        assertEquals(listOf("a", "b"), groups[0].transactions.map { row -> row.id })
        assertEquals("Yesterday", groups[1].heading)
        assertEquals(listOf("c"), groups[1].transactions.map { row -> row.id })
    }

    @Test
    fun netsEachDayPerCurrency() {
        val groups = groupTransactionsByDay(
            listOf(
                transaction("a", -10.0, "2026-07-27T10:00:00Z", currency = "PEN"),
                transaction("b", -20.0, "2026-07-27T09:00:00Z", currency = "PEN"),
                transaction("c", 100.0, "2026-07-27T08:00:00Z", currency = "USD"),
            ),
            today,
            utc,
        )

        assertEquals(listOf("PEN" to -30.0, "USD" to 100.0), groups.single().netByCurrency)
    }

    @Test
    fun daysApartInTheSameMonthGetTheirOwnGroups() {
        val groups = groupTransactionsByDay(
            listOf(
                transaction("a", -10.0, "2026-07-20T10:00:00Z"),
                transaction("b", -20.0, "2026-07-19T10:00:00Z"),
            ),
            today,
            utc,
        )

        assertEquals(listOf("Mon, 20 Jul", "Sun, 19 Jul"), groups.map { group -> group.heading })
    }

    @Test
    fun unparseableTimestampsAreKeptRatherThanDropped() {
        val groups = groupTransactionsByDay(
            listOf(transaction("a", -10.0, "whenever")),
            today,
            utc,
        )

        assertEquals(1, groups.size)
        assertEquals("whenever", groups.single().heading)
        assertEquals(listOf("a"), groups.single().transactions.map { row -> row.id })
    }

    @Test
    fun noTransactionsMeansNoGroups() {
        assertEquals(emptyList<Any>(), groupTransactionsByDay(emptyList(), today, utc))
    }
}
