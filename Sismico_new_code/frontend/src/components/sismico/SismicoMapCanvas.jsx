import React from 'react'

const stateClassMap = {
  normal: 'poly-normal',
  warning: 'poly-warning',
  critical: 'poly-critical',
  offline: 'poly-offline',
  unknown: 'poly-unknown',
}

export default function SismicoMapCanvas({ map, objects = [], stateMap = {} }) {
  const width = map?.width || 1600
  const height = map?.height || 900

  return (
    <div className="sismico-map-stage">
      {map?.image_url ? <img src={map.image_url} className="sismico-map-image" alt="" /> : <div className="sismico-map-placeholder">Sin mapa</div>}
      <svg viewBox={`0 0 ${width} ${height}`} className="sismico-map-svg" preserveAspectRatio="xMidYMid meet">
        {objects.map((obj) => {
          const stateCode = stateMap[obj.code]?.state_code || 'offline'
          const cls = stateClassMap[stateCode] || 'poly-unknown'
          const points = (obj.geometry?.points || []).map(([x, y]) => `${x},${y}`).join(' ')
          return (
            <g key={obj.code}>
              <polygon points={points} className={`sismico-poly ${cls}`} />
              {obj.geometry?.points?.[0] ? (
                <text x={obj.geometry.points[0][0]} y={obj.geometry.points[0][1] - 8} className="sismico-poly-label">
                  {obj.name}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
