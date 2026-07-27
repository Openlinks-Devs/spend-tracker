package com.openlinks.spendtracker.ui

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
        val prefix = symbols[currency.uppercase(Locale.US)]
        return if (prefix != null) "$sign$prefix $magnitude" else "$sign$currency $magnitude"
    }

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
