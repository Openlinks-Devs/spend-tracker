import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, PieChart, LineChart, HeatmapChart } from 'echarts/charts'
import {
  GridComponent, TitleComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, CalendarComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import { chartThemeFor } from '@/lib/echartsTheme'
import { useIsDarkTheme } from '@/hooks/useTheme'

echarts.use([
  BarChart, PieChart, LineChart, HeatmapChart,
  GridComponent, TitleComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, CalendarComponent, CanvasRenderer,
])

// Axis, grid, legend and tooltip chrome is registered once per surface rather
// than repeated in every chart option. ECharts bakes the theme in at init, which
// is why the chart is torn down and rebuilt when the surface changes.
function registerSurfaceTheme(name: string, isDark: boolean) {
  const theme = chartThemeFor(isDark)
  echarts.registerTheme(name, {
    backgroundColor: 'transparent',
    textStyle: { color: theme.axisLabel },
    title: { textStyle: { color: theme.tooltipText } },
    legend: { textStyle: { color: theme.axisLabel } },
    tooltip: {
      backgroundColor: theme.tooltipBackground,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText },
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: theme.gridLine } },
      axisTick: { lineStyle: { color: theme.gridLine } },
      axisLabel: { color: theme.axisLabel },
      splitLine: { lineStyle: { color: theme.gridLine } },
    },
    valueAxis: {
      axisLine: { lineStyle: { color: theme.gridLine } },
      axisTick: { lineStyle: { color: theme.gridLine } },
      axisLabel: { color: theme.axisLabel },
      splitLine: { lineStyle: { color: theme.gridLine } },
    },
    visualMap: { textStyle: { color: theme.axisLabel } },
  })
}

registerSurfaceTheme('spendtracker-light', false)
registerSurfaceTheme('spendtracker-dark', true)

type EChartClickHandler = (params: { data?: unknown; name?: string; value?: unknown }) => void

interface EChartProps {
  option: EChartsCoreOption
  height: number
  onEvents?: { click?: EChartClickHandler }
}

export function EChart({ option, height, onEvents }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.EChartsType | undefined>(undefined)
  const isDark = useIsDarkTheme()

  // Keyed on isDark: ECharts resolves a theme at init and offers no way to swap
  // it afterwards, so switching surfaces disposes and rebuilds. The option
  // effect below re-applies the series immediately after.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = echarts.init(container, isDark ? 'spendtracker-dark' : 'spendtracker-light')
    chartRef.current = chart
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      chart.dispose()
      chartRef.current = undefined
    }
  }, [isDark])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onEvents?.click) return
    const handler = onEvents.click
    chart.on('click', handler)
    return () => {
      chart.off('click', handler)
    }
  }, [onEvents])

  // minWidth:0 lets the container shrink inside flex/grid parents; overflow
  // hidden stops a canvas that is momentarily wider (between a resize and the
  // observer firing) from widening the page.
  return (
    <div
      ref={containerRef}
      style={{ height, width: '100%', minWidth: 0, overflow: 'hidden' }}
    />
  )
}
