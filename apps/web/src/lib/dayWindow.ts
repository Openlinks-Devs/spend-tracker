// Zero-padded local calendar-day key (YYYY-MM-DD).
function toCalendarDayKey(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Turns a calendar-day key into the half-open filter window for that day:
 * [midnight, next midnight). Matches the backend's `created_at >= from AND
 * created_at < to`, so a day's transactions sum to exactly what the heatmap
 * cell shows.
 *
 * Both bounds are deliberately zone-less. `created_at` is `timestamp without
 * time zone`, and appending a Z would claim local time is UTC, which is the bug
 * that made every daily bucket render a day early west of UTC.
 *
 * Date arithmetic (rather than string slicing) is what carries month, year and
 * leap-day rollovers; `setDate` past the end of a month rolls forward correctly.
 */
export function toDayWindow(dayKey: string): { from: string; to: string } {
  // The time suffix forces local parsing; a bare YYYY-MM-DD parses as UTC and
  // would land on the previous day for negative offsets.
  const dayStart = new Date(`${dayKey}T00:00:00`)
  const nextDay = new Date(dayStart)
  nextDay.setDate(nextDay.getDate() + 1)
  return {
    from: `${toCalendarDayKey(dayStart)}T00:00:00.000`,
    to: `${toCalendarDayKey(nextDay)}T00:00:00.000`,
  }
}
