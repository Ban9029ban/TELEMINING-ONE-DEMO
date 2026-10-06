import React from "react";
import plano from "../assets/diamante.png";

const getColor = (verde, rojo) => {
  if (rojo === 1) return "rgba(235, 73, 73, 0.50)";
  if (verde === 1) return "rgba(114, 227, 122, 0.58)";
  return "transparent";
};

export default function MapaDiamanteReal({ data = {} }) {
  return (
    <div className="diamante-real-map">
      <img src={plano} alt="Plano Diamante" className="diamante-real-map__image" />

      <div
        className="diamante-real-map__overlay diamante-real-map__overlay--pipa"
        style={{ background: getColor(data.M1, data.M2) }}
        title="Diamante PIPA"
      />
      <div
        className="diamante-real-map__overlay diamante-real-map__overlay--hw"
        style={{ background: getColor(data.M5, data.M6) }}
        title="FootPrint HW"
      />
      <div
        className="diamante-real-map__overlay diamante-real-map__overlay--fw"
        style={{ background: getColor(data.M3, data.M4) }}
        title="FootPrint FW"
      />
      <div
        className="diamante-real-map__overlay diamante-real-map__overlay--bajo"
        style={{ background: getColor(data.M8, data.M7 || data.M9) }}
        title="Bajo Diamante Esmeralda"
      />
    </div>
  );
}
