import React, { useEffect, useMemo, useState } from "react";
import { SITE_LAYOUTS } from "./operationalConfig";
import {
  buildLatestByDevice,
  buildPlcMirrorView,
  inferVisualState,
  inferControlState,
  safeJson,
  stateBadgeLabel,
} from "./lib/deriveOperationalState";

const DEFAULT_API_URL =
  window.localStorage.getItem("operativa.semaforo.apiUrl") ||
  "http://localhost:19090/api/emulator/semaforo/state";

function formatDate(value) {
  if (!value) return "Sin datos";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function TrafficLight({ state }) {
  return (
    <div className="traffic-light">
      <div className={`light red ${state === "red" ? "active" : ""}`} />
      <div className="light amber" />
      <div className={`light green ${state === "green" ? "active" : ""}`} />
    </div>
  );
}

function PolygonCard({ polygon, item }) {
  const visual = inferVisualState(item);
  return (
    <div className={`polygon-card polygon-${visual}`}>
      <div className="polygon-card__title">{polygon.label}</div>
      <div className="polygon-card__state">{stateBadgeLabel(item)}</div>
      <div className="polygon-card__time">{formatDate(item?.updated_at)}</div>
    </div>
  );
}

export default function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    window.localStorage.setItem("operativa.semaforo.apiUrl", apiUrl);
  }, [apiUrl]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!active) return;
        setCurrent(data || null);
        setHistory(Array.isArray(data?.history) ? data.history : []);
        setError("");
      } catch (err) {
        if (!active) return;
        setError(err?.message || "No fue posible consultar el emulador.");
      }
    };
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [apiUrl]);

  const latestByDevice = useMemo(() => buildLatestByDevice(history, current), [history, current]);
  const plcMirrors = useMemo(() => buildPlcMirrorView(latestByDevice), [latestByDevice]);
  const recentHistory = useMemo(
    () => [...history].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)).slice(0, 12),
    [history]
  );
  const mainVisualState = inferVisualState(current);

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <h1>Gestión operativa Semáforo en tiempo real</h1>
          <p>Visualización operacional consolidada del emulador y la proyección de comandos PLC.</p>
        </div>
        <div className="api-box">
          <label>API Emulador URL</label>
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
        </div>
      </header>

      {error ? <div className="error-banner">Error de consulta: {error}</div> : null}

      <main className="grid-2x2">
        <section className="panel">
          <div className="panel__header">
            <h2>Semáforo principal</h2>
            <span className={`state-pill state-${mainVisualState}`}>{stateBadgeLabel(current)}</span>
          </div>
          <div className="semaphore-panel">
            <TrafficLight state={mainVisualState} />
            <div className="semaphore-meta">
              <div><strong>Device:</strong> {current?.device_code || "Sin datos"}</div>
              <div><strong>Site:</strong> {current?.site_code || "Sin datos"}</div>
              <div><strong>Estado:</strong> {current?.state || "Sin datos"}</div>
              <div><strong>Estado control:</strong> {inferControlState(current)}</div>
              <div><strong>Actualizado:</strong> {formatDate(current?.updated_at)}</div>
              <div><strong>Requested by:</strong> {current?.requested_by || "Sin datos"}</div>
              <div><strong>Reason:</strong> {current?.reason || "Sin datos"}</div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Mapa operacional consolidado</h2>
            <span className="subtle">Vista de polígonos por mapa</span>
          </div>
          <div className="maps-box">
            {SITE_LAYOUTS.map((site) => (
              <div key={site.siteCode} className="map-group">
                <div className="map-group__title">{site.siteLabel}</div>
                <div className="map-group__grid">
                  {site.polygons.map((polygon) => (
                    <PolygonCard
                      key={polygon.deviceCode}
                      polygon={polygon}
                      item={latestByDevice.get(polygon.deviceCode)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>Actividad del emulador</h2>
            <span className="subtle">Último payload + historial reciente</span>
          </div>
          <div className="payload-box">
            <h3>Último payload</h3>
            <pre>{safeJson(current)}</pre>
          </div>
          <div className="history-box">
            <h3>Historial reciente</h3>
            <div className="history-list">
              {recentHistory.length === 0 ? (
                <div className="empty">Sin historial reciente.</div>
              ) : (
                recentHistory.map((entry, idx) => (
                  <div key={`${entry.updated_at || "row"}-${idx}`} className="history-row">
                    <div className={`history-dot state-${inferVisualState(entry)}`} />
                    <div className="history-main">
                      <div className="history-title">{entry.device_code || "Sin device_code"}</div>
                      <div className="history-meta">
                        {stateBadgeLabel(entry)} · {formatDate(entry.updated_at)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>PLC espejo operativos</h2>
            <span className="subtle">Plan de comandos proyectado por IP</span>
          </div>
          <div className="plc-list">
            {plcMirrors.map((plc) => (
              <div key={plc.ip} className="plc-card">
                <div className="plc-card__header">
                  <div>
                    <div className="plc-title">{plc.label}</div>
                    <div className="plc-ip">{plc.ip}</div>
                  </div>
                  <div className={`plc-status ${plc.status}`}>
                    <span className="plc-status__icon" />
                    {plc.status === "commanded" ? "Comandos emitidos" : "Sin actividad"}
                  </div>
                </div>
                <div className="plc-commands">
                  {plc.devices.map((device) => (
                    <div key={`${plc.ip}-${device.deviceCode}`} className="plc-command-row">
                      <div className={`mini-dot state-${device.visualState}`} />
                      <div className="plc-command-body">
                        <div className="plc-command-title">{device.label}</div>
                        <div className="plc-command-state">
                          {device.controlState === "sin-datos" ? "Sin datos" : device.controlState}
                        </div>
                        <div className="plc-command-tags">
                          {device.commands.length === 0 ? (
                            <span className="cmd-tag neutral">Sin plan calculado</span>
                          ) : (
                            device.commands.map((cmd) => (
                              <span
                                key={`${plc.ip}-${device.deviceCode}-${cmd}`}
                                className={`cmd-tag ${String(cmd).includes("=1") ? "on" : "off"}`}
                              >
                                {cmd}
                              </span>
                            ))
                          )}
                        </div>
                        <div className="plc-command-time">{formatDate(device.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
