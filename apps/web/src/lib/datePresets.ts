export type DatePreset = 'this-month' | 'last-month' | 'this-year' | 'all-time' | 'custom'

export interface DateRange {
  from?: string
  to?: string
}

export const datePresetOptions: { value: Exclude<DatePreset, 'custom'> | 'custom'; label: string }[] =
  [
    { value: 'this-month', label: 'This month' },
    { value: 'last-month', label: 'Last month' },
    { value: 'this-year', label: 'This year' },
    { value: 'all-time', label: 'All time' },
    { value: 'custom', label: 'Custom range' },
  ]

// Local-date "YYYY-MM-DD" string, matching the occurred_at date filter contract.
function toDateOnly(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function presetRange(preset: DatePreset, now: Date = new Date()): DateRange {
  switch (preset) {
    case 'this-month':
      return {
        from: toDateOnly(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: toDateOnly(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      }
    case 'last-month':
      return {
        from: toDateOnly(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: toDateOnly(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    case 'this-year':
      return {
        from: toDateOnly(new Date(now.getFullYear(), 0, 1)),
        to: toDateOnly(new Date(now.getFullYear(), 11, 31)),
      }
    case 'all-time':
    case 'custom':
      return {}
  }
}

export function detectPreset(range: DateRange, now: Date = new Date()): DatePreset {
  if (!range.from && !range.to) return 'all-time'
  const candidates: Exclude<DatePreset, 'all-time' | 'custom'>[] = [
    'this-month',
    'last-month',
    'this-year',
  ]
  for (const candidate of candidates) {
    const candidateRange = presetRange(candidate, now)
    if (candidateRange.from === range.from && candidateRange.to === range.to) {
      return candidate
    }
  }
  return 'custom'
}
