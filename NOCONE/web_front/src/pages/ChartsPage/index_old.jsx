import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../../api-config";

import TransferTimesChart from "../../components/grafics/TransferTimesCharts";
import URStayChart from "../../components/grafics/URStayChart";
import ClimateAnomaliesChart from "../../components/grafics/ClimateAnomaliesChart";

import PeoplePerLevelChart from "../../components/PeoplePerLevelChart";
import VehiclePerLevelChart from "../../components/VehiclePerLevelChart";
import ConnectedVehiclesChart from "../../components/ConnectedVehiclesChart";
import ZenitStatusChart from "../../components/ZenitStatusChart";
import URStatusTable from "../../components/URStatusTable";

const NIVEL_OPTIONS = ["NP", "UCL", "NTI", "OFICINA TELEMINING", "SIN NIVEL"];

const ChartsPage = () => {
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  // Datos para los gráficos
  const [peoplePerLevel, setPeoplePerLevel] = useState(null);
  const [vehiclesPerLevel, setVehiclesPerLevel] = useState(null);
  const [vehicleStatus, setVehicleStatus] = useState(null);
  const [zenitStatus, setZenitStatus] = useState(null);

  // Filtros
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedNivel, setSelectedNivel] = useState("");
  const [selectedPortico, setSelectedPortico] = useState("");

  // Catálogo de pórticos (UR)
  const [porticos, setPorticos] = useState([]);

  const [loading, setLoading] = useState(false);

  // -----------------------------
  // Carga de pórticos para combo
  // -----------------------------
  const fetchPorticos = async () => {
    try {
      const res = await axios.get(`${API_URL}/access/porticos`, { headers });
      setPorticos(res.data || []);
    } catch (err) {
      console.error("Error cargando pórticos", err);
    }
  };

  // -----------------------------
  // Carga de datos de gráficos
  // -----------------------------
  const fetchGraphicsData = async () => {
    setLoading(true);
    try {
      // Construimos params para gente y vehículos
      const params = {
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        nivel: selectedNivel || undefined,
        portico_id: selectedPortico || undefined
      };

      const [
      peopleRes,
      vehiclesRes,
      vehStatusRes,
      zenitRes] =
      await Promise.all([
      axios.get(`${API_URL}/control/graphics/people-per-level`, {
        headers,
        params
      }),
      axios.get(`${API_URL}/control/graphics/vehicles-per-level`, {
        headers,
        params
      }),
      axios.get(`${API_URL}/control/graphics/vehicle-status`, {
        headers
      }),
      axios.get(`${API_URL}/control/graphics/zenit-status`, {
        headers
      })]
      );

      setPeoplePerLevel(peopleRes.data || {});
      setVehiclesPerLevel(vehiclesRes.data || {});
      setVehicleStatus(vehStatusRes.data || {});
      setZenitStatus(zenitRes.data || {});
    } catch (err) {
      console.error("Error cargando datos de gráficos", err);
    } finally {
      setLoading(false);
    }
  };

  // Cargar catálogo y datos iniciales
  useEffect(() => {
    fetchPorticos();
    fetchGraphicsData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApplyFilters = () => {
    fetchGraphicsData();
  };

  const handleClearFilters = () => {
    setStartDate("");
    setEndDate("");
    setSelectedNivel("");
    setSelectedPortico("");
    fetchGraphicsData();
  };

  const skeleton =
  <div className="w-full h-[300px] bg-gray-100 rounded animate-pulse" />;


  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-semibold mb-2">
        Observabilidad TM One
      </h1>

      {/* Barra de filtros */}
      <div className="bg-white rounded shadow p-4 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col">
          <label className="text-xs text-gray-600">Fecha desde</label>
          <input
            type="date"
            className="border rounded px-2 py-1 text-sm"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)} />
          
        </div>

        <div className="flex flex-col">
          <label className="text-xs text-gray-600">Fecha hasta</label>
          <input
            type="date"
            className="border rounded px-2 py-1 text-sm"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)} />
          
        </div>

        <div className="flex flex-col">
          <label className="text-xs text-gray-600">Nivel</label>
          <select
            className="border rounded px-2 py-1 text-sm min-w-[140px]"
            value={selectedNivel}
            onChange={(e) => setSelectedNivel(e.target.value)}>
            
            <option value="">Todos</option>
            {NIVEL_OPTIONS.map((niv) =>
            <option key={niv} value={niv}>
                {niv}
              </option>
            )}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-xs text-gray-600">Pórtico (UR)</label>
          <select
            className="border rounded px-2 py-1 text-sm min-w-[180px]"
            value={selectedPortico}
            onChange={(e) => setSelectedPortico(e.target.value)}>
            
            <option value="">Todos</option>
            {porticos.map((p) =>
            <option key={p.id} value={p.id}>
                {p.name} ({p.nivel || "SIN NIVEL"})
              </option>
            )}
          </select>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleApplyFilters}
            className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
            disabled={loading}>
            
            Aplicar filtros
          </button>
          <button
            onClick={handleClearFilters}
            className="bg-gray-200 text-gray-800 px-3 py-1 rounded text-sm hover:bg-gray-300"
            disabled={loading}>
            
            Limpiar
          </button>
        </div>
      </div>

      {/* Primera fila: personas / vehículos por nivel */}
      <div className="p-4 flex flex-wrap gap-4 justify-between">
        <div className="min-h-[300px] flex-1">
          {peoplePerLevel ?
          <PeoplePerLevelChart peoplePerLevel={peoplePerLevel} /> :

          skeleton
          }
        </div>

        <div className="min-h-[300px] flex-1">
          {vehiclesPerLevel && Object.keys(vehiclesPerLevel).length > 0 ?
          <VehiclePerLevelChart vehiclesPerLevel={vehiclesPerLevel} /> :

          skeleton
          }
        </div>
      </div>

      {/* Segunda fila: vehículos conectados + estado TMOne */}
      <div className="p-4 flex flex-wrap gap-4 justify-between">
        <div className="min-h-[300px] flex-1">
          {vehicleStatus ?
          <ConnectedVehiclesChart vehicleStatus={vehicleStatus} /> :

          skeleton
          }
        </div>

        <div className="min-h-[300px] flex-1">
          {zenitStatus ?
          <ZenitStatusChart zenitStatus={zenitStatus} /> :

          skeleton
          }
        </div>

        <div className="min-h-[300px] flex-1">
          <URStatusTable />
        </div>
      </div>

      {/* Tercera fila: transferencias, permanencias, clima */}
      <TransferTimesChart />
      <URStayChart />
      <ClimateAnomaliesChart />
    </div>);

};

export default ChartsPage;
