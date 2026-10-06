import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { setEstado } from "../services/api";
import MapaDiamanteReal from "../components/MapaDiamanteReal";
import OperationalHeaderKiller from "../components/OperationalHeaderKiller";
import "../styles/dashboard.css";

export default function Diamante() {
  const [data, setData] = useState({});
  const location = useLocation();

  const isPantalla = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.has("pantalla");
  }, [location.search]);

  const load = async () => {
    const res = await fetch("/api/semaforos/estado");
    const json = await res.json();

    const parsed = {};
    Object.keys(json).forEach((k) => {
      const raw = String(json[k] ?? "");
      const match = raw.match(/=(\d)/);
      parsed[k] = match ? parseInt(match[1], 10) : 0;
    });

    setData(parsed);
  };

  useEffect(() => {
    load();
    const intervalId = setInterval(load, 2000);
    return () => clearInterval(intervalId);
  }, []);

  const estadoResumen = useMemo(() => {
    if (data.M0 === 1) return "EMERGENCIA";
    if (data.M2 === 1 || data.M4 === 1 || data.M6 === 1 || data.M7 === 1 || data.M9 === 1) return "ALERTA";
    return "NORMAL";
  }, [data]);

  return (
    <>
      {isPantalla && <OperationalHeaderKiller />}

      <section className={`diamante-layout ${isPantalla ? "diamante-layout--pantalla" : ""}`}>
        <div className="diamante-layout__left">
          <article className="legacy-card legacy-card--hero">
            <header className="legacy-card__header">
              <h2>Proyecto Diamante</h2>
            </header>
            <div className="legacy-card__body legacy-card__body--hero">
              <div className="diamante-hero">
                <img
                  src="/src/assets/logo_diamante.png"
                  alt="Proyecto Diamante"
                  className="diamante-logo"
                />
                <div className="diamante-title">
                  <div className="diamante-title__main">DIAMANTE</div>
                  <span className="diamante-title__sub">CARTERA DE PROYECTOS</span>
                  <strong className="diamante-title__strong">TENIENTE</strong>
                </div>
              </div>
            </div>
          </article>

          <article className="legacy-card legacy-card--controls">
            <header className="legacy-card__header">
              <h2>Polígonos Sismicidad — Diamante</h2>
            </header>

            <div className="legacy-card__body">
              <div className="legacy-panel-title">POLÍGONOS SISMICIDAD</div>

              <div className="polygon-row">
                <div className="polygon-row__label">Diamante PIPA</div>
                <div className="polygon-row__actions polygon-row__actions--two">
                  <button
                    className={`state-pill ${data.M1 === 1 ? "is-active is-normal" : ""}`}
                    onClick={() => setEstado("NORMAL")}
                  >
                    NORMAL
                  </button>
                  <button
                    className={`state-pill ${data.M2 === 1 ? "is-active is-alerta" : ""}`}
                    onClick={() => setEstado("ALERTA")}
                  >
                    ALERTA
                  </button>
                </div>
              </div>

              <div className="polygon-row">
                <div className="polygon-row__label">FootPrint HW</div>
                <div className="polygon-row__actions polygon-row__actions--two">
                  <button
                    className={`state-pill ${data.M5 === 1 ? "is-active is-normal" : ""}`}
                    onClick={() => setEstado("NORMAL")}
                  >
                    NORMAL
                  </button>
                  <button
                    className={`state-pill ${data.M6 === 1 ? "is-active is-alerta" : ""}`}
                    onClick={() => setEstado("ALERTA")}
                  >
                    ALERTA
                  </button>
                </div>
              </div>

              <div className="polygon-row">
                <div className="polygon-row__label">FootPrint FW</div>
                <div className="polygon-row__actions polygon-row__actions--two">
                  <button
                    className={`state-pill ${data.M3 === 1 ? "is-active is-normal" : ""}`}
                    onClick={() => setEstado("NORMAL")}
                  >
                    NORMAL
                  </button>
                  <button
                    className={`state-pill ${data.M4 === 1 ? "is-active is-alerta" : ""}`}
                    onClick={() => setEstado("ALERTA")}
                  >
                    ALERTA
                  </button>
                </div>
              </div>

              <div className="polygon-row">
                <div className="polygon-row__label">Bajo Diamante Esmeralda</div>
                <div className="polygon-row__actions polygon-row__actions--three">
                  <button
                    className={`state-pill ${data.M7 === 1 ? "is-active is-alerta" : ""}`}
                    onClick={() => setEstado("ALERTA")}
                  >
                    INFERIOR
                  </button>
                  <button
                    className={`state-pill ${data.M8 === 1 ? "is-active is-normal" : ""}`}
                    onClick={() => setEstado("NORMAL")}
                  >
                    CENTRO
                  </button>
                  <button
                    className={`state-pill ${data.M9 === 1 ? "is-active is-alerta" : ""}`}
                    onClick={() => setEstado("ALERTA")}
                  >
                    SUPERIOR
                  </button>
                </div>
              </div>
            </div>
          </article>
        </div>

        <div className="diamante-layout__right">
          <article className="legacy-card legacy-card--map">
            <header className="legacy-card__header legacy-card__header--map">
              <h2>Mapa — Visualización</h2>
              <div className="legacy-map-toolbar">
                <button type="button">+</button>
                <button type="button">−</button>
                <button type="button">⟳</button>
                <button type="button">◻</button>
              </div>
            </header>

            <div className="legacy-card__body legacy-card__body--map">
              <MapaDiamanteReal data={data} />
              <div className="legacy-last-register">Último registro:</div>
            </div>
          </article>
        </div>

        <div className="diamante-floating-status">
          <span className={`status-chip status-chip--${estadoResumen.toLowerCase()}`}>
            {estadoResumen}
          </span>
        </div>
      </section>
    </>
  );
}
