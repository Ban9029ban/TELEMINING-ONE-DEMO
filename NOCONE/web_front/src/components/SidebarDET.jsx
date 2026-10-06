// Sidebar.jsx
import React from 'react';

const zones = [
{ name: 'Andes Norte', key: 'andes' },
{ name: 'Diamante NTI', key: 'andesita' },
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
{ name: 'Pipa Norte', key: 'pipa_N' }];


const SidebarDET = ({ onZoneClick }) => {
  return (
    <div className="zonas-det bg-neutral-900 p-4 w-full">
      <h5 className="zonas-mineras-title text-gray-100 mb-4 font-semibold">Zonas DET</h5>
      <ul className="space-y-2">
        {zones.map((zone, index) =>
        <li
          key={index}
          className={`indicator indicator-${zone.key}`}
          onMouseEnter={() => onZoneClick(zone.key)}>
          
            <button
            type="button"
            className="block w-full bg-neutral-700 hover:bg-blue-700 text-gray-300 font-medium py-2 px-4 rounded transition-colors duration-150 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400">

              {zone.name}
            </button>
          </li>
        )}
      </ul>
    </div>);

};

export default SidebarDET;
