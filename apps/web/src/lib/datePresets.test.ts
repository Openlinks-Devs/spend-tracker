import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectPreset, presetRange } from '@/lib/datePresets'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-11T10:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('presetRange', () => {
  it('computes this-month bounds', () => {
    expect(presetRange('this-month')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
  })

  it('computes last-month bounds', () => {
    expect(presetRange('last-month')).toEqual({ from: '2026-06-01', to: '2026-06-30' })
  })

  it('computes this-year bounds', () => {
    expect(presetRange('this-year')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('returns an empty range for all-time', () => {
    expect(presetRange('all-time')).toEqual({})
  })

  it('returns an empty range for custom', () => {
    expect(presetRange('custom')).toEqual({})
  })
})

describe('detectPreset', () => {
  it('recognizes the this-month range', () => {
    expect(detectPreset({ from: '2026-07-01', to: '2026-07-31' })).toBe('this-month')
  })

  it('treats an empty range as all-time', () => {
    expect(detectPreset({})).toBe('all-time')
  })

  it('falls back to custom for a partial or unmatched range', () => {
    expect(detectPreset({ from: '2026-07-05' })).toBe('custom')
    expect(detectPreset({ from: '2026-07-01', to: '2026-07-15' })).toBe('custom')
  })
})
