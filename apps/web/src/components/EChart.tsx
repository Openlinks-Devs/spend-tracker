import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, PieChart, LineChart, HeatmapChart } from 'echarts/charts'
import {
  GridComponent, TitleComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, CalendarComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([
  BarChart, PieChart, LineChart, HeatmapChart,
  GridComponent, TitleComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, CalendarComponent, CanvasRenderer,
])

type EChartClickHandler = (params: { data?: unknown; name?: string; value?: unknown }) => void

interface EChartProps {
  option: EChartsCoreOption
  height: number
  onEvents?: { click?: EChartClickHandler }
}

export function EChart({ option, height, onEvents }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.EChartsType | undefined>(undefined)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = echarts.init(container)
    chartRef.current = chart
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      chart.dispose()
      chartRef.current = undefined
    }
  }, [])

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

  return <div ref={containerRef} style={{ height, width: '100%' }} />
}
