import React, { useRef, useState } from 'react'

export default function EmergencyButton({ label = 'Emergencia', active: controlledActive = null, onClick = null }) {
  const audioRef = useRef(null)
  const [internalActive, setInternalActive] = useState(false)
  const active = controlledActive ?? internalActive

  const trigger = async () => {
    try {
      if (audioRef.current) {
        audioRef.current.currentTime = 0
        await audioRef.current.play()
      }
    } catch {}
    if (onClick) {
      onClick()
      return
    }
    setInternalActive(true)
    window.setTimeout(() => setInternalActive(false), 1500)
  }

  return (
    <>
      <button onClick={trigger} className={`alert-btn ${active ? 'active' : ''}`}>{label}</button>
      <audio ref={audioRef} preload="auto">
        <source src="/sounds/alert_siren.mp3" type="audio/mpeg" />
      </audio>
    </>
  )
}
