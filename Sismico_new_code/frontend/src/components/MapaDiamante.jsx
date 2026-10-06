
import React from "react";

const getColor = (verde, rojo) => {
  if (rojo === 1) return "rgba(255,0,0,0.5)";
  if (verde === 1) return "rgba(0,255,0,0.5)";
  return "rgba(200,200,200,0.2)";
};

export default function MapaDiamante({ data }) {
  return (
    <svg viewBox="0 0 1000 600" style={{ width: "100%", height: "100%" }}>

      <polygon points="100,200 200,150 250,250 150,300"
        fill={getColor(data.M1, data.M2)} />

      <polygon points="300,100 600,100 650,250 350,250"
        fill={getColor(data.M3, data.M4)} />

      <polygon points="300,300 600,300 650,450 350,450"
        fill={getColor(data.M5, data.M6)} />

      <polygon points="700,200 900,200 900,400 700,400"
        fill={getColor(data.M8, data.M7 || data.M9)} />

    </svg>
  );
}
