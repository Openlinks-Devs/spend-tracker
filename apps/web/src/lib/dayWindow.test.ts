import { describe, expect, it } from 'vitest'
import { toDayWindow } from './dayWindow'

// The window feeds the transactions filter, where the backend compares
// created_at >= from AND created_at < to. So `to` is the exclusive start of the
// next day, and both bounds stay zone-less local timestamps to match the
// zone-less `created_at` column (see the bucketStart fix in db/queries.ts).
describe('toDayWindow', () => {
  it('spans one day, half-open', () => {
    expect(toDayWindow('2026-05-19')).toEqual({
      from: '2026-05-19T00:00:00.000',
      to: '2026-05-20T00:00:00.000',
    })
  })

  it('rolls over a month boundary', () => {
    expect(toDayWindow('2026-05-31')).toEqual({
      from: '2026-05-31T00:00:00.000',
      to: '2026-06-01T00:00:00.000',
    })
  })

  it('rolls over a year boundary', () => {
    expect(toDayWindow('2026-12-31')).toEqual({
      from: '2026-12-31T00:00:00.000',
      to: '2027-01-01T00:00:00.000',
    })
  })

  it('handles a leap day', () => {
    expect(toDayWindow('2028-02-29')).toEqual({
      from: '2028-02-29T00:00:00.000',
      to: '2028-03-01T00:00:00.000',
    })
  })

  // No offset suffix anywhere: appending Z would reintroduce exactly the bug
  // that made the heatmap render every bucket a day early west of UTC.
  it('never emits a UTC offset suffix', () => {
    const { from, to } = toDayWindow('2026-05-19')
    expect(from.endsWith('Z')).toBe(false)
    expect(to.endsWith('Z')).toBe(false)
  })
})
