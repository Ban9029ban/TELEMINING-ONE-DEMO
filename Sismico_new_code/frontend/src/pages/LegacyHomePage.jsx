import React, { useEffect, useState } from 'react'
import EmergencyButton from '../components/EmergencyButton'
import { ProjectCards } from '../components/LegacyCards'
import { heartbeat } from '../services/legacyApi'

function useAlarm(active) {
  useEffect(() => {
    let ctx, timer
    if (!active) return
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    ctx = new AudioCtx()
    const beep = () => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 1000
      gain.gain.value = 0.018
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.16)
    }
    beep()
    timer = setInterval(beep, 1000)
    return () => { clearInterval(timer); ctx && ctx.close() }
  }, [active])
}

export default function LegacyHomePage() {
  const [emergency, setEmergency] = useState(false)
  useAlarm(emergency)

  useEffect(() => {
    heartbeat('CENTRAL-01', window.location.href)
    const id = setInterval(() => heartbeat('CENTRAL-01', window.location.href), 20000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="legacy-home-page">
      <div className="toolbar-row">
        <EmergencyButton active={emergency} onClick={() => setEmergency(v => !v)} />
      </div>
      <div className="legacy-home-stage">
        <div className="legacy-watermark tele">TELEMINING</div>
        <div className="legacy-watermark codelco">CODELCO</div>
        <ProjectCards />
      </div>
    </div>
  )
}
