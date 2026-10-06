import React, { useEffect, useRef, useState } from "react";
import { FaBell } from "react-icons/fa";

import { API_URL } from "../../api-config";
import AccessDeniedModal from "../../components/AccessDeniedModal";
import MapSelect from "../../components/MapSelect";
import MapShow, { AlertTrackingPanel, MapLegend } from "../../components/MapShow";
import DeviceDetails from "../../components/DeviceDetails";
import FleetTrackingView from "../../components/FleetTrackingView";
import NodeHistoryTable from "../../components/NodeHistoryTable";
import { StatusBadge } from "../../components/SystemTheme";
import useUserPermissions from "../../hooks/useUserPermissions";
import { hasPermission } from "../../utils/accessControl";

const API = `${API_URL}/control`;
const ALERT_MAPS = ["NP_dia", "NTI_andes_norte"];

export default function Home() {
  const { permissions, roles } = useUserPermissions({ syncOnMount: false });
  const [blockedResource, setBlockedResource] = useState("");
  const [selectedMap, setSelectedMap] = useState("NP_dia");
  const [trackingViewMode, setTrackingViewMode] = useState("tracking");
  const [highlightedDeviceId, setHighlightedDeviceId] = useState(null);

  const [climateAlertDeviceId, setClimateAlertDeviceId] = useState(null);
  const [equipmentAlertEntityId, setEquipmentAlertEntityId] = useState(null);

  const [deviceDetails, setDeviceDetails] = useState(null);
  const [detailType, setDetailType] = useState(null);
  const [urSearchDetails, setUrSearchDetails] = useState(null);
  const [showLegendPanel, setShowLegendPanel] = useState(false);
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);

  const [nodeHistory, setNodeHistory] = useState([]);
  const [nodeEntityType, setNodeEntityType] = useState(null);
  const [nodeLabel, setNodeLabel] = useState(null);

  const [alertInfo, setAlertInfo] = useState({
    visible: false,
    kind: null
  });
  const [alertsEnabled, setAlertsEnabled] = useState({
    climate: false,
    equipment: false
  });
  const [devicesCacheByMap, setDevicesCacheByMap] = useState({});
  const [highlightReason, setHighlightReason] = useState(null);

  const audioRef = useRef(null);
  const alertIntervalRef = useRef(null);
  const activeAutomaticEquipmentAlertRef = useRef(null);
  const selectionSourceRef = useRef("map");
  const canUseTrackingMap = hasPermission("tracking:mapa", { permissions, roles });
  const canUseTrackingAlerts = hasPermission("tracking:alertas", { permissions, roles });
  const canUseTrackingRealtime = hasPermission("tracking:tiempo_real", { permissions, roles });
  const canUseTrackingMovement = hasPermission("tracking:movimiento", { permissions, roles });

  useEffect(() => {
    return () => {
      clearAlertInterval();
      stopSiren();
    };
  }, []);

  useEffect(() => {
    if (!canUseTrackingMap && canUseTrackingMovement) {
      setTrackingViewMode("fleet");
    }
  }, [canUseTrackingMap, canUseTrackingMovement]);

  useEffect(() => {
    if (!canUseTrackingAlerts || trackingViewMode !== "tracking") return undefined;
    let active = true;

    const refreshAutomaticEquipmentAlerts = async () => {
      try {
        const response = await fetch(`${API}/maps/alerts/equipment-outside`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rows = await response.json();
        const alert = Array.isArray(rows) ? rows[0] : null;
        if (!active) return;

        if (!alert) {
          activeAutomaticEquipmentAlertRef.current = null;
          return;
        }

        const alertKey = `${alert.equipment_id}:${alert.actual_portico_id}:${alert.seen_at}`;
        setEquipmentAlertEntityId(alert.equipment_id);
        setClimateAlertDeviceId(null);
        setSelectedMap(alert.map_code || "NP_dia");
        if (alert.map_device_id != null) {
          setHighlightedDeviceId(null);
          setTimeout(() => active && setHighlightedDeviceId(alert.map_device_id), 0);
        }

        if (activeAutomaticEquipmentAlertRef.current !== alertKey) {
          activeAutomaticEquipmentAlertRef.current = alertKey;
          setAlertsEnabled({ climate: false, equipment: true });
          setAlertInfo({ visible: true, kind: "equipment" });
          const audio = audioRef.current;
          if (audio) audio.play().catch(() => {});
        }
      } catch (error) {
        console.error("No se pudieron consultar alertas automaticas de equipos:", error);
      }
    };

    refreshAutomaticEquipmentAlerts();
    const timer = setInterval(refreshAutomaticEquipmentAlerts, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [canUseTrackingAlerts, trackingViewMode]);

  const clearAlertInterval = () => {
    if (alertIntervalRef.current) {
      clearInterval(alertIntervalRef.current);
      alertIntervalRef.current = null;
    }
  };

  const ensureDevicesForMap = async (mapCode) => {
    if (devicesCacheByMap[mapCode]) {
      return devicesCacheByMap[mapCode];
    }

    try {
      const response = await fetch(`${API}/maps/devices/${mapCode}`);
      const data = await response.json();
      const rows = Array.isArray(data) ? data : [];
      setDevicesCacheByMap((current) => ({ ...current, [mapCode]: rows }));
      return rows;
    } catch (error) {
      console.error("No se pudieron cargar devices para mapa:", mapCode, error);
      return [];
    }
  };

  const pickRandomPortico = async (kind) => {
    const candidates = [];

    for (const mapCode of ALERT_MAPS) {
      const devices = await ensureDevicesForMap(mapCode);
      const filtered =
      kind === "climate" ?
      devices.filter((item) => item.kind === "portico_clima") :
      devices.filter((item) => item.kind === "portico" || item.kind === "portico_clima");

      filtered.forEach((device) => candidates.push({ mapCode, device }));
    }

    if (candidates.length === 0) {
      return null;
    }

    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  };

  const highlightRandomPorticoForAlert = async (kind) => {
    const picked = await pickRandomPortico(kind);
    if (!picked) {
      return;
    }

    setUrSearchDetails(null);
    setDeviceDetails(null);
    setDetailType(null);
    setHighlightReason("alert");
    setNodeEntityType(null);
    setNodeLabel(null);
    setNodeHistory([]);

    if (kind === "climate") {
      setClimateAlertDeviceId(picked.device.id);
      setEquipmentAlertEntityId(null);
    } else {
      setClimateAlertDeviceId(null);
    }

    setSelectedMap(picked.mapCode);
    setHighlightedDeviceId(null);
    setTimeout(() => setHighlightedDeviceId(picked.device.id), 0);
  };

  const startRandomPorticoLoop = (kind) => {
    clearAlertInterval();
    highlightRandomPorticoForAlert(kind);

    alertIntervalRef.current = setInterval(() => {
      highlightRandomPorticoForAlert(kind);
    }, 12000);
  };

  const handleDeviceDetailsWithExtras = (combinedData) => {
    if (combinedData) {
      setUrSearchDetails(combinedData);
      setDeviceDetails(null);
      setDetailType(null);
      return;
    }

    setUrSearchDetails(null);
  };

  const handleMapDeviceDetails = (data) => {
    if (!data) {
      return;
    }

    if (selectionSourceRef.current !== "search") {
      setNodeEntityType(null);
      setNodeLabel(null);
      setNodeHistory([]);
    }

    selectionSourceRef.current = "map";
    setDeviceDetails(data);
    setUrSearchDetails(null);
  };

  const handleSearchResultSelect = (result) => {
    if (!result) {
      return;
    }

    setHighlightReason("search");
    setEquipmentAlertEntityId(null);
    setClimateAlertDeviceId(null);

    if (result.map?.map_code) {
      setSelectedMap(result.map.map_code);
    }

    if (result.map?.device_id != null) {
      const nextId = result.map.device_id;
      setHighlightedDeviceId(null);
      setTimeout(() => setHighlightedDeviceId(nextId), 0);
    }

    if (
    result.entity_type &&
    result.entity_id != null &&
    ["person", "vehicle", "equipment"].includes(result.entity_type))
    {
      setNodeEntityType(result.entity_type);
      setNodeLabel(result.label || null);
      setNodeHistory(Array.isArray(result.history) ? result.history : []);
    } else {
      setNodeEntityType(null);
      setNodeLabel(null);
      setNodeHistory([]);
    }

    if (result.peopleData || result.vehiclesData) {
      setUrSearchDetails({
        peopleData: result.peopleData || [],
        vehiclesData: result.vehiclesData || []
      });
      setDeviceDetails(null);
      setDetailType(null);
    } else {
      setUrSearchDetails(null);
      setDeviceDetails(null);
      setDetailType(null);
    }
  };

  const startSiren = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    try {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch (_error) {



      // noop
    }
  };

  const stopSiren = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (_error) {



      // noop
    }
  };

  const handleClearHighlight = () => {
    setHighlightedDeviceId(null);
    setHighlightReason(null);
    setUrSearchDetails(null);
    setDeviceDetails(null);
    setDetailType(null);
    setNodeEntityType(null);
    setNodeLabel(null);
    setNodeHistory([]);
    setClimateAlertDeviceId(null);
    setEquipmentAlertEntityId(null);
  };

  const handleTriggerAlert = (kind, enabled) => {
    if (!canUseTrackingAlerts) {
      setBlockedResource("Tracking / Alertas");
      return;
    }
    const nextEnabled = enabled ?
    { climate: kind === "climate", equipment: kind === "equipment" } :
    { ...alertsEnabled, [kind]: false };
    setAlertsEnabled(nextEnabled);

    if (enabled) {
      setAlertInfo({ visible: true, kind });
      startSiren();
      startRandomPorticoLoop(kind);
      return;
    }

    clearAlertInterval();

    const otherKind = kind === "climate" ? "equipment" : "climate";
    if (nextEnabled[otherKind]) {
      setAlertInfo({ visible: true, kind: otherKind });
      startSiren();
      startRandomPorticoLoop(otherKind);
      return;
    }

    stopSiren();
    setAlertInfo({ visible: false, kind: null });
    setHighlightedDeviceId(null);
    setClimateAlertDeviceId(null);
    setEquipmentAlertEntityId(null);
  };

  const handleSilenceAlert = () => {
    stopSiren();
  };

  const handleCloseAlert = () => {
    clearAlertInterval();
    stopSiren();
    setAlertInfo({ visible: false, kind: null });
    setAlertsEnabled({ climate: false, equipment: false });
    setHighlightedDeviceId(null);
    setClimateAlertDeviceId(null);
    setEquipmentAlertEntityId(null);
  };

  const getAlertTitle = () => {
    if (alertInfo.kind === "climate") {
      return "Alerta de agentes ambientales";
    }
    if (alertInfo.kind === "equipment") {
      return "Alerta equipos fuera de pórtico";
    }
    return "Alerta Tracking";
  };

  const getAlertMessage = () => {
    if (alertInfo.kind === "climate") {
      return "Uno o más pórticos ambientales presentan sensores en nivel crítico.";
    }
    if (alertInfo.kind === "equipment") {
      return "Se han detectado equipos fuera de pórtico o en zona no autorizada.";
    }
    return "Se ha activado una alerta de Tracking.";
  };

  const handleTrackingViewModeChange = (nextMode) => {
    if (nextMode === "fleet" && !canUseTrackingMovement) {
      setBlockedResource("Tracking / Movimiento");
      return;
    }
    if (nextMode === "tracking" && !canUseTrackingMap) {
      setBlockedResource("Tracking / Mapa");
      return;
    }
    setTrackingViewMode(nextMode);

    if (nextMode !== "tracking") {
      clearAlertInterval();
      stopSiren();
      setAlertInfo({ visible: false, kind: null });
      setAlertsEnabled({ climate: false, equipment: false });
      setClimateAlertDeviceId(null);
      setEquipmentAlertEntityId(null);
    }
  };

  const isUrSearch = Boolean(urSearchDetails);
  const peopleDetails = isUrSearch ?
  urSearchDetails.peopleData :
  detailType === "people" ?
  deviceDetails :
  null;
  const vehiclesDetails = isUrSearch ?
  urSearchDetails.vehiclesData :
  detailType === "vehicles" ?
  deviceDetails :
  null;
  const singleDetails = !isUrSearch ? deviceDetails : null;
  const singleType = !isUrSearch ? detailType : null;

  const isTrackingMode = trackingViewMode === "tracking";
  const headerCardClass = isTrackingMode ?
  "mb-4 rounded-[24px] border border-slate-700/60 bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_42%,#312e81_100%)] px-4 py-3.5 text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)] sm:px-5 sm:py-4" :
  "mb-4 rounded-[24px] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#eef2ff_100%)] px-4 py-3.5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] sm:px-5 sm:py-4";
  const switcherWrapperClass = isTrackingMode ?
  "inline-flex rounded-2xl border border-white/15 bg-white/10 p-1 shadow-[0_8px_20px_rgba(15,23,42,0.12)]" :
  "inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm";

  return (
    <div className={`min-h-[calc(100vh-64px)] p-3 sm:p-4 ${isTrackingMode ? "bg-slate-950/5" : "bg-white dark:bg-[#0c0c0c]"}`}>
      <div className={headerCardClass}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-base font-semibold tracking-tight sm:text-lg">Tracking y flota</div>
            <div className={isTrackingMode ? "text-sm text-slate-300" : "text-sm text-slate-500"}>
              Alterna entre el tracking clásico y la vista acumulativa de flota para personas, vehículos y equipos.
            </div>
          </div>

          <div className={switcherWrapperClass}>
            <button
              type="button"
              onClick={() => handleTrackingViewModeChange("tracking")}
              className={`rounded-xl px-3 py-1.5 text-[13px] font-semibold transition sm:px-4 sm:py-2 ${
              trackingViewMode === "tracking" ?
              "bg-white/12 text-white shadow-[0_10px_24px_rgba(255,255,255,0.16)]" :
              isTrackingMode ?
              "text-slate-200 hover:text-white" :
              "text-slate-500 hover:text-slate-800"}`
              }>
              
              Tracking
            </button>
            <button
              type="button"
              onClick={() => handleTrackingViewModeChange("fleet")}
              className={`rounded-xl px-3 py-1.5 text-[13px] font-semibold transition sm:px-4 sm:py-2 ${
              trackingViewMode === "fleet" ?
              "bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] text-white shadow-[0_10px_24px_rgba(79,70,229,0.22)]" :
              isTrackingMode ?
              "text-slate-200 hover:text-white" :
              "text-slate-500 hover:text-slate-800"}`
              }>

              Flota Personas y vehículos
            </button>
          </div>
        </div>
      </div>

      {trackingViewMode === "fleet" ?
      <FleetTrackingView selectedMap={selectedMap} onMapChange={setSelectedMap} /> :

      <>
          {canUseTrackingMap ?
        <>
              <MapSelect
            onMapChange={setSelectedMap}
            onHighlightDevice={setHighlightedDeviceId}
            onDeviceDetailsWithExtras={handleDeviceDetailsWithExtras}
            onSearchResultSelect={handleSearchResultSelect}
            selectedMapCode={selectedMap}
            showSearch />
          

              <MapShow
            selectedMap={selectedMap}
            highlightedDeviceId={highlightedDeviceId}
            climateAlertDeviceId={climateAlertDeviceId}
            equipmentAlertEntityId={equipmentAlertEntityId}
            onPickEquipmentAlertEntityId={setEquipmentAlertEntityId}
            highlightReason={highlightReason}
            onSelectionSource={(source) => {
              selectionSourceRef.current = source;
            }}
            onDeviceDetails={handleMapDeviceDetails}
            onDetailType={setDetailType}
            onClearHighlight={handleClearHighlight} />
          
            </> :
            null}

          <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              {canUseTrackingRealtime && nodeEntityType ?
            <NodeHistoryTable
              history={nodeHistory}
              entityType={nodeEntityType}
              label={nodeLabel} /> :

            null}

              {canUseTrackingRealtime && isUrSearch ?
              <>
                <DeviceDetails
                  deviceDetails={peopleDetails}
                  detailType={peopleDetails ? "people" : null} />
                <DeviceDetails
                  deviceDetails={vehiclesDetails}
                  detailType={vehiclesDetails ? "vehicles" : null} />
              </> :
              null}

              {canUseTrackingRealtime && !isUrSearch ?
            <DeviceDetails
              deviceDetails={singleDetails}
              detailType={singleType}
              highlightEquipmentEntityId={equipmentAlertEntityId} /> :

            null}
            </div>

            <div className="w-full space-y-3 2xl:sticky 2xl:top-4 2xl:self-start">
              <button
              type="button"
              onClick={() => setShowLegendPanel((value) => !value)}
              className="flex w-full items-center justify-between rounded-[22px] border border-white/70 bg-white/92 px-4 py-3 text-left shadow-[0_16px_28px_rgba(15,23,42,0.08)] transition hover:bg-white">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Leyenda del mapa</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {showLegendPanel ? "Ocultar referencias visuales." : "Mostrar referencias visuales."}
                  </div>
                </div>
                <StatusBadge tone="blue">{showLegendPanel ? "Visible" : "Oculta"}</StatusBadge>
              </button>

              {showLegendPanel ? <MapLegend /> : null}

              <button
              type="button"
              onClick={() => {
                if (!canUseTrackingAlerts) {
                  setBlockedResource("Tracking / Alertas");
                  return;
                }
                setShowAlertsPanel((value) => !value);
              }}
              className="flex w-full items-center justify-between rounded-[22px] border border-white/70 bg-white/92 px-4 py-3 text-left shadow-[0_16px_28px_rgba(15,23,42,0.08)] transition hover:bg-white">
              
                <div>
                  <div className="text-sm font-semibold text-slate-900">Alertas Tracking</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {showAlertsPanel ? "Panel de alertas operativas activo." : "Mostrar panel de alertas operativas."}
                  </div>
                </div>
                <StatusBadge tone="blue">
                  <FaBell />
                  {showAlertsPanel ? "Visible" : "Oculto"}
                </StatusBadge>
              </button>

              {canUseTrackingAlerts && showAlertsPanel ?
            <AlertTrackingPanel alertsEnabled={alertsEnabled} onTriggerAlert={handleTriggerAlert} /> :
            null}
            </div>
          </div>

          <audio ref={audioRef} src="/sounds/alert_siren.mp3" loop />

          {alertInfo.visible ?
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="mx-4 w-full max-w-md rounded-2xl bg-red-600 p-6 text-white shadow-2xl">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl" role="img" aria-label="alerta">
                      🚨
                    </span>
                    <h2 className="text-lg font-bold">{getAlertTitle()}</h2>
                  </div>
                  <button
                type="button"
                onClick={handleCloseAlert}
                className="text-xl leading-none text-white/80 hover:text-white">
                
                    ×
                  </button>
                </div>

                <p className="mb-4 text-sm">{getAlertMessage()}</p>

                <div className="flex justify-end gap-2 text-sm">
                  <button
                type="button"
                onClick={handleSilenceAlert}
                className="rounded-lg bg-white/20 px-3 py-1 hover:bg-white/30">
                
                    Silenciar
                  </button>
                  <button
                type="button"
                onClick={handleCloseAlert}
                className="rounded-lg bg-white px-3 py-1 font-semibold text-red-700 hover:bg-gray-100">
                
                    Cerrar alerta
                  </button>
                </div>
              </div>
            </div> :
        null}
        </>
      }

      <AccessDeniedModal
        open={Boolean(blockedResource)}
        resourceLabel={blockedResource || "este recurso"}
        onClose={() => setBlockedResource("")} />
      
    </div>);

}
