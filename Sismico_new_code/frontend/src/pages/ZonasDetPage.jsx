import React, { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import SidebarDET from '../components/SidebarDET'
import ThreeDViewer from '../components/Model'
import { loadZonesDet } from '../services/sismicoApi'

const fallback = [
  { name: 'Andes Norte', key: 'andes' },
  { name: 'Andesita', key: 'andesita' },
  { name: 'Diamante', key: 'diamante' },
  { name: 'Esmeralda', key: 'esmeralda' },
  { name: 'Dacita', key: 'dacita' },
  { name: 'Diablo Regimiento', key: 'diablo' },
  { name: 'Recursos Norte', key: 'recursos' },
  { name: 'Pacífico Superior', key: 'pacifico' },
  { name: 'TTE4 Sur', key: 'tte4' },
  { name: 'Reservas Norte', key: 'reservas' },
  { name: 'Pilar Norte', key: 'pilar_N' },
  { name: 'Corbata', key: 'corbata' },
  { name: 'Pipa Norte', key: 'pipa_N' },
]

export default function ZonasDetPage() {
  const [selectedZone, setSelectedZone] = useState('andes')
  const [zones, setZones] = useState(fallback)

  useEffect(() => {
    loadZonesDet().then((d) => {
      if (d?.zones?.length) {
        setZones(d.zones.map(z => ({
          name: z.zone_name,
          key: z.zone_key
        })))
      }
    }).catch(() => {})
  }, [])

  return (
    <div className="zonesdet-page">
      <aside className="zonesdet-sidebar-wrap">
        <SidebarDET selectedZone={selectedZone} onZoneClick={setSelectedZone} zonesFromApi={zones} />
      </aside>

      <main className="zonesdet-main">
        <div className="zonesdet-head">
          <div className="zonesdet-title-block">
            <h2>Centro de Rastreo TMOne - Mina El Teniente</h2>
            <p>Supervisa la ubicación y el estado de los dispositivos TMOne en tiempo real.</p>
          </div>
          <button className="chip-btn blue">Volver</button>
        </div>

        <div className="zonesdet-canvas">
          <Canvas camera={{ position: [180, 50, 42], fov: 50 }}>
            <ThreeDViewer selectedZone={selectedZone} />
          </Canvas>
        </div>
      </main>
    </div>
  )
}
