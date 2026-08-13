import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpendingOverTimeChart } from './SpendingOverTimeChart'
import { axisCurrencyTooltip } from '@/lib/chartTooltip'
import type { SeriesRow } from '@/types'

// Capture the option handed to ECharts instead of rendering a real canvas.
const capturedOptions: Array<Record<string, unknown>> = []

vi.mock('@/components/EChart', () => ({
  EChart: (props: { option: Record<string, unknown> }) => {
    capturedOptions.push(props.option)
    return null
  },
}))

const rows: SeriesRow[] = [
  { bucketStart: '2026-03-01T00:00:00.000Z', currency: 'PEN', income: 0, spend: 5172.76, net: -5172.76 },
  { bucketStart: '2026-04-01T00:00:00.000Z', currency: 'PEN', income: 0, spend: 8100, net: -8100 },
]

afterEach(() => {
  cleanup()
  capturedOptions.length = 0
})

describe('SpendingOverTimeChart', () => {
  it('names its series so the tooltip does not fall back to the ECharts default', () => {
    render(<SpendingOverTimeChart rows={rows} currency="PEN" />)

    const series = capturedOptions[0].series as Array<{ name?: string }>
    expect(series[0].name).toBe('Spend')
    expect(series[0].name).not.toMatch(/^series\d+$/)
  })

  // ECharts passes the series name through to the tooltip as seriesName, which
  // is the value the user actually reads. "series0" appeared there because the
  // series was anonymous.
  it('labels the tooltip row with the series name', () => {
    render(<SpendingOverTimeChart rows={rows} currency="PEN" />)

    const series = capturedOptions[0].series as Array<{ name?: string }>
    const tooltipText = axisCurrencyTooltip('PEN')([
      { axisValueLabel: 'Mar 1, 2026', seriesName: series[0].name, marker: '', value: 5172.76 },
    ])

    expect(tooltipText).toContain('Spend')
    expect(tooltipText).not.toContain('series0')
  })
})
