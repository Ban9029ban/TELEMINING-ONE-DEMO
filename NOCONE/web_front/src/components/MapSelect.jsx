import React, { useEffect, useState } from "react";
import axios from "axios";
import { FaLocationArrow, FaSearch } from "react-icons/fa";

import { API_URL } from "../api-config";
import { ActionButton, EmptyState, FieldShell, StatusBadge } from "./SystemTheme";

const API = `${API_URL}/control/maps`;

export default function MapSelect({
  onMapChange,
  onHighlightDevice,
  onDeviceDetailsWithExtras,
  onSearchResultSelect,
  selectedMapCode: selectedMapCodeProp,
  showSearch = true
}) {
  const [maps] = useState([
  { label: "NTI Andes Norte", code: "NTI_andes_norte" },
  { label: "Diamante - NP", code: "NP_dia" }]
  );

  const [localMapCode, setLocalMapCode] = useState(selectedMapCodeProp || "NP_dia");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const selectedMapCode = selectedMapCodeProp || localMapCode;

  useEffect(() => {
    if (selectedMapCodeProp && selectedMapCodeProp !== localMapCode) {
      setLocalMapCode(selectedMapCodeProp);
    }
  }, [selectedMapCodeProp, localMapCode]);

  const handleMapChange = (value) => {
    onMapChange?.(value);
    if (!selectedMapCodeProp) {
      setLocalMapCode(value);
    }
  };

  const handleSearchSubmit = async (event) => {
    event.preventDefault();
    if (!search.trim()) return;

    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);

    try {
      const response = await axios.get(`${API}/search-node`, {
        params: { term: search }
      });
      setSearchResults(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error("Error en búsqueda:", error);
      setSearchError("Error buscando nodo.");
    } finally {
      setSearchLoading(false);
    }
  };

  const handleResultClick = async (result) => {
    let history = [];

    try {
      if (result?.entity_type && result?.entity_id != null) {
        const historyResponse = await axios.get(`${API}/node-history`, {
          params: {
            entity_type: result.entity_type,
            entity_id: result.entity_id
          }
        });

        if (Array.isArray(historyResponse.data)) {
          history = historyResponse.data;
        }
      }
    } catch (error) {
      console.warn("No se pudo obtener node-history:", error);
    }

    const resultWithHistory = { ...result, history };

    onSearchResultSelect?.(resultWithHistory);

    if (
    onDeviceDetailsWithExtras && (
    resultWithHistory.peopleData || resultWithHistory.vehiclesData))
    {
      onDeviceDetailsWithExtras(resultWithHistory);
    }

    if (onHighlightDevice && resultWithHistory.map?.device_id != null) {
      onHighlightDevice(resultWithHistory.map.device_id);
    }

    setSearchResults([]);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-white/70 bg-white/92 px-3.5 py-3.5 shadow-[0_18px_35px_rgba(15,23,42,0.08)] sm:rounded-[28px] sm:px-4 sm:py-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-end">
            <div className="w-full xl:max-w-[280px]">
              <FieldShell label="Mapa operativo">
                <select
                  className="tm-control"
                  value={selectedMapCode}
                  onChange={(event) => handleMapChange(event.target.value)}>
                  
                  {maps.map((mapOption) =>
                  <option key={mapOption.code} value={mapOption.code}>
                      {mapOption.label}
                    </option>
                  )}
                </select>
              </FieldShell>
            </div>

            {showSearch ?
            <form
              onSubmit={handleSearchSubmit}
              className="flex w-full flex-col gap-2 sm:flex-row sm:items-end xl:max-w-[900px]">
              
                <div className="min-w-0 flex-1">
                  <FieldShell label="Bósqueda rápida">
                    <input
                    type="text"
                    placeholder="Buscar nodo / UR / persona / equipo..."
                    className="tm-control"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)} />
                  
                  </FieldShell>
                </div>

                <ActionButton
                type="submit"
                disabled={searchLoading}
                className="shrink-0 sm:h-[46px] sm:px-5">
                
                  <FaSearch />
                  {searchLoading ? "Buscando..." : "Buscar"}
                </ActionButton>
              </form> :
            null}
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <StatusBadge tone="blue">
              <FaLocationArrow />
              {maps.find((mapOption) => mapOption.code === selectedMapCode)?.label || "Mapa activo"}
            </StatusBadge>
          </div>
        </div>

        {searchError ?
        <div className="mt-3 rounded-[18px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-700">
            {searchError}
          </div> :
        null}
      </div>

      {showSearch && searchResults.length > 0 ?
      <div className="overflow-hidden rounded-[24px] border border-slate-700/80 bg-[radial-gradient(circle_at_top_right,_rgba(37,99,235,0.18),_transparent_35%),linear-gradient(180deg,rgba(2,6,23,0.985)_0%,rgba(15,23,42,0.97)_100%)] shadow-[0_28px_60px_rgba(2,6,23,0.42)] backdrop-blur-xl sm:rounded-[26px]">
          <div className="border-b border-slate-700/70 px-4 py-4">
            <div className="text-sm font-semibold text-white">Resultados de búsqueda</div>
            <div className="mt-1 text-xs text-slate-300">
              Selecciona un resultado para enfocar el nodo y cargar su historial.
            </div>
          </div>

          <ul className="divide-y divide-slate-700/70">
            {searchResults.map((result) =>
          <li key={result.id}>
                <button
              type="button"
              className="tm-popover-item"
              onClick={() => handleResultClick(result)}>
              
                  <div className="text-[13px] font-semibold text-white sm:text-sm">{result.label}</div>
                  <div className="mt-1 text-xs text-slate-300">
                    {result.portico?.name ?
                `Pórtico: ${result.portico.name} · zona: ${result.portico.zone || "N/A"}` :
                `Tipo: ${result.type || result.entity_type || "N/A"} · mapa: ${result.map?.map_code || "N/A"}`}
                  </div>
                </button>
              </li>
          )}
          </ul>
        </div> :
      null}

      {showSearch && !searchLoading && search.trim() && searchResults.length === 0 && !searchError ?
      <div className="rounded-[24px] border border-white/70 bg-white/92 px-3.5 py-3.5 shadow-[0_18px_35px_rgba(15,23,42,0.08)] sm:rounded-[26px] sm:px-4 sm:py-4">
          <EmptyState
          title="Sin coincidencias"
          description="Prueba con otro nombre, patente, UR o etiqueta para encontrar un nodo." />
        
        </div> :
      null}
    </div>);

}
