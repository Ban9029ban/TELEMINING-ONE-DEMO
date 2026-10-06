import React from 'react'

const zones = [
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

export default function SidebarDET({ selectedZone, onZoneClick, zonesFromApi = [] }) {
  const list = zonesFromApi.length ? zonesFromApi : zones
  return (
    <div className="zonas-det-panel">
      <h3>Zonas DET</h3>
      <ul>
        {list.map((zone, index) => (
          <li key={zone.key || zone.zone_key || index}>
            <button
              className={`zone-btn ${selectedZone === (zone.key || zone.zone_key) ? 'active' : ''}`}
              onClick={() => onZoneClick(zone.key || zone.zone_key)}
              onMouseEnter={() => onZoneClick(zone.key || zone.zone_key)}
            >
              {zone.name || zone.zone_name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
