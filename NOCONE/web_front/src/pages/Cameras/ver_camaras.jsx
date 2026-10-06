import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import {
  applyModelOverlay,
  getPanelAnalytics,
  mergeExternalOperationalAnalytics,
  mergeExternalPpeAnalytics,
  resetPanelAnalytics,
  setPanelLocalInferenceEnabled,
} from "./analysis";
import { API_URL } from "../../api-config";

const API_BASE_URL = API_URL;
const DEFAULT_CAMERA_MODELS = [
  {
    id: -100,
    code: "operational_safety_monitor",
    name: "Monitor operacional y seguridad",
    description:
      "Usa detección general y reglas heurísticas para hallazgos operacionales en tiempo real.",
  },
];

function getCameraNumberFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("cam") || params.get("camera") || params.get("id");
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
  } catch {
    return null;
  }
}

function pickVideoIdForCamera(videosList, cameraNumber) {
  if (!Array.isArray(videosList) || videosList.length === 0) return null;
  if (!cameraNumber) return videosList[0]?.id ?? null;

  const byId = videosList.find((item) => Number(item?.id) === Number(cameraNumber));
  if (byId?.id != null) return byId.id;

  const index = cameraNumber - 1;
  if (index >= 0 && index < videosList.length) {
    return videosList[index]?.id ?? videosList[0]?.id ?? null;
  }

  const wrappedIndex = ((cameraNumber - 1) % videosList.length + videosList.length) % videosList.length;
  return videosList[wrappedIndex]?.id ?? videosList[0]?.id ?? null;
}

function ensureCameraModels(modelsList) {
  const base = Array.isArray(modelsList) ? modelsList.slice() : [];
  const codes = new Set(base.map((item) => item?.code).filter(Boolean));

  DEFAULT_CAMERA_MODELS.forEach((item) => {
    if (!codes.has(item.code)) {
      base.push({ ...item });
    }
  });

  return base;
}

function translateStatus(status) {
  if (status === "running") return "Analizando";
  if (status === "running_backend") return "Analizando (backend)";
  if (status === "error") return "Con error";
  return "Inicializando";
}

function getCoverageLabel(mode) {
  if (mode === "heuristic") return "Tiempo real";
  if (mode === "ppe_live") return "Modelo PPE activo";
  return "Modelo especializado pendiente";
}

function getCoverageTone(mode) {
  if (mode === "heuristic") {
    return {
      background: "#dcfce7",
      color: "#166534",
      borderColor: "#86efac",
    };
  }

  if (mode === "ppe_live") {
    return {
      background: "#f3e8ff",
      color: "#7c3aed",
      borderColor: "#c4b5fd",
    };
  }

  return {
    background: "#fef3c7",
    color: "#92400e",
    borderColor: "#fcd34d",
  };
}

function getSeverityTone(severity) {
  if (severity === "high") {
    return {
      background: "#fee2e2",
      color: "#b91c1c",
      borderColor: "#fca5a5",
    };
  }

  return {
    background: "#e0f2fe",
    color: "#075985",
    borderColor: "#7dd3fc",
  };
}

function formatCameraSourceLabel(video) {
  if (!video) return "Fuente";
  return video.source_type_label || video.source_type || "Fuente";
}

function formatPanelSubtitle(video) {
  if (!video) return "Analítica en vivo sobre la fuente seleccionada";
  const mode = video.is_live ? "en vivo" : "archivo";
  return `${formatCameraSourceLabel(video)} ${mode} sobre la fuente configurada`;
}

function formatCameraMapLabel(video) {
  if (!video?.map_code) return "Sin mapa";
  if (video.map_code === "NP_dia") return "Diamante - NP";
  if (video.map_code === "NTI_andes_norte") return "Diamante NTI";
  if (video.map_code === "NTI_dia") return "Diamante NTI";
  if (video.map_code === "NTI_nok") return "Diamante NTI";
  if (video.map_code === "UCL_dia") return "Diamante UCL";
  return video.map_code;
}

function matchesCameraTableSearch(values, search) {
  if (!search) return true;
  return values
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(search);
}

function buildAnalyticsSnapshotPayload({ analytics, panelKey, selectedModelCode, selectedVideoId }) {
  if (!analytics || !selectedVideoId || selectedModelCode !== "operational_safety_monitor") {
    return null;
  }

  const summaryRows = (analytics.findings?.rows || [])
    .filter((row) => row.mode !== "pending")
    .map((row) => ({
      code: String(row.code),
      group: row.group || "General",
      label: row.label || `Hallazgo ${row.code}`,
      severity: row.severity || "medium",
      coverage: getCoverageLabel(row.mode),
      coverage_mode: row.mode || null,
      active_count: Number(row.activeCount || 0),
      total_count: Number(row.totalCount || 0),
      last_seen_at: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
      last_evidence: row.lastEvidence || "",
    }));

  const recentFindings = (analytics.findings?.recent || []).map((item) => ({
    event_id: item.id,
    code: String(item.code),
    group: item.group || "General",
    label: item.label || `Hallazgo ${item.code}`,
    severity: item.severity || "medium",
    coverage: getCoverageLabel(item.coverage),
    zone: item.zone || "-",
    confidence: Number(item.confidence || 0),
    evidence: item.evidence || "",
    detected_at: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
  }));

  return {
    panel_key: panelKey,
    video_id: Number(selectedVideoId),
    model_code: selectedModelCode,
    active_persons: Number(analytics.counts?.activePersons || 0),
    active_vehicles: Number(analytics.counts?.activeVehicles || 0),
    active_findings: Number(analytics.counts?.activeFindings || 0),
    cumulative_findings: Number(analytics.counts?.cumulativeFindings || 0),
    summary_rows: summaryRows,
    recent_findings: recentFindings,
  };
}

function SourceDetailsCard({ source }) {
  if (!source) return null;

  const rows = [
    { label: "Tipo", value: formatCameraSourceLabel(source) },
    { label: "Reproducción", value: source.uses_relay ? "Relay HLS desde backend" : source.playback_kind === "hls" ? "HLS directo" : "Video directo" },
    { label: "Mapa", value: formatCameraMapLabel(source) },
    { label: "Sitio / nivel", value: [source.site, source.nivel].filter(Boolean).join(" / ") || "-" },
    { label: "Host", value: source.camera_ip || "-" },
    { label: "Puerto", value: source.camera_port || "-" },
    { label: "Path", value: source.camera_path || "-" },
    { label: "Usuario", value: source.camera_user || "-" },
    { label: "Credenciales", value: source.has_credentials ? "Configuradas" : "Sin credenciales" },
  ];

  return (
    <div style={styles.sidebarCard}>
      <div style={styles.cardTitle}>Fuente de video</div>
      <div style={styles.metaGrid}>
        {rows.map((row) => (
          <MetaRow key={row.label} label={row.label} value={row.value} />
        ))}
      </div>

      <div style={styles.sourceUrlBlock}>
        <div style={styles.sourceUrlLabel}>Origen configurado</div>
        <div style={styles.sourceUrlValue}>{source.resolved_source || source.source || "-"}</div>
      </div>

      {source.notes ? <div style={styles.sourceNotes}>{source.notes}</div> : null}
    </div>
  );
}

function CameraPanel({ panelIndex, videos, models, config, onChange }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const hlsRef = useRef(null);
  const ppeRequestRef = useRef(false);
  const analyticsRef = useRef(null);
  const backendFallbackRef = useRef(false);
  const panelKey = `panel_${panelIndex}`;
  const [analytics, setAnalytics] = useState(() => getPanelAnalytics(panelKey));

  const selectedVideo = videos.find((item) => item.id === config.videoId) || videos[0];
  const selectedModel = models.find((item) => item.id === config.modelId) || models[0];
  const selectedVideoId = selectedVideo?.id ?? null;
  const selectedModelCode = selectedModel?.code || null;

  useEffect(() => {
    backendFallbackRef.current = false;
    resetPanelAnalytics(panelKey);
    setPanelLocalInferenceEnabled(panelKey, true);
    setAnalytics(getPanelAnalytics(panelKey));
    return () => resetPanelAnalytics(panelKey);
  }, [panelKey, selectedVideo?.id, selectedModel?.code]);

  useEffect(() => {
    const timer = setInterval(() => {
      setAnalytics(getPanelAnalytics(panelKey));
    }, 350);
    return () => clearInterval(timer);
  }, [panelKey]);

  useEffect(() => {
    analyticsRef.current = analytics;
  }, [analytics]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedVideo) return undefined;

    const playbackUrl = selectedVideo.playback_url || selectedVideo.source;
    if (!playbackUrl) return undefined;

    const isHls = selectedVideo.playback_kind === "hls" || /\.m3u8($|\?)/i.test(playbackUrl);
    let cancelled = false;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    video.pause();
    video.removeAttribute("src");
    video.load();

    const playVideo = () => {
      if (cancelled) return;
      video.play().catch((error) => console.warn("No se pudo iniciar la fuente de video:", error));
    };

    if (isHls) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playbackUrl;
        video.addEventListener("loadeddata", playVideo, { once: true });
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        hlsRef.current = hls;
        hls.loadSource(playbackUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, playVideo);
      } else {
        console.warn("El navegador no soporta HLS para esta fuente:", playbackUrl);
      }
    } else {
      video.src = playbackUrl;
      video.addEventListener("loadeddata", playVideo, { once: true });
    }

    return () => {
      cancelled = true;
      video.pause();
      video.removeEventListener("loadeddata", playVideo);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [selectedVideo]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !selectedVideoId || !selectedModelCode) return undefined;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let running = true;

    const renderLoop = () => {
      if (!running) return;

      if (video.readyState >= 2 && !video.paused && !video.ended) {
        const videoWidth = video.videoWidth || 640;
        const videoHeight = video.videoHeight || 360;

        if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
          canvas.width = videoWidth;
          canvas.height = videoHeight;
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
          applyModelOverlay(ctx, selectedModelCode, canvas.width, canvas.height, panelKey);
        } catch (error) {
          console.warn("Error en applyModelOverlay:", error);
        }
      }

      animRef.current = requestAnimationFrame(renderLoop);
    };

    const startPlaybackAndLoop = () => {
      video.play().catch((error) => console.warn("No se pudo hacer play() automatico:", error));
      if (!animRef.current) {
        animRef.current = requestAnimationFrame(renderLoop);
      }
    };

    if (video.readyState >= 2) {
      startPlaybackAndLoop();
    } else {
      video.addEventListener("loadeddata", startPlaybackAndLoop, { once: true });
    }

    return () => {
      running = false;
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      video.removeEventListener("loadeddata", startPlaybackAndLoop);
    };
  }, [panelKey, selectedModelCode, selectedVideoId]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !selectedVideoId || selectedModelCode !== "operational_safety_monitor") {
      return undefined;
    }

    let cancelled = false;
    let timerId = null;
    const effectStartedAt = Date.now();

    const shouldUseBackendOperational = () => {
      if (backendFallbackRef.current) {
        return true;
      }

      const current = analyticsRef.current;
      const now = Date.now();
      const lastError = current?.lastError;
      const lastInferenceAt = Number(current?.perf?.lastInferenceAt || 0);
      const localNeverStarted = !lastInferenceAt && now - effectStartedAt > 1800;
      const localStalled = lastInferenceAt > 0 && now - lastInferenceAt > 4200;

      if (lastError || localNeverStarted || localStalled) {
        backendFallbackRef.current = true;
        setPanelLocalInferenceEnabled(panelKey, false);
      }

      return backendFallbackRef.current;
    };

    const syncLoop = async () => {
      if (cancelled || ppeRequestRef.current) return;
      if (video.readyState < 2 || video.paused || video.ended || canvas.width === 0 || canvas.height === 0) {
        timerId = window.setTimeout(syncLoop, 900);
        return;
      }

      ppeRequestRef.current = true;
      try {
        const includeOperational = shouldUseBackendOperational();
        const imageBase64 = canvas.toDataURL("image/jpeg", 0.72);
        const response = await fetch(`${API_BASE_URL}/cameras/analyze-ppe-frame`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`,
          },
          body: JSON.stringify({
            panel_key: panelKey,
            video_id: selectedVideoId,
            model_code: selectedModelCode,
            include_operational: includeOperational,
            image_base64: imageBase64,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        mergeExternalPpeAnalytics(panelKey, data, canvas.width, canvas.height);
        if (includeOperational) {
          mergeExternalOperationalAnalytics(panelKey, data, canvas.width, canvas.height);
        }
        setAnalytics(getPanelAnalytics(panelKey));
      } catch (error) {
        console.warn("Error sincronizando PPE con backend:", error);
      } finally {
        ppeRequestRef.current = false;
        if (!cancelled) {
          timerId = window.setTimeout(
            syncLoop,
            backendFallbackRef.current ? 900 : 2200
          );
        }
      }
    };

    syncLoop();

    return () => {
      cancelled = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
  }, [panelKey, selectedModelCode, selectedVideoId]);

  useEffect(() => {
    if (!selectedVideoId || selectedModelCode !== "operational_safety_monitor") {
      return undefined;
    }

    let cancelled = false;
    const syncSnapshot = async () => {
      const payload = buildAnalyticsSnapshotPayload({
        analytics: analyticsRef.current,
        panelKey,
        selectedModelCode,
        selectedVideoId,
      });
      if (!payload) return;

      try {
        await fetch(`${API_BASE_URL}/cameras/analytics/snapshot`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`,
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (!cancelled) {
          console.warn("Error sincronizando snapshot de analítica:", error);
        }
      }
    };

    syncSnapshot();
    const timer = setInterval(syncSnapshot, 4500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [panelKey, selectedModelCode, selectedVideoId]);

  if (!selectedVideo || !selectedModel) return null;

  return (
    <div style={styles.panelShell}>
      <div style={styles.panelHeader}>
        <div>
          <div style={styles.panelTitle}>Panel {panelIndex + 1}</div>
          <div style={styles.panelSubTitle}>{formatPanelSubtitle(selectedVideo)}</div>
        </div>

        <div style={styles.panelControls}>
          <label style={styles.selectLabel}>
            Video
            <select
              style={styles.select}
              value={selectedVideo.id}
              onChange={(event) =>
                onChange(panelIndex, {
                  ...config,
                  videoId: Number(event.target.value),
                })
              }
            >
              {videos.map((item) => (
                <option key={item.id} value={item.id}>
                  [{formatCameraSourceLabel(item)}] {item.name}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.selectLabel}>
            Análisis
            <select
              style={styles.select}
              value={selectedModel.id}
              onChange={(event) =>
                onChange(panelIndex, {
                  ...config,
                  modelId: Number(event.target.value),
                })
              }
            >
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div style={styles.contentGrid}>
        <div style={styles.videoCard}>
          <video
            ref={videoRef}
            controls
            loop={!selectedVideo?.is_live}
            muted
            autoPlay
            playsInline
            onLoadedMetadata={(event) => {
              const video = event.target;
              if (!selectedVideo?.is_live && Number.isFinite(video.duration) && video.duration > 0) {
                video.currentTime = video.duration / 2;
              }
            }}
            style={styles.hiddenVideo}
          />

          <canvas
            ref={canvasRef}
            style={styles.canvas}
          />

          <OperationalFindingsTable analytics={analytics} modelCode={selectedModel.code} />
        </div>

        <aside style={styles.sidebar}>
          <SourceDetailsCard source={selectedVideo} />
          <AnalyticsSummary analytics={analytics} modelName={selectedModel.name} />
          <RecentFindingsTable analytics={analytics} />
          <RecentEventsTable analytics={analytics} />
        </aside>
      </div>
    </div>
  );
}

function AnalyticsSummary({ analytics, modelName }) {
  const counts = analytics?.counts || {};
  const perf = analytics?.perf || {};
  const findingsSummary = analytics?.findings?.summary || {};

  const cards = [
    { label: "Personas activas", value: counts.activePersons || 0, accent: "#22c55e" },
    { label: "Vehículos activos", value: counts.activeVehicles || 0, accent: "#f59e0b" },
    { label: "Hallazgos activos", value: counts.activeFindings || 0, accent: "#ef4444" },
    { label: "Hallazgos acumulados", value: counts.cumulativeFindings || 0, accent: "#a78bfa" },
  ];

  return (
    <div style={styles.sidebarCard}>
      <div style={styles.cardTitle}>Resumen analítico</div>
      <div style={styles.kpiGrid}>
        {cards.map((card) => (
          <div key={card.label} style={{ ...styles.kpiCard, borderTop: `3px solid ${card.accent}` }}>
            <div style={styles.kpiValue}>{card.value}</div>
            <div style={styles.kpiLabel}>{card.label}</div>
          </div>
        ))}
      </div>

      <div style={styles.metaGrid}>
        <MetaRow label="Modelo lógico" value={modelName || analytics?.modelCode || "-"} />
        <MetaRow label="Estado" value={translateStatus(analytics?.status)} />
        <MetaRow label="FPS" value={perf.fps || 0} />
        <MetaRow label="Tiempo inferencia" value={`${perf.lastInferenceMs || 0} ms`} />
        <MetaRow label="Personas acumuladas" value={counts.cumulativePersons || 0} />
        <MetaRow label="Vehículos acumulados" value={counts.cumulativeVehicles || 0} />
        <MetaRow label="Cobertura en vivo" value={findingsSummary.supported || 0} />
        <MetaRow label="Pendientes especializados" value={findingsSummary.pendingModels || 0} />
      </div>

      {analytics?.lastError ? (
        <div style={styles.errorBox}>{analytics.lastError}</div>
      ) : null}
    </div>
  );
}

function MetaRow({ label, value }) {
  return (
    <div style={styles.metaRow}>
      <span style={styles.metaLabel}>{label}</span>
      <span style={styles.metaValue}>{value}</span>
    </div>
  );
}

function OperationalFindingsTable({ analytics, modelCode }) {
  const [filterMode, setFilterMode] = useState("live");
  const [showDetails, setShowDetails] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const rows = useMemo(() => {
    const items = analytics?.findings?.rows || [];
    const sorted = items
      .slice()
      .sort((left, right) => Number(left.code) - Number(right.code));

    return sorted
      .filter((row) => (filterMode === "live" ? row.mode !== "pending" : true))
      .filter((row) =>
        matchesCameraTableSearch(
          [
            row.code,
            row.group,
            row.label,
            row.mode,
            row.lastSeenLabel,
            row.lastEvidence,
          ],
          normalizedSearch
        )
      );
  }, [analytics, filterMode, normalizedSearch]);

  const summary = analytics?.findings?.summary || {};
  const operationalMode = modelCode === "operational_safety_monitor";
  const priorityRows = useMemo(() => {
    return rows
      .slice()
      .sort((left, right) => {
        const activeDiff = Number(right.activeCount || 0) - Number(left.activeCount || 0);
        if (activeDiff !== 0) return activeDiff;
        const totalDiff = Number(right.totalCount || 0) - Number(left.totalCount || 0);
        if (totalDiff !== 0) return totalDiff;
        return Number(left.code || 0) - Number(right.code || 0);
      })
      .slice(0, 5);
  }, [rows]);

  return (
    <div style={styles.findingsCard}>
      <div style={styles.findingsHeader}>
        <div>
          <div style={styles.cardTitle}>Hallazgos operacionales y de seguridad</div>
          <div style={styles.findingsLead}>
            Tabla acumulativa para incumplimientos EPP, tránsito peatonal e interacción peatón-vehículo.
          </div>
        </div>

        <div style={styles.findingsHeaderRight}>
          <div style={styles.findingsSummaryRow}>
            <SummaryPill label="Activos" value={summary.active || 0} tone="#fee2e2" color="#b91c1c" />
            <SummaryPill label="Acumulados" value={summary.cumulative || 0} tone="#ede9fe" color="#5b21b6" />
          </div>
          <button
            type="button"
            style={showDetails ? styles.filterButtonActive : styles.filterButton}
            onClick={() => setShowDetails((current) => !current)}
          >
            {showDetails ? "Ocultar detalle" : "Ver detalle completo"}
          </button>
        </div>
      </div>

      {!operationalMode ? (
        <div style={styles.modeHint}>
          Selecciona <strong>Monitor operacional y seguridad</strong> para activar los hallazgos en tiempo real.
          Los items marcados como "Modelo especializado pendiente" quedan listos para conectarse a modelos dedicados.
        </div>
      ) : (
        <div style={styles.modeHintSuccess}>
          Análisis operativo activo. La app combina detección local para movimiento/proximidad y apoyo PPE desde backend
          para casco, lentes, guantes y EPP incompleto; los restantes siguen pendientes de un modelo minero dedicado.
        </div>
      )}

      {!showDetails ? (
        <div style={styles.findingsCompactGrid}>
          {priorityRows.length === 0 ? (
            <div style={styles.findingsCompactEmpty}>
              No hay hallazgos prioritarios para este panel en este momento.
            </div>
          ) : (
            priorityRows.map((row) => {
              const coverageTone = getCoverageTone(row.mode);
              const severityTone = getSeverityTone(row.severity);
              return (
                <div key={row.code} style={styles.findingsCompactCard}>
                  <div style={styles.findingsCompactTop}>
                    <span style={styles.tdStrong}>#{row.code}</span>
                    <span style={{ ...styles.inlineBadge, ...coverageTone }}>
                      {getCoverageLabel(row.mode)}
                    </span>
                  </div>
                  <div style={styles.findingsCompactTitle}>{row.label}</div>
                  <div style={styles.findingsCompactMeta}>{row.group || "General"}</div>
                  <div style={styles.findingsSummaryRow}>
                    <span style={{ ...styles.inlineBadge, ...severityTone }}>
                      Activos: {row.activeCount || 0}
                    </span>
                    <span style={styles.inlineBadge}>
                      Acum.: {row.totalCount || 0}
                    </span>
                  </div>
                  <div style={styles.findingsCompactMeta}>
                    Último evento: {row.lastSeenLabel || "-"}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <>
          <div style={styles.filterGroup}>
            <button
              type="button"
              style={filterMode === "live" ? styles.filterButtonActive : styles.filterButton}
              onClick={() => setFilterMode("live")}
            >
              En tiempo real
            </button>
            <button
              type="button"
              style={filterMode === "all" ? styles.filterButtonActive : styles.filterButton}
              onClick={() => setFilterMode("all")}
            >
              Todos
            </button>
          </div>

          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar hallazgo, código, grupo o evidencia..."
            style={styles.tableSearch}
          />

          <div style={styles.tableWrapTall}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Cod.</th>
                  <th style={styles.th}>Grupo</th>
                  <th style={styles.th}>Hallazgo</th>
                  <th style={styles.th}>Cobertura</th>
                  <th style={styles.th}>Activos</th>
                  <th style={styles.th}>Acumulados</th>
                  <th style={styles.th}>Último evento</th>
                  <th style={styles.th}>Evidencia</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={styles.emptyCell}>
                      {normalizedSearch
                        ? "No hay coincidencias para el filtro aplicado."
                        : "Aún no hay hallazgos configurados."}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const coverageTone = getCoverageTone(row.mode);
                    const severityTone = getSeverityTone(row.severity);
                    return (
                      <tr key={row.code}>
                        <td style={styles.tdStrong}>#{row.code}</td>
                        <td style={styles.td}>{row.group}</td>
                        <td style={styles.td}>{row.label}</td>
                        <td style={styles.td}>
                          <span style={{ ...styles.inlineBadge, ...coverageTone }}>
                            {getCoverageLabel(row.mode)}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span style={{ ...styles.inlineBadge, ...severityTone }}>
                            {row.activeCount || 0}
                          </span>
                        </td>
                        <td style={styles.td}>{row.totalCount || 0}</td>
                        <td style={styles.td}>{row.lastSeenLabel || "-"}</td>
                        <td style={styles.tdSoft}>{row.lastEvidence || "-"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryPill({ label, value, tone, color }) {
  return (
    <div style={{ ...styles.summaryPill, background: tone, color }}>
      <span style={styles.summaryPillLabel}>{label}</span>
      <span style={styles.summaryPillValue}>{value}</span>
    </div>
  );
}

function RecentFindingsTable({ analytics }) {
  const [searchTerm, setSearchTerm] = useState("");
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const items = useMemo(() => {
    return (analytics?.findings?.recent || []).filter((item) =>
      matchesCameraTableSearch(
        [item.timeLabel, item.code, item.label, item.zone],
        normalizedSearch
      )
    );
  }, [analytics, normalizedSearch]);

  return (
    <div style={styles.sidebarCard}>
      <div style={styles.cardTitle}>Últimos hallazgos</div>
      <input
        type="text"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Buscar por código, hallazgo o zona..."
        style={styles.tableSearch}
      />
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Hora</th>
              <th style={styles.th}>Cod.</th>
              <th style={styles.th}>Hallazgo</th>
              <th style={styles.th}>Zona</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} style={styles.emptyCell}>
                  {normalizedSearch
                    ? "No hay coincidencias para el filtro aplicado."
                    : "Aún no hay hallazgos registrados."}
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td style={styles.td}>{item.timeLabel}</td>
                  <td style={styles.tdStrong}>#{item.code}</td>
                  <td style={styles.td}>{item.label}</td>
                  <td style={styles.td}>{item.zone}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecentEventsTable({ analytics }) {
  const [searchTerm, setSearchTerm] = useState("");
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const events = useMemo(() => {
    return (analytics?.recentEvents || []).filter((event) =>
      matchesCameraTableSearch(
        [event.timeLabel, event.label, event.zone, `${event.confidence || 0}`],
        normalizedSearch
      )
    );
  }, [analytics, normalizedSearch]);

  return (
    <div style={styles.sidebarCard}>
      <div style={styles.cardTitle}>Últimas detecciones</div>
      <input
        type="text"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Buscar por clase, zona o confianza..."
        style={styles.tableSearch}
      />
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Hora</th>
              <th style={styles.th}>Clase</th>
              <th style={styles.th}>Conf.</th>
              <th style={styles.th}>Zona</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={4} style={styles.emptyCell}>
                  {normalizedSearch
                    ? "No hay coincidencias para el filtro aplicado."
                    : "Aún no hay detecciones registradas."}
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id}>
                  <td style={styles.td}>{event.timeLabel}</td>
                  <td style={styles.td}>{event.label}</td>
                  <td style={styles.td}>{event.confidence}%</td>
                  <td style={styles.td}>{event.zone}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Cameras() {
  const [videos, setVideos] = useState([]);
  const [models, setModels] = useState([]);
  const [panelCount, setPanelCount] = useState(1);
  const [panelsConfig, setPanelsConfig] = useState([
    { videoId: null, modelId: null },
    { videoId: null, modelId: null },
    { videoId: null, modelId: null },
  ]);

  const cameraNumber = useMemo(() => getCameraNumberFromUrl(), []);

  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch(`${API_BASE_URL}/cameras/config`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`,
          },
        });

        if (!response.ok) {
          console.error("Error HTTP al cargar config camaras:", response.status);
          return;
        }

        const data = await response.json();
        const videosList = data.videos || [];
        const modelsList = ensureCameraModels(data.models || []);

        setVideos(videosList);
        setModels(modelsList);

        if (videosList.length > 0 && modelsList.length > 0) {
          const preferredModel =
            modelsList.find((item) => item.code === "operational_safety_monitor") || modelsList[0];
          const selectedVideoId = pickVideoIdForCamera(videosList, cameraNumber);

          setPanelsConfig((previous) =>
            previous.map(() => ({
              videoId: selectedVideoId ?? videosList[0].id,
              modelId: preferredModel.id,
            })),
          );
        }
      } catch (error) {
        console.error("Error cargando configuracion de camaras:", error);
      }
    }

    loadConfig();
  }, [cameraNumber]);

  const handlePanelConfigChange = (panelIndex, nextConfig) => {
    setPanelsConfig((previous) =>
      previous.map((item, index) => (index === panelIndex ? nextConfig : item)),
    );
  };

  const activePanels = panelsConfig.slice(0, Math.min(panelCount, 3));

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h1 style={styles.pageTitle}>Cámaras</h1>
          <p style={styles.pageLead}>Analítica visual en tiempo real sobre videos del módulo TMOne.</p>
          <p style={styles.pageLeadMuted}>
            Soporta videos locales, HLS directos y cámaras RTSP/HTTP mediante relay HLS desde backend.
          </p>
        </div>

        <div style={styles.topControls}>
          <label style={styles.selectLabel}>
            Cantidad de paneles
            <select
              style={styles.select}
              value={panelCount}
              onChange={(event) =>
                setPanelCount(Math.min(3, Math.max(1, Number(event.target.value) || 1)))
              }
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
        </div>
      </div>

      {videos.length === 0 || models.length === 0 ? (
        <p style={styles.loading}>Cargando configuracion de camaras...</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: panelCount === 1 ? "1fr" : "repeat(2, minmax(0, 1fr))",
            gap: "1.25rem",
          }}
        >
          {activePanels.map((config, index) => (
            <CameraPanel
              key={index}
              panelIndex={index}
              videos={videos}
              models={models}
              config={config}
              onChange={handlePanelConfigChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  pageHeader: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: "1rem",
    flexWrap: "wrap",
  },
  pageTitle: {
    margin: 0,
    fontSize: "1.8rem",
    color: "#0f172a",
  },
  pageLead: {
    margin: "0.35rem 0 0 0",
    color: "#475569",
  },
  pageLeadMuted: {
    margin: "0.3rem 0 0 0",
    color: "#64748b",
    fontSize: "0.92rem",
  },
  topControls: {
    display: "flex",
    gap: "0.75rem",
    alignItems: "center",
  },
  panelShell: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "18px",
    padding: "1rem",
    boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    marginBottom: "1rem",
    flexWrap: "wrap",
  },
  panelTitle: {
    fontWeight: 700,
    color: "#0f172a",
  },
  panelSubTitle: {
    marginTop: "0.2rem",
    fontSize: "0.92rem",
    color: "#64748b",
  },
  panelControls: {
    display: "flex",
    gap: "0.75rem",
    flexWrap: "wrap",
  },
  selectLabel: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    fontSize: "0.85rem",
    color: "#334155",
  },
  select: {
    minWidth: "180px",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    padding: "0.55rem 0.7rem",
    background: "#fff",
    color: "#0f172a",
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.55fr) minmax(320px, 0.95fr)",
    gap: "1rem",
  },
  videoCard: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  canvas: {
    width: "100%",
    maxHeight: "420px",
    border: "1px solid #1e293b",
    borderRadius: "14px",
    background: "#020617",
    boxShadow: "0 20px 40px rgba(15, 23, 42, 0.18)",
  },
  hiddenVideo: {
    position: "absolute",
    width: "1px",
    height: "1px",
    opacity: 0,
    pointerEvents: "none",
  },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    minWidth: 0,
  },
  sidebarCard: {
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    padding: "0.9rem",
    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
  },
  findingsCard: {
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    padding: "1rem",
    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
  },
  findingsHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    flexWrap: "wrap",
    marginBottom: "0.85rem",
  },
  findingsLead: {
    marginTop: "0.3rem",
    color: "#64748b",
    fontSize: "0.88rem",
  },
  findingsCompactGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "0.75rem",
  },
  findingsCompactCard: {
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    background: "#ffffff",
    padding: "0.85rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.55rem",
  },
  findingsCompactTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
  },
  findingsCompactTitle: {
    color: "#0f172a",
    fontSize: "0.92rem",
    fontWeight: 700,
    lineHeight: 1.35,
  },
  findingsCompactMeta: {
    color: "#64748b",
    fontSize: "0.82rem",
    lineHeight: 1.4,
  },
  findingsCompactEmpty: {
    border: "1px dashed #cbd5e1",
    borderRadius: "14px",
    padding: "1rem",
    color: "#64748b",
    textAlign: "center",
    background: "#ffffff",
  },
  findingsSummaryRow: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  findingsHeaderRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "0.75rem",
  },
  filterGroup: {
    display: "inline-flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  filterButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    background: "#f8fafc",
    color: "#334155",
    padding: "0.55rem 0.9rem",
    cursor: "pointer",
    fontSize: "0.85rem",
    fontWeight: 600,
  },
  filterButtonActive: {
    border: "1px solid #0f172a",
    borderRadius: "999px",
    background: "#0f172a",
    color: "#f8fafc",
    padding: "0.55rem 0.9rem",
    cursor: "pointer",
    fontSize: "0.85rem",
    fontWeight: 600,
  },
  summaryPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.55rem",
    borderRadius: "999px",
    padding: "0.45rem 0.7rem",
    fontSize: "0.8rem",
    fontWeight: 700,
  },
  summaryPillLabel: {
    opacity: 0.84,
  },
  summaryPillValue: {
    fontSize: "0.95rem",
  },
  cardTitle: {
    fontWeight: 700,
    color: "#0f172a",
    marginBottom: "0.9rem",
  },
  modeHint: {
    marginBottom: "0.9rem",
    background: "#fff7ed",
    color: "#9a3412",
    border: "1px solid #fdba74",
    borderRadius: "12px",
    padding: "0.8rem 0.9rem",
    fontSize: "0.86rem",
    lineHeight: 1.5,
  },
  modeHintSuccess: {
    marginBottom: "0.9rem",
    background: "#eff6ff",
    color: "#1d4ed8",
    border: "1px solid #93c5fd",
    borderRadius: "12px",
    padding: "0.8rem 0.9rem",
    fontSize: "0.86rem",
    lineHeight: 1.5,
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "0.75rem",
    marginBottom: "0.9rem",
  },
  kpiCard: {
    background: "#fff",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
    padding: "0.8rem",
  },
  kpiValue: {
    fontSize: "1.4rem",
    fontWeight: 800,
    color: "#0f172a",
  },
  kpiLabel: {
    marginTop: "0.25rem",
    fontSize: "0.84rem",
    color: "#64748b",
  },
  metaGrid: {
    display: "grid",
    gap: "0.55rem",
  },
  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "0.75rem",
    fontSize: "0.9rem",
  },
  metaLabel: {
    color: "#64748b",
  },
  metaValue: {
    color: "#0f172a",
    fontWeight: 600,
    textAlign: "right",
  },
  sourceUrlBlock: {
    marginTop: "0.9rem",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    background: "#fff",
    padding: "0.75rem 0.85rem",
  },
  sourceUrlLabel: {
    fontSize: "0.76rem",
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  sourceUrlValue: {
    marginTop: "0.45rem",
    color: "#0f172a",
    fontSize: "0.82rem",
    lineHeight: 1.45,
    wordBreak: "break-word",
  },
  sourceNotes: {
    marginTop: "0.85rem",
    borderRadius: "12px",
    background: "#eef2ff",
    color: "#3730a3",
    border: "1px solid #c7d2fe",
    padding: "0.7rem 0.8rem",
    fontSize: "0.82rem",
    lineHeight: 1.45,
  },
  tableSearch: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: "12px",
    padding: "0.75rem 0.85rem",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: "0.85rem",
    marginBottom: "0.75rem",
  },
  tableWrap: {
    overflow: "auto",
    maxHeight: "270px",
  },
  tableWrapTall: {
    overflow: "auto",
    maxHeight: "420px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.86rem",
  },
  th: {
    textAlign: "left",
    padding: "0.6rem 0.55rem",
    borderBottom: "1px solid #cbd5e1",
    color: "#475569",
    background: "#f8fafc",
    position: "sticky",
    top: 0,
    zIndex: 1,
  },
  td: {
    padding: "0.55rem",
    borderBottom: "1px solid #e2e8f0",
    color: "#0f172a",
    verticalAlign: "top",
  },
  tdStrong: {
    padding: "0.55rem",
    borderBottom: "1px solid #e2e8f0",
    color: "#0f172a",
    verticalAlign: "top",
    fontWeight: 700,
  },
  tdSoft: {
    padding: "0.55rem",
    borderBottom: "1px solid #e2e8f0",
    color: "#64748b",
    verticalAlign: "top",
  },
  inlineBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    padding: "0.2rem 0.55rem",
    fontSize: "0.76rem",
    fontWeight: 700,
    border: "1px solid transparent",
    whiteSpace: "nowrap",
  },
  emptyCell: {
    padding: "1rem 0.55rem",
    color: "#64748b",
    textAlign: "center",
  },
  loading: {
    color: "#475569",
    margin: 0,
  },
  errorBox: {
    marginTop: "0.9rem",
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    padding: "0.75rem",
    borderRadius: "12px",
    fontSize: "0.86rem",
    wordBreak: "break-word",
  },
};
