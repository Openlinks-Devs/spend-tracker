package app.openlinks.spendtracker.ui

import app.openlinks.spendtracker.data.Transaction
import java.time.LocalDate
import java.time.ZoneId

/**
 * One day's worth of transactions plus what they net out to. [netByCurrency] is a
 * list rather than a map so the render order is stable, and it holds one entry per
 * currency because a day can mix them and summing across would be meaningless.
 */
data class TransactionDayGroup(
    val heading: String,
    val netByCurrency: List<Pair<String, Double>>,
    val transactions: List<Transaction>,
)

/**
 * Groups [transactions] into day buckets for the list, keeping the order they
 * arrive in (the backend already sorts them) so this never re-sorts behind the
 * caller's back. Rows whose timestamp cannot be parsed fall into a bucket keyed
 * by their raw value rather than being dropped.
 */
fun groupTransactionsByDay(
    transactions: List<Transaction>,
    today: LocalDate,
    zone: ZoneId = ZoneId.systemDefault(),
): List<TransactionDayGroup> {
    val ordered = LinkedHashMap<String, MutableList<Transaction>>()
    val headings = mutableMapOf<String, String>()

    transactions.forEach { transaction ->
        val day = Formatting.localDate(transaction.createdAt, zone)
        val key = day?.toString() ?: transaction.createdAt
        headings.getOrPut(key) { day?.let { Formatting.dayHeading(it, today) } ?: transaction.createdAt }
        ordered.getOrPut(key) { mutableListOf() }.add(transaction)
    }

    return ordered.map { (key, dayTransactions) ->
        TransactionDayGroup(
            heading = headings.getValue(key),
            netByCurrency = netByCurrency(dayTransactions),
            transactions = dayTransactions,
        )
    }
}

// One net per currency, in the order each currency first appears that day.
private fun netByCurrency(transactions: List<Transaction>): List<Pair<String, Double>> {
    val totals = LinkedHashMap<String, Double>()
    transactions.forEach { transaction ->
        totals[transaction.currency] = (totals[transaction.currency] ?: 0.0) + transaction.amount
    }
    return totals.toList()
}
