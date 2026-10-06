import React, { useState, useRef } from "react";

/* =====================================================
   MAPAS DISPONIBLES
===================================================== */
const MAPS = [
{ label: "NTI Andes Norte", code: "NTI_andes_norte", image: "/maps/NTI_andes_norte.jpeg" },
{ label: "Diamante - NP", code: "NP_dia", image: "/maps/NP_dia.jpeg" },
{ label: "Diamante NTI", code: "NTI_dia", image: "/maps/NTI_dia.jpeg" }];


/* =====================================================
   TIPOS (INVENTADOS)
===================================================== */
const PORTICO_TYPES = [
{ id: 1, name: "Pórtico estándar" },
{ id: 2, name: "Pórtico con agentes ambientales" },
{ id: 3, name: "Pórtico de emergencia" }];


/* =====================================================
   SITES (INVENTADOS)
===================================================== */
const SITES = ["Mina Central", "Planta", "Rajo Norte"];

/* =====================================================
   ZONAS (INVENTADAS)
===================================================== */
const ZONES = ["Zona_1", "Zona_2", "Zona_3", "Zona_4", "Zona_5"];

/* =====================================================
   COLORES (INVENTADOS)
===================================================== */
const COLORS = ["#ff0000", "#00b300", "#0066ff", "#ff9900", "#cc00cc"];

/* =====================================================
   MODAL COMPLETO
   - Mantiene toda la UI original
   - Ahora usa X/Y en PORCENTAJE como Tracking
   - GUARDA: name, x_pct, y_pct
===================================================== */
export default function PorticoEditModal({ portico, onClose, onSaved }) {
  /* -----------------------------------------------
     1) ESTADOS PRINCIPALES
  ------------------------------------------------ */
  const [name, setName] = useState(portico.name);

  // Valores desde BD (porcentaje)
  const [xPct, setXPct] = useState(portico.x_pct ?? 0.5);
  const [yPct, setYPct] = useState(portico.y_pct ?? 0.5);

  const [mapName, setMapName] = useState(portico.map_code || MAPS[0].code);

  /* -----------------------------------------------
     2) ESTADOS VISUALES (NO SE GUARDAN)
  ------------------------------------------------ */
  const [tipo, setTipo] = useState(1);
  const [site, setSite] = useState("Mina Central");
  const [zone, setZone] = useState("Zona_1");
  const [color, setColor] = useState("#ff0000");
  const [rotation, setRotation] = useState(0);

  /* -----------------------------------------------
     3) ZOOM / REFERENCIAS
  ------------------------------------------------ */
  const [scale, setScale] = useState(1);
  const containerRef = useRef();
  const imageRef = useRef();

  const zoomIn = () => setScale((s) => s + 0.15);
  const zoomOut = () => setScale((s) => Math.max(0.3, s - 0.15));

  /* -----------------------------------------------
     4) CALCULAR POSICIÓN REAL EN PIXELES
     A PARTIR DEL PORCENTAJE
  ------------------------------------------------ */
  const getPointPx = () => {
    const img = imageRef.current;
    if (!img) return { px: 0, py: 0 };

    const rect = img.getBoundingClientRect();
    return {
      px: rect.width * xPct,
      py: rect.height * yPct
    };
  };

  /* -----------------------------------------------
     5) CLICK SOBRE EL MAPA → ACTUALIZA %
  ------------------------------------------------ */
  const handleMapClick = (e) => {
    const img = imageRef.current;
    if (!img) return;

    const rect = img.getBoundingClientRect();

    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const newXPct = clickX / rect.width;
    const newYPct = clickY / rect.height;

    setXPct(Number(newXPct.toFixed(4)));
    setYPct(Number(newYPct.toFixed(4)));
  };

  /* -----------------------------------------------
     6) GUARDAR SOLO NOMBRE + PORCENTAJE
  ------------------------------------------------ */
  const handleSave = async () => {
    const payload = {
      id: portico.id,
      name,
      x_pct: xPct,
      y_pct: yPct,
      map_code: mapName
    };

    try {
      const res = await fetch(`/api/config/porticos/${portico.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Error backend");
      onSaved();
    } catch (err) {
      alert("Error al guardar");
      console.error(err);
    }
  };

  /* -----------------------------------------------
     7) POSICIÓN ACTUAL DEL PUNTO EN PIXELES
  ------------------------------------------------ */
  const { px, py } = getPointPx();
  const currentMap = MAPS.find((m) => m.code === mapName) || MAPS[0];

  /* =====================================================
     RENDER (UI COMPLETA ORIGINAL)
  ====================================================== */
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white w-[95vw] max-w-[1500px] h-[90vh] rounded-lg shadow-xl flex flex-col">

        {/* HEADER */}
        <div className="p-4 border-b text-xl font-bold">
          Editar pórtico #{portico.id}
        </div>

        <div className="flex flex-1 overflow-hidden">

          {/* -------------------------------------------
                 PANEL IZQUIERDO COMPLETO (tu UI original)
               ------------------------------------------- */}
          <div className="w-[340px] p-4 border-r overflow-y-auto bg-gray-50">

            <label className="block text-sm font-semibold mb-1">Nombre del pórtico</label>
            <input
              className="w-full border rounded p-2 mb-4"
              value={name}
              onChange={(e) => setName(e.target.value)} />
            

            <label className="block text-sm font-semibold mb-1">Mapa</label>
            <select
              className="w-full border rounded p-2 mb-4"
              value={mapName}
              onChange={(e) => setMapName(e.target.value)}>

              {MAPS.map((m) =>
              <option key={m.code} value={m.code}>{m.label}</option>
              )}
            </select>

            <div className="mt-2 mb-4 text-xs text-gray-500">
              * Los siguientes datos son visuales (no se guardan)
            </div>

            {/* Tipo */}
            <label className="block text-sm font-semibold mb-1">Tipo</label>
            <select
              className="w-full border rounded p-2 mb-4"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}>
              
              {PORTICO_TYPES.map((t) =>
              <option key={t.id} value={t.id}>{t.name}</option>
              )}
            </select>

            {/* Site */}
            <label className="block text-sm font-semibold mb-1">Site</label>
            <select
              className="w-full border rounded p-2 mb-4"
              value={site}
              onChange={(e) => setSite(e.target.value)}>
              
              {SITES.map((s) =>
              <option key={s}>{s}</option>
              )}
            </select>

            {/* Zona */}
            <label className="block text-sm font-semibold mb-1">Zona</label>
            <select
              className="w-full border rounded p-2 mb-4"
              value={zone}
              onChange={(e) => setZone(e.target.value)}>
              
              {ZONES.map((z) =>
              <option key={z}>{z}</option>
              )}
            </select>

            {/* Color */}
            <label className="block text-sm font-semibold mb-1">Color</label>
            <select
              className="w-full border rounded p-2 mb-4"
              value={color}
              onChange={(e) => setColor(e.target.value)}>
              
              {COLORS.map((c) =>
              <option key={c} value={c}>{c}</option>
              )}
            </select>

            {/* Rotación */}
            <label className="block text-sm font-semibold mb-1">
              Rotación ({rotation}°)
            </label>
            <input
              type="range"
              min="0"
              max="360"
              value={rotation}
              onChange={(e) => setRotation(e.target.value)}
              className="w-full mb-4" />
            

            {/* Coordenadas */}
            <div className="p-3 bg-white border rounded shadow-sm">
              <div className="font-bold mb-1">Coordenadas (para BD):</div>
              <div>X: {xPct}</div>
              <div>Y: {yPct}</div>
            </div>
          </div>

          {/* -------------------------------------------
                 PANEL DERECHO — MAPA
               ------------------------------------------- */}
          <div className="flex-1 relative bg-gray-200 overflow-hidden">

            {/* Zoom Buttons */}
            <div className="absolute top-3 right-3 z-20 flex flex-col">
              <button onClick={zoomIn} className="bg-white p-2 border rounded shadow mb-2">+</button>
              <button onClick={zoomOut} className="bg-white p-2 border rounded shadow">−</button>
            </div>

            <div
              ref={containerRef}
              onClick={handleMapClick}
              className="w-full h-full overflow-auto relative cursor-crosshair">
              
              <img
                ref={imageRef}
                src={currentMap.image}
                alt="mapa"
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: "top left"
                }} />
              

              {/* Punto (calculado correctamente por %) */}
              <div
                style={{
                  position: "absolute",
                  left: px * scale - 10,
                  top: py * scale - 10,
                  width: 20,
                  height: 20,
                  backgroundColor: color,
                  borderRadius: "50%",
                  transform: `rotate(${rotation}deg)`
                }} />
              
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="p-4 border-t flex justify-end gap-3">
          <button className="px-4 py-2 bg-gray-300 rounded" onClick={onClose}>
            Cerrar
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={handleSave}>
            Guardar
          </button>
        </div>
      </div>
    </div>);

}
