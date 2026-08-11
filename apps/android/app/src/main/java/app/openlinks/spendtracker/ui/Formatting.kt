package app.openlinks.spendtracker.ui

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

/** Deterministic amount and date formatting shared by the screens (and unit-testable). */
object Formatting {

    // Codes are fine in a filter chip but read badly next to a number, so the
    // currencies this app actually sees get their symbol.
    private val symbols: Map<String, String> = mapOf(
        "USD" to "$",
        "PEN" to "S/",
        "EUR" to "€",
        "GBP" to "£",
        "JPY" to "¥",
    )

    private val timeFormatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.US)
    private val dayFormatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("EEE, d MMM", Locale.US)
    private val dayWithYearFormatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("EEE, d MMM yyyy", Locale.US)

    /**
     * "-S/ 142.60", "$1,200.00". The sign leads so a column of amounts stays
     * readable, and an unknown currency falls back to its code.
     */
    fun money(amount: Double, currency: String): String {
        val sign = if (amount < 0) "-" else ""
        val magnitude = String.format(Locale.US, "%,.2f", abs(amount))
        return sign + withCurrency(magnitude, currency)
    }

    /**
     * "$ 1.2K", "-S/ 2.5M", "$ 42.50". The abbreviated form of [money], for places
     * where the full amount does not fit: a chart's value axis is a narrow gutter,
     * and "$ 1,234,567.00" there either clips or squeezes the plot. Everything the
     * user reads is still formatted money (never a raw Double such as
     * 37636.219999999994), just shortened. An amount below a thousand keeps its
     * cents, since that is what the gutter has room for anyway.
     *
     * A blank [currency] drops the prefix entirely rather than printing a stray
     * space, so a chart with no rows to read a currency off still renders.
     */
    fun compactMoney(amount: Double, currency: String): String {
        val sign = if (amount < 0) "-" else ""
        return sign + withCurrency(compactMagnitude(abs(amount)), currency)
    }

    /**
     * [amount] rounded to whole cents. Aggregating a column of doubles drifts (web
     * surfaced a folded bucket total as 37636.219999999994), and the drift shows up
     * the moment that total is formatted or compared, so every aggregate this app
     * computes is rounded here first. BigDecimal rather than round(x * 100) / 100
     * because the latter is itself a floating-point operation on the scaled value.
     * Non-finite input is passed through: BigDecimal cannot represent it.
     */
    fun roundToCents(amount: Double): Double {
        if (!amount.isFinite()) return amount
        return BigDecimal.valueOf(amount).setScale(2, RoundingMode.HALF_UP).toDouble()
    }

    private fun withCurrency(magnitude: String, currency: String): String {
        val prefix = symbols[currency.uppercase(Locale.US)]
        return when {
            prefix != null -> "$prefix $magnitude"
            currency.isBlank() -> magnitude
            else -> "$currency $magnitude"
        }
    }

    /** The unsigned part of [compactMoney]: "1.2K", "3M", "42.50". */
    private fun compactMagnitude(magnitude: Double): String = when {
        magnitude >= 1_000_000_000.0 -> "${oneDecimal(magnitude / 1_000_000_000.0)}B"
        magnitude >= 1_000_000.0 -> "${oneDecimal(magnitude / 1_000_000.0)}M"
        magnitude >= 1_000.0 -> "${oneDecimal(magnitude / 1_000.0)}K"
        else -> String.format(Locale.US, "%,.2f", magnitude)
    }

    /** One decimal place, with a trailing ".0" dropped so 1000 reads "1K", not "1.0K". */
    private fun oneDecimal(value: Double): String =
        String.format(Locale.US, "%.1f", value).removeSuffix(".0")

    /** The calendar day an ISO timestamp falls on, in the device's zone. */
    fun localDate(isoTimestamp: String, zone: ZoneId = ZoneId.systemDefault()): LocalDate? =
        runCatching { Instant.parse(isoTimestamp).atZone(zone).toLocalDate() }.getOrNull()

    /** "27 Jul 2026, 01:56", or the raw value if it cannot be parsed. */
    fun dateTime(isoTimestamp: String, zone: ZoneId = ZoneId.systemDefault()): String =
        runCatching { Instant.parse(isoTimestamp).atZone(zone).format(timeFormatter) }
            .getOrDefault(isoTimestamp)

    /**
     * The heading for a day group: "Today" and "Yesterday" for the two days a
     * user recognises at a glance, an explicit date otherwise (with the year
     * only once it differs from [today], which is the only time it carries
     * information).
     */
    fun dayHeading(day: LocalDate, today: LocalDate): String = when {
        day == today -> "Today"
        day == today.minusDays(1) -> "Yesterday"
        day.year == today.year -> day.format(dayFormatter)
        else -> day.format(dayWithYearFormatter)
    }
}
