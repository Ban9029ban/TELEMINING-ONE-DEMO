import React, { useState } from 'react'

const SVG_WIDTH = 720
const SVG_HEIGHT = 300
const CHART_PADDING = { top: 18, right: 18, bottom: 52, left: 48 }
const EXPORT_WIDTH = 1280
const EXPORT_BASE_HEIGHT = 760
const EXPORT_PLOT_PADDING = { top: 160, right: 64, bottom: 98, left: 86 }
const EXPORT_BG = '#ffffff'
const EXPORT_TEXT = '#223455'
const EXPORT_MUTED = '#6b7485'
const EXPORT_GRID = 'rgba(107,116,133,.18)'
const EXPORT_FONT = "Inter, 'Segoe UI', Arial, sans-serif"

function formatNumber(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return String(value || 0)
  return numeric.toLocaleString('es-CL')
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function slugify(value) {
  return String(value || 'grafico')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function exportTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
}

function csvEscape(value) {
  const raw = String(value ?? '')
  if (/[",\n;]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`
  }
  return raw
}

function buildCsvRows(chart) {
  const chartType = chart?.type || 'line'
  if (chartType === 'scatter') {
    return [
      [chart?.x_label || 'x', chart?.y_label || 'y', 'etiqueta', 'detalle', 'estado'],
      ...((chart?.points || []).map((point) => [
        point?.x ?? '',
        point?.y ?? '',
        point?.label ?? '',
        point?.detail ?? '',
        point?.status ?? '',
      ])),
    ]
  }

  if (chartType === 'horizontal_bar') {
    return [
      ['etiqueta', 'detalle', 'valor_visible', 'valor_numerico', 'indicador_secundario', 'valor_secundario_visible', 'valor_secundario_numerico'],
      ...((chart?.items || []).map((item) => [
        item?.label ?? '',
        item?.detail ?? '',
        item?.value ?? '',
        item?.raw_value ?? '',
        item?.secondary_label ?? '',
        item?.secondary_value ?? '',
        item?.secondary_raw_value ?? '',
      ])),
    ]
  }

  if (chartType === 'segment_bar') {
    return [
      ['etiqueta', 'valor_visible', 'valor_numerico'],
      ...((chart?.segments || []).map((segment) => [
        segment?.label ?? '',
        segment?.value ?? '',
        segment?.raw_value ?? '',
      ])),
    ]
  }

  const categories = chart?.categories || []
  const series = chart?.series || []
  return [
    ['categoria', ...series.map((item) => item?.label ?? item?.key ?? 'serie')],
    ...categories.map((category, index) => [
      category,
      ...series.map((item) => item?.data?.[index] ?? 0),
    ]),
  ]
}

function exportChartCsv(chart) {
  const rows = buildCsvRows(chart)
  const content = `\uFEFF${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}`
  const filename = `sismico_${slugify(chart?.key || chart?.title)}_${exportTimestamp()}.csv`
  downloadBlob(new Blob([content], { type: 'text/csv;charset=utf-8;' }), filename)
}

function formatPointLabel(point) {
  const parts = [point?.label, point?.detail].filter(Boolean)
  return parts.join(' / ')
}

function maxSeriesValue(series = [], stacked = false) {
  if (!Array.isArray(series) || !series.length) return 1
  const length = Math.max(...series.map((item) => item?.data?.length || 0), 0)
  let maxValue = 0
  for (let index = 0; index < length; index += 1) {
    if (stacked) {
      const total = series.reduce((sum, item) => sum + Number(item?.data?.[index] || 0), 0)
      maxValue = Math.max(maxValue, total)
    } else {
      series.forEach((item) => {
        maxValue = Math.max(maxValue, Number(item?.data?.[index] || 0))
      })
    }
  }
  return Math.max(maxValue, 1)
}

function buildGridLines(maxValue) {
  return Array.from({ length: 4 }, (_, idx) => {
    const ratio = idx / 3
    const value = Math.round(maxValue * (1 - ratio))
    const y = CHART_PADDING.top + ((SVG_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom) * ratio)
    return { value, y }
  })
}

function buildExportGridLines(maxValue, height) {
  return Array.from({ length: 4 }, (_, idx) => {
    const ratio = idx / 3
    const value = Math.round(maxValue * (1 - ratio))
    const y = EXPORT_PLOT_PADDING.top + ((height - EXPORT_PLOT_PADDING.top - EXPORT_PLOT_PADDING.bottom) * ratio)
    return { value, y }
  })
}

function buildLegendSvg(items = []) {
  if (!items.length) return ''
  let cursorX = 86
  let cursorY = 122
  return items.map((item) => {
    if (cursorX > EXPORT_WIDTH - 220) {
      cursorX = 86
      cursorY += 28
    }
    const chunk = `
      <rect x="${cursorX}" y="${cursorY - 10}" width="12" height="12" rx="6" ry="6" fill="${escapeXml(item?.color || '#4968ee')}" />
      <text x="${cursorX + 20}" y="${cursorY}" font-size="13" fill="${EXPORT_MUTED}">${escapeXml(item?.label || item?.key || '')}</text>
    `
    cursorX += 20 + Math.max(78, String(item?.label || item?.key || '').length * 7.4)
    return chunk
  }).join('')
}

function exportChartFrame(chart, bodySvg, { height = EXPORT_BASE_HEIGHT, legendItems = [], emptyMessage = '' } = {}) {
  const legendSvg = buildLegendSvg(legendItems)
  const emptySvg = emptyMessage ? `
    <rect x="86" y="170" width="${EXPORT_WIDTH - 172}" height="${Math.max(height - 250, 180)}" rx="20" ry="20" fill="#f2f4f7" stroke="#d4dce6" stroke-dasharray="8 10" />
    <text x="${EXPORT_WIDTH / 2}" y="${Math.max(height / 2, 240)}" text-anchor="middle" font-size="20" fill="${EXPORT_MUTED}">${escapeXml(emptyMessage)}</text>
  ` : ''

  return {
    width: EXPORT_WIDTH,
    height,
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="${EXPORT_WIDTH}" height="${height}" viewBox="0 0 ${EXPORT_WIDTH} ${height}">
        <rect width="100%" height="100%" fill="${EXPORT_BG}" />
        <text x="86" y="62" font-family="${EXPORT_FONT}" font-size="32" font-weight="700" fill="${EXPORT_TEXT}">
          ${escapeXml(chart?.title || 'Grafico sismico')}
        </text>
        ${chart?.subtitle ? `<text x="86" y="96" font-family="${EXPORT_FONT}" font-size="18" fill="${EXPORT_MUTED}">${escapeXml(chart.subtitle)}</text>` : ''}
        ${legendSvg}
        ${bodySvg || emptySvg}
      </svg>
    `,
  }
}

function exportLineChartSvg(chart) {
  const categories = chart?.categories || []
  const series = chart?.series || []
  if (!categories.length || !series.length) {
    return exportChartFrame(chart, '', { emptyMessage: chart?.empty_message || 'Sin datos para exportar.' })
  }

  const width = EXPORT_WIDTH - EXPORT_PLOT_PADDING.left - EXPORT_PLOT_PADDING.right
  const height = EXPORT_BASE_HEIGHT
  const plotHeight = height - EXPORT_PLOT_PADDING.top - EXPORT_PLOT_PADDING.bottom
  const maxValue = maxSeriesValue(series, false)
  const gridLines = buildExportGridLines(maxValue, height)
  const xForIndex = (index) => {
    if (categories.length <= 1) return EXPORT_PLOT_PADDING.left + width / 2
    return EXPORT_PLOT_PADDING.left + (index / (categories.length - 1)) * width
  }
  const yForValue = (value) => EXPORT_PLOT_PADDING.top + plotHeight - (Number(value || 0) / maxValue) * plotHeight
  const labelStep = categories.length > 10 ? Math.ceil(categories.length / 8) : 1
  const bodySvg = `
    ${gridLines.map((line) => `
      <line x1="${EXPORT_PLOT_PADDING.left}" x2="${EXPORT_WIDTH - EXPORT_PLOT_PADDING.right}" y1="${line.y}" y2="${line.y}" stroke="${EXPORT_GRID}" stroke-width="1" />
      <text x="${EXPORT_PLOT_PADDING.left - 10}" y="${line.y + 5}" text-anchor="end" font-family="${EXPORT_FONT}" font-size="13" fill="${EXPORT_MUTED}">
        ${escapeXml(formatNumber(line.value))}
      </text>
    `).join('')}
    ${series.map((item) => {
      const points = (item?.data || []).map((value, index) => `${xForIndex(index)},${yForValue(value)}`).join(' ')
      const circles = (item?.data || []).map((value, index) => `
        <circle cx="${xForIndex(index)}" cy="${yForValue(value)}" r="5" fill="${escapeXml(item?.color || '#4968ee')}" />
      `).join('')
      return `
        <polyline fill="none" stroke="${escapeXml(item?.color || '#4968ee')}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" points="${points}" />
        ${circles}
      `
    }).join('')}
    ${categories.map((category, index) => (
      index % labelStep === 0 ? `
        <text x="${xForIndex(index)}" y="${height - 28}" text-anchor="middle" font-family="${EXPORT_FONT}" font-size="13" fill="${EXPORT_MUTED}">
          ${escapeXml(category)}
        </text>
      ` : ''
    )).join('')}
  `
  return exportChartFrame(chart, bodySvg, { legendItems: series })
}

function exportStackedBarChartSvg(chart) {
  const categories = chart?.categories || []
  const series = chart?.series || []
  if (!categories.length || !series.length) {
    return exportChartFrame(chart, '', { emptyMessage: chart?.empty_message || 'Sin datos para exportar.' })
  }

  const width = EXPORT_WIDTH - EXPORT_PLOT_PADDING.left - EXPORT_PLOT_PADDING.right
  const height = EXPORT_BASE_HEIGHT
  const plotHeight = height - EXPORT_PLOT_PADDING.top - EXPORT_PLOT_PADDING.bottom
  const maxValue = maxSeriesValue(series, true)
  const groupWidth = width / Math.max(categories.length, 1)
  const barWidth = Math.min(72, groupWidth * 0.56)
  const gridLines = buildExportGridLines(maxValue, height)
  const bodySvg = `
    ${gridLines.map((line) => `
      <line x1="${EXPORT_PLOT_PADDING.left}" x2="${EXPORT_WIDTH - EXPORT_PLOT_PADDING.right}" y1="${line.y}" y2="${line.y}" stroke="${EXPORT_GRID}" stroke-width="1" />
      <text x="${EXPORT_PLOT_PADDING.left - 10}" y="${line.y + 5}" text-anchor="end" font-family="${EXPORT_FONT}" font-size="13" fill="${EXPORT_MUTED}">
        ${escapeXml(formatNumber(line.value))}
      </text>
    `).join('')}
    ${categories.map((category, categoryIndex) => {
      let currentHeight = 0
      const barX = EXPORT_PLOT_PADDING.left + categoryIndex * groupWidth + (groupWidth - barWidth) / 2
      const segments = series.map((item) => {
        const rawValue = Number(item?.data?.[categoryIndex] || 0)
        if (!rawValue) return ''
        const segmentHeight = (rawValue / maxValue) * plotHeight
        currentHeight += segmentHeight
        const y = EXPORT_PLOT_PADDING.top + plotHeight - currentHeight
        return `<rect x="${barX}" y="${y}" width="${barWidth}" height="${segmentHeight}" rx="10" ry="10" fill="${escapeXml(item?.color || '#4968ee')}" />`
      }).join('')
      return `
        ${segments}
        <text x="${barX + barWidth / 2}" y="${height - 28}" text-anchor="middle" font-family="${EXPORT_FONT}" font-size="13" fill="${EXPORT_MUTED}">
          ${escapeXml(category)}
        </text>
      `
    }).join('')}
  `
  return exportChartFrame(chart, bodySvg, { legendItems: series })
}

function exportGroupedBarChartSvg(chart) {
  const categories = chart?.categories || []
  const series = chart?.series || []
  if (!categories.length || !series.length) {
    return exportChartFrame(chart, '', { emptyMessage: chart?.empty_message || 'Sin datos para exportar.' })
  }

  const width = EXPORT_WIDTH - EXPORT_PLOT_PADDING.left - EXPORT_PLOT_PADDING.right
  const height = EXPORT_BASE_HEIGHT
  const plotHeight = height - EXPORT_PLOT_PADDING.top - EXPORT_PLOT_PADDING.bottom
  const maxValue = maxSeriesValue(series, false)
  const gridLines = buildExportGridLines(maxValue, height)
  const groupWidth = width / Math.max(categories.length, 1)
  const slotWidth = groupWidth * 0.76
  const barWidth = Math.max(16, Math.min(28, slotWidth / Math.max(series.length, 1)))
  const bodySvg = `
    ${gridLines.map((line) => `
      <line x1="${EXPORT_PLOT_PADDING.left}" x2="${EXPORT_WIDTH - EXPORT_PLOT_PADDING.right}" y1="${line.y}" y2="${line.y}" stroke="${EXPORT_GRID}" stroke-width="1" />
      <text x="${EXPORT_PLOT_PADDING.left - 10}" y="${line.y + 5}" text-anchor="end" font-family="${EXPORT_FONT}" font-size="13" fill="${EXPORT_MUTED}">
        ${escapeXml(formatNumber(line.value))}
      </text>
    `).join('')}
    ${categories.map((category, categoryIndex) => {
      const groupX = EXPORT_PLOT_PADDING.left + categoryIndex * groupWidth + (groupWidth - slotWidth) / 2
      const bars = series.map((item, seriesIndex) => {
        const rawValue = Number(item?.data?.[categoryIndex] || 0)
        const barHeight = (rawValue / maxValue) * plotHeight
        const x = groupX + seriesIndex * barWidth
        const y = EXPORT_PLOT_PADDING.top + plotHeight - barHeight
        return `<rect x="${x}" y="${y}" width="${Math.max(barWidth - 4, 10)}" height="${barHeight}" rx="8" ry="8" fill="${escapeXml(item?.color || '#4968ee')}" />`
      }).join('')
      return `
        ${bars}
        <text x="${groupX + slotWidth / 2}" y="${height - 28}" text-anchor="middle" font-family="${EXPORT_FONT}" font-size="13" fill="${EXPORT_MUTED}">
          ${escapeXml(category)}
        </text>
      `
    }).join('')}
  `
  return exportChartFrame(chart, bodySvg, { legendItems: series })
}

function exportScatterChartSvg(chart) {
  const points = chart?.points || []
  if (!points.length) {
    return exportChartFrame(chart, '', { emptyMessage: chart?.empty_message || 'Sin datos para exportar.' })
  }

  const width = EXPORT_WIDTH - EXPORT_PLOT_PADDING.left - EXPORT_PLOT_PADDING.right
  const height = EXPORT_BASE_HEIGHT
  const plotHeight = height - EXPORT_PLOT_PADDING.top - EXPORT_PLOT_PADDING.bottom
  const maxX = Math.max(...points.map((point) => Number(point?.x || 0)), 1)
  const maxY = Math.max(...points.map((point) => Number(point?.y || 0)), 1)
  const gridLines = buildExportGridLines(maxY, height)
  const xForValue = (value) => EXPORT_PLOT_PADDING.left + (Number(value || 0) / maxX) * width
  const yForValue = (value) => EXPORT_PLOT_PADDING.top + plotHeight - (Number(value || 0) / maxY) * plotHeight

  const bodySvg = `
    ${gridLines.map((line) => `
      <line x1="${EXPORT_PLOT_PADDING.left}" x2="${EXPORT_WIDTH - EXPORT_PLOT_PADDING.right}" y1="${line.y}" y2="${line.y}" stroke="${EXPORT_GRID}" stroke-width="1" />
      <text x="${EXPORT_PLOT_PADDING.left - 10}" y="${line.y + 5}" text-anchor="end" font-family="${EXPORT_FONT}" font-size="13" fill="${EXPORT_MUTED}">
        ${escapeXml(formatNumber(line.value))}
      </text>
    `).join('')}
    ${Array.from({ length: 4 }, (_, idx) => {
      const ratio = idx / 3
      const value = Math.round(maxX * ratio)
      const x = EXPORT_PLOT_PADDING.left + width * ratio
      return `
        <line x1="${x}" x2="${x}" y1="${EXPORT_PLOT_PADDING.top}" y2="${height - EXPORT_PLOT_PADDING.bottom}" stroke="${EXPORT_GRID}" stroke-width="1" stroke-dasharray="5 8" />
        <text x="${x}" y="${height - 28}" text-anchor="middle" font-family="${EXPORT_FONT}" font-size="13" fill="${EXPORT_MUTED}">
          ${escapeXml(formatNumber(value))}
        </text>
      `
    }).join('')}
    ${points.map((point) => `
      <circle
        cx="${xForValue(point?.x)}"
        cy="${yForValue(point?.y)}"
        r="${Number(point?.size || 5) + 1}"
        fill="${escapeXml(point?.color || '#4968ee')}"
        opacity="0.86"
      />
    `).join('')}
    <text x="${EXPORT_WIDTH / 2}" y="${height - 8}" text-anchor="middle" font-family="${EXPORT_FONT}" font-size="16" font-weight="700" fill="${EXPORT_MUTED}">
      ${escapeXml(chart?.x_label || 'Eje X')}
    </text>
    <text transform="translate(24 ${height / 2}) rotate(-90)" text-anchor="middle" font-family="${EXPORT_FONT}" font-size="16" font-weight="700" fill="${EXPORT_MUTED}">
      ${escapeXml(chart?.y_label || 'Eje Y')}
    </text>
  `
  return exportChartFrame(chart, bodySvg)
}

function exportHorizontalBarChartSvg(chart) {
  const items = chart?.items || []
  const height = Math.max(320, 190 + items.length * 90)
  if (!items.length) {
    return exportChartFrame(chart, '', { height, emptyMessage: chart?.empty_message || 'Sin datos para exportar.' })
  }
  const maxValue = Math.max(...items.map((item) => Number(item?.raw_value || 0)), 1)
  const bodySvg = items.map((item, index) => {
    const y = 170 + index * 90
    const percent = Math.max(0.06, Number(item?.raw_value || 0) / maxValue)
    const barWidth = percent * 690
    return `
      <text x="86" y="${y}" font-family="${EXPORT_FONT}" font-size="20" font-weight="700" fill="${EXPORT_TEXT}">
        ${escapeXml(item?.label || '')}
      </text>
      ${item?.detail ? `<text x="86" y="${y + 24}" font-family="${EXPORT_FONT}" font-size="14" fill="${EXPORT_MUTED}">${escapeXml(item.detail)}</text>` : ''}
      <text x="1180" y="${y}" text-anchor="end" font-family="${EXPORT_FONT}" font-size="20" font-weight="700" fill="${EXPORT_TEXT}">
        ${escapeXml(item?.value || '')}
      </text>
      <rect x="360" y="${y - 18}" width="760" height="18" rx="9" ry="9" fill="#f2f4f7" />
      <rect x="360" y="${y - 18}" width="${barWidth}" height="18" rx="9" ry="9" fill="${escapeXml(item?.color || '#4968ee')}" />
      ${item?.secondary_label ? `<text x="360" y="${y + 26}" font-family="${EXPORT_FONT}" font-size="13" fill="${EXPORT_MUTED}">${escapeXml(item.secondary_label)}: ${escapeXml(item.secondary_value || '')}</text>` : ''}
    `
  }).join('')
  return exportChartFrame(chart, bodySvg, { height })
}

function exportSegmentBarChartSvg(chart) {
  const segments = chart?.segments || []
  const height = Math.max(360, 280 + segments.length * 42)
  const total = segments.reduce((sum, segment) => sum + Number(segment?.raw_value || 0), 0)
  if (!segments.length || total <= 0) {
    return exportChartFrame(chart, '', { height, emptyMessage: chart?.empty_message || 'Sin datos para exportar.' })
  }

  let cursorX = 86
  const stripSvg = segments.map((segment) => {
    const width = (Number(segment?.raw_value || 0) / total) * (EXPORT_WIDTH - 172)
    const chunk = `<rect x="${cursorX}" y="176" width="${width}" height="54" fill="${escapeXml(segment?.color || '#4968ee')}" />`
    cursorX += width
    return chunk
  }).join('')

  const legendSvg = segments.map((segment, index) => {
    const y = 288 + index * 42
    return `
      <rect x="86" y="${y - 11}" width="12" height="12" rx="6" ry="6" fill="${escapeXml(segment?.color || '#4968ee')}" />
      <text x="108" y="${y}" font-family="${EXPORT_FONT}" font-size="17" font-weight="700" fill="${EXPORT_TEXT}">
        ${escapeXml(segment?.label || '')}
      </text>
      <text x="1180" y="${y}" text-anchor="end" font-family="${EXPORT_FONT}" font-size="16" fill="${EXPORT_MUTED}">
        ${escapeXml(segment?.value || '')}
      </text>
    `
  }).join('')

  const bodySvg = `
    <rect x="86" y="176" width="${EXPORT_WIDTH - 172}" height="54" rx="18" ry="18" fill="#f2f4f7" />
    ${stripSvg}
    ${legendSvg}
  `
  return exportChartFrame(chart, bodySvg, { height })
}

function buildChartExportSvg(chart) {
  const chartType = chart?.type || 'line'
  if (chartType === 'stacked_bar') return exportStackedBarChartSvg(chart)
  if (chartType === 'grouped_bar') return exportGroupedBarChartSvg(chart)
  if (chartType === 'horizontal_bar') return exportHorizontalBarChartSvg(chart)
  if (chartType === 'scatter') return exportScatterChartSvg(chart)
  if (chartType === 'segment_bar') return exportSegmentBarChartSvg(chart)
  return exportLineChartSvg(chart)
}

async function exportChartPng(chart) {
  const exportGraphic = buildChartExportSvg(chart)
  const svgBlob = new Blob([exportGraphic.svg], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = window.URL.createObjectURL(svgBlob)

  try {
    const image = await new Promise((resolve, reject) => {
      const nextImage = new window.Image()
      nextImage.onload = () => resolve(nextImage)
      nextImage.onerror = reject
      nextImage.src = svgUrl
    })

    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = exportGraphic.width * scale
    canvas.height = exportGraphic.height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('No se pudo inicializar el canvas para exportar la imagen.')
    }
    ctx.scale(scale, scale)
    ctx.fillStyle = EXPORT_BG
    ctx.fillRect(0, 0, exportGraphic.width, exportGraphic.height)
    ctx.drawImage(image, 0, 0, exportGraphic.width, exportGraphic.height)

    const pngBlob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/png')
    })
    if (!pngBlob) {
      throw new Error('No se pudo generar el archivo PNG.')
    }

    const filename = `sismico_${slugify(chart?.key || chart?.title)}_${exportTimestamp()}.png`
    downloadBlob(pngBlob, filename)
  } finally {
    window.URL.revokeObjectURL(svgUrl)
  }
}

function EmptyChart({ message }) {
  return <div className="productivity-empty-chart">{message || 'Sin datos para este grafico.'}</div>
}

function Legend({ series = [] }) {
  return (
    <div className="productivity-legend">
      {series.map((item) => (
        <div className="productivity-legend-item" key={item.key || item.label}>
          <span className="productivity-legend-swatch" style={{ background: item.color || 'var(--blue)' }} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  )
}

function LineChart({ chart }) {
  const categories = chart?.categories || []
  const series = chart?.series || []
  if (!categories.length || !series.length) {
    return <EmptyChart message={chart?.empty_message} />
  }

  const innerWidth = SVG_WIDTH - CHART_PADDING.left - CHART_PADDING.right
  const innerHeight = SVG_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
  const maxValue = maxSeriesValue(series, false)
  const gridLines = buildGridLines(maxValue)
  const xForIndex = (index) => {
    if (categories.length <= 1) return CHART_PADDING.left + innerWidth / 2
    return CHART_PADDING.left + (index / (categories.length - 1)) * innerWidth
  }
  const yForValue = (value) => CHART_PADDING.top + innerHeight - (Number(value || 0) / maxValue) * innerHeight
  const labelStep = categories.length > 10 ? Math.ceil(categories.length / 8) : 1

  return (
    <div className="productivity-chart-inner">
      <Legend series={series} />
      <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="productivity-svg-chart" role="img" aria-label={chart?.title}>
        {gridLines.map((line) => (
          <g key={line.y}>
            <line className="productivity-grid-line" x1={CHART_PADDING.left} x2={SVG_WIDTH - CHART_PADDING.right} y1={line.y} y2={line.y} />
            <text className="productivity-axis-label" x={CHART_PADDING.left - 8} y={line.y + 4} textAnchor="end">
              {formatNumber(line.value)}
            </text>
          </g>
        ))}
        {series.map((item) => {
          const points = (item?.data || []).map((value, index) => `${xForIndex(index)},${yForValue(value)}`).join(' ')
          return (
            <g key={item.key || item.label}>
              <polyline
                fill="none"
                stroke={item.color || 'var(--blue)'}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={points}
              />
              {(item?.data || []).map((value, index) => (
                <circle
                  key={`${item.key || item.label}-${index}`}
                  cx={xForIndex(index)}
                  cy={yForValue(value)}
                  r="4"
                  fill={item.color || 'var(--blue)'}
                >
                  <title>{`${item.label}: ${formatNumber(value)} / ${categories[index] || ''}`}</title>
                </circle>
              ))}
            </g>
          )
        })}
        {categories.map((category, index) => (
          index % labelStep === 0 ? (
            <text
              key={category}
              className="productivity-axis-label"
              x={xForIndex(index)}
              y={SVG_HEIGHT - 18}
              textAnchor="middle"
            >
              {category}
            </text>
          ) : null
        ))}
      </svg>
    </div>
  )
}

function StackedBarChart({ chart }) {
  const categories = chart?.categories || []
  const series = chart?.series || []
  if (!categories.length || !series.length) {
    return <EmptyChart message={chart?.empty_message} />
  }

  const innerWidth = SVG_WIDTH - CHART_PADDING.left - CHART_PADDING.right
  const innerHeight = SVG_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
  const maxValue = maxSeriesValue(series, true)
  const gridLines = buildGridLines(maxValue)
  const groupWidth = innerWidth / Math.max(categories.length, 1)
  const barWidth = Math.min(52, groupWidth * 0.56)

  return (
    <div className="productivity-chart-inner">
      <Legend series={series} />
      <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="productivity-svg-chart" role="img" aria-label={chart?.title}>
        {gridLines.map((line) => (
          <g key={line.y}>
            <line className="productivity-grid-line" x1={CHART_PADDING.left} x2={SVG_WIDTH - CHART_PADDING.right} y1={line.y} y2={line.y} />
            <text className="productivity-axis-label" x={CHART_PADDING.left - 8} y={line.y + 4} textAnchor="end">
              {formatNumber(line.value)}
            </text>
          </g>
        ))}
        {categories.map((category, categoryIndex) => {
          let currentHeight = 0
          const barX = CHART_PADDING.left + categoryIndex * groupWidth + (groupWidth - barWidth) / 2
          return (
            <g key={category}>
              {series.map((item) => {
                const rawValue = Number(item?.data?.[categoryIndex] || 0)
                if (!rawValue) return null
                const segmentHeight = (rawValue / maxValue) * innerHeight
                currentHeight += segmentHeight
                const y = CHART_PADDING.top + innerHeight - currentHeight
                return (
                  <rect
                    key={`${category}-${item.key || item.label}`}
                    x={barX}
                    y={y}
                    width={barWidth}
                    height={segmentHeight}
                    fill={item.color || 'var(--blue)'}
                    rx="8"
                    ry="8"
                  >
                    <title>{`${item.label}: ${formatNumber(rawValue)} / ${category}`}</title>
                  </rect>
                )
              })}
              <text className="productivity-axis-label" x={barX + barWidth / 2} y={SVG_HEIGHT - 18} textAnchor="middle">
                {category}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function GroupedBarChart({ chart }) {
  const categories = chart?.categories || []
  const series = chart?.series || []
  if (!categories.length || !series.length) {
    return <EmptyChart message={chart?.empty_message} />
  }

  const innerWidth = SVG_WIDTH - CHART_PADDING.left - CHART_PADDING.right
  const innerHeight = SVG_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
  const maxValue = maxSeriesValue(series, false)
  const gridLines = buildGridLines(maxValue)
  const groupWidth = innerWidth / Math.max(categories.length, 1)
  const slotWidth = groupWidth * 0.72
  const barWidth = Math.max(10, Math.min(20, slotWidth / Math.max(series.length, 1)))

  return (
    <div className="productivity-chart-inner">
      <Legend series={series} />
      <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="productivity-svg-chart" role="img" aria-label={chart?.title}>
        {gridLines.map((line) => (
          <g key={line.y}>
            <line className="productivity-grid-line" x1={CHART_PADDING.left} x2={SVG_WIDTH - CHART_PADDING.right} y1={line.y} y2={line.y} />
            <text className="productivity-axis-label" x={CHART_PADDING.left - 8} y={line.y + 4} textAnchor="end">
              {formatNumber(line.value)}
            </text>
          </g>
        ))}
        {categories.map((category, categoryIndex) => {
          const groupX = CHART_PADDING.left + categoryIndex * groupWidth + (groupWidth - slotWidth) / 2
          return (
            <g key={category}>
              {series.map((item, seriesIndex) => {
                const rawValue = Number(item?.data?.[categoryIndex] || 0)
                const barHeight = (rawValue / maxValue) * innerHeight
                const x = groupX + seriesIndex * barWidth
                const y = CHART_PADDING.top + innerHeight - barHeight
                return (
                  <rect
                    key={`${category}-${item.key || item.label}`}
                    x={x}
                    y={y}
                    width={Math.max(barWidth - 3, 8)}
                    height={barHeight}
                    fill={item.color || 'var(--blue)'}
                    rx="6"
                    ry="6"
                  >
                    <title>{`${item.label}: ${formatNumber(rawValue)} / ${category}`}</title>
                  </rect>
                )
              })}
              <text className="productivity-axis-label" x={groupX + slotWidth / 2} y={SVG_HEIGHT - 18} textAnchor="middle">
                {category}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function ScatterChart({ chart }) {
  const points = chart?.points || []
  if (!points.length) {
    return <EmptyChart message={chart?.empty_message} />
  }

  const innerWidth = SVG_WIDTH - CHART_PADDING.left - CHART_PADDING.right
  const innerHeight = SVG_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
  const maxX = Math.max(...points.map((point) => Number(point?.x || 0)), 1)
  const maxY = Math.max(...points.map((point) => Number(point?.y || 0)), 1)
  const gridLines = buildGridLines(maxY)

  const xForValue = (value) => CHART_PADDING.left + (Number(value || 0) / maxX) * innerWidth
  const yForValue = (value) => CHART_PADDING.top + innerHeight - (Number(value || 0) / maxY) * innerHeight

  return (
    <div className="productivity-chart-inner">
      <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="productivity-svg-chart" role="img" aria-label={chart?.title}>
        {gridLines.map((line) => (
          <g key={line.y}>
            <line className="productivity-grid-line" x1={CHART_PADDING.left} x2={SVG_WIDTH - CHART_PADDING.right} y1={line.y} y2={line.y} />
            <text className="productivity-axis-label" x={CHART_PADDING.left - 8} y={line.y + 4} textAnchor="end">
              {formatNumber(line.value)}
            </text>
          </g>
        ))}
        {Array.from({ length: 4 }, (_, idx) => {
          const ratio = idx / 3
          const value = Math.round(maxX * ratio)
          const x = CHART_PADDING.left + innerWidth * ratio
          return (
            <g key={x}>
              <line className="productivity-grid-line productivity-grid-line-vertical" x1={x} x2={x} y1={CHART_PADDING.top} y2={SVG_HEIGHT - CHART_PADDING.bottom} />
              <text className="productivity-axis-label" x={x} y={SVG_HEIGHT - 18} textAnchor="middle">
                {formatNumber(value)}
              </text>
            </g>
          )
        })}
        {points.map((point, index) => (
          <circle
            key={`${point?.label || 'point'}-${index}`}
            cx={xForValue(point?.x)}
            cy={yForValue(point?.y)}
            r={Number(point?.size || 5)}
            fill={point?.color || 'var(--blue)'}
            opacity="0.86"
          >
            <title>{`${formatPointLabel(point)} / ${chart?.x_label}: ${formatNumber(point?.x)} / ${chart?.y_label}: ${formatNumber(point?.y)}`}</title>
          </circle>
        ))}
        <text className="productivity-axis-title" x={SVG_WIDTH / 2} y={SVG_HEIGHT - 2} textAnchor="middle">
          {chart?.x_label || 'Eje X'}
        </text>
        <text className="productivity-axis-title" transform={`translate(16 ${SVG_HEIGHT / 2}) rotate(-90)`} textAnchor="middle">
          {chart?.y_label || 'Eje Y'}
        </text>
      </svg>
    </div>
  )
}

function HorizontalBarChart({ chart }) {
  const items = chart?.items || []
  if (!items.length) {
    return <EmptyChart message={chart?.empty_message} />
  }
  const maxValue = Math.max(...items.map((item) => Number(item?.raw_value || 0)), 1)

  return (
    <div className="productivity-hbar-list">
      {items.map((item) => {
        const percent = Math.max(6, (Number(item?.raw_value || 0) / maxValue) * 100)
        return (
          <div className="productivity-hbar-row" key={`${item.label}-${item.detail || ''}`}>
            <div className="productivity-hbar-head">
              <strong>{item.label}</strong>
              <span>{item.value}</span>
            </div>
            {item.detail ? <div className="productivity-hbar-detail">{item.detail}</div> : null}
            <div className="productivity-hbar-track">
              <div className="productivity-hbar-fill" style={{ width: `${percent}%`, background: item.color || 'var(--blue)' }} />
            </div>
            {item.secondary_label ? (
              <div className="productivity-hbar-meta">
                <span>{item.secondary_label}</span>
                <strong>{item.secondary_value}</strong>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function SegmentBarChart({ chart }) {
  const segments = chart?.segments || []
  const total = segments.reduce((sum, segment) => sum + Number(segment?.raw_value || 0), 0)
  if (!segments.length || total <= 0) {
    return <EmptyChart message={chart?.empty_message} />
  }

  return (
    <div className="productivity-chart-inner">
      <div className="productivity-segment-strip">
        {segments.map((segment) => (
          <div
            key={segment.key || segment.label}
            className="productivity-segment-block"
            style={{
              width: `${(Number(segment?.raw_value || 0) / total) * 100}%`,
              background: segment.color || 'var(--blue)',
            }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>
      <div className="productivity-segment-grid">
        {segments.map((segment) => (
          <div className="productivity-segment-item" key={segment.key || segment.label}>
            <span className="productivity-legend-swatch" style={{ background: segment.color || 'var(--blue)' }} />
            <div>
              <strong>{segment.label}</strong>
              <small>{segment.value}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChartBody({ chart }) {
  const chartType = chart?.type || 'line'
  if (chart?.has_data === false) {
    return <EmptyChart message={chart?.empty_message} />
  }
  if (chartType === 'stacked_bar') return <StackedBarChart chart={chart} />
  if (chartType === 'grouped_bar') return <GroupedBarChart chart={chart} />
  if (chartType === 'horizontal_bar') return <HorizontalBarChart chart={chart} />
  if (chartType === 'scatter') return <ScatterChart chart={chart} />
  if (chartType === 'segment_bar') return <SegmentBarChart chart={chart} />
  return <LineChart chart={chart} />
}

function SummaryCard({ item }) {
  const tone = item?.tone || 'neutral'
  return (
    <div className={`productivity-summary-card ${tone}`} key={item?.key || item?.label}>
      <span>{item?.label}</span>
      <strong>{item?.value}</strong>
      {item?.helper ? <small>{item.helper}</small> : null}
    </div>
  )
}

function ProductivityChartCard({ chart }) {
  const [exporting, setExporting] = useState('')

  async function handleExportPng() {
    try {
      setExporting('png')
      await exportChartPng(chart)
    } catch (error) {
      window.alert(error?.message || 'No se pudo exportar el grafico en imagen.')
    } finally {
      setExporting('')
    }
  }

  function handleExportCsv() {
    try {
      setExporting('csv')
      exportChartCsv(chart)
    } catch (error) {
      window.alert(error?.message || 'No se pudo exportar la data del grafico.')
    } finally {
      window.setTimeout(() => setExporting(''), 250)
    }
  }

  return (
    <section className="productivity-chart-card" key={chart.key || chart.title}>
      <div className="productivity-chart-head">
        <div>
          <h4>{chart.title}</h4>
          {chart.subtitle ? <p>{chart.subtitle}</p> : null}
        </div>
        <div className="productivity-chart-actions">
          <button
            type="button"
            className="productivity-export-btn"
            onClick={handleExportPng}
            disabled={exporting === 'png'}
          >
            {exporting === 'png' ? 'Exportando PNG...' : 'Exportar PNG'}
          </button>
          <button
            type="button"
            className="productivity-export-btn secondary"
            onClick={handleExportCsv}
            disabled={exporting === 'csv'}
          >
            {exporting === 'csv' ? 'Exportando CSV...' : 'Exportar CSV'}
          </button>
        </div>
      </div>
      <ChartBody chart={chart} />
    </section>
  )
}

export function ProductivitySummaryGrid({ items = [] }) {
  return (
    <div className="productivity-summary-grid">
      {items.map((item) => <SummaryCard key={item.key || item.label} item={item} />)}
    </div>
  )
}

export function ProductivityChartGrid({ charts = [] }) {
  return (
    <div className="productivity-chart-grid">
      {charts.map((chart) => <ProductivityChartCard key={chart.key || chart.title} chart={chart} />)}
    </div>
  )
}
