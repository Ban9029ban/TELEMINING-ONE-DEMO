import React from 'react'

export default function MapCanvas({ base, overlays = [], children }) {
  return (
    <div className="map-stage">
      <img src={base} className="map-base-img" alt="" />
      {overlays.map((src, idx) => <img key={src + idx} src={src} className="map-overlay-img" alt="" />)}
      {children}
    </div>
  )
}
