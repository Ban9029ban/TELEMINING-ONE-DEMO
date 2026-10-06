import { useEffect, useState } from "react";
import { API_URL } from "../api-config";

// Configuración de datos falsos
const TEMPERATURA_MEDIA = 22;
const TEMPERATURA_VARIANZA = 3;
const HUMEDAD_MEDIA = 50;
const HUMEDAD_VARIANZA = 10;
const CO2_MEDIA = 450;
const CO2_VARIANZA = 150;

const randomGaussian = (mean, stdDev) => {
  let u = 0,v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

const generateFakeSensorData = () => ({
  1: [randomGaussian(TEMPERATURA_MEDIA, TEMPERATURA_VARIANZA), "°C"],
  2: [randomGaussian(HUMEDAD_MEDIA, HUMEDAD_VARIANZA), "rH"],
  4: [randomGaussian(CO2_MEDIA, CO2_VARIANZA), "ppm"]
});

// Devuelven: 'danger', 'warning', 'precaution', 'ok'
const checkTemperature = (temperature) => {
  const temp = parseFloat(temperature);
  if (isNaN(temp)) return "NAN";
  if (temp <= 5 || temp >= 30) return "danger";
  if (temp > 5 && temp <= 10 || temp >= 26 && temp < 30) return "warning";
  if (temp > 10 && temp < 15 || temp >= 22 && temp < 26) return "precaution";
  return "ok";
};

const checkHumidity = (humidity) => {
  const hum = parseFloat(humidity);
  if (isNaN(hum)) return "NAN";
  if (hum <= 20 || hum >= 85) return "danger";
  if (hum > 20 && hum <= 30 || hum >= 70 && hum < 85) return "warning";
  if (hum > 30 && hum < 40 || hum >= 60 && hum < 70) return "precaution";
  return "ok";
};

const checkCO2 = (co2) => {
  const value = parseFloat(co2);
  if (isNaN(value)) return "NAN";
  if (value >= 800) return "danger";
  if (value > 600 && value < 800) return "warning";
  if (value > 500 && value <= 600) return "precaution";
  return "ok";
};

export const useMapLogic = (selectedMap) => {
  const [points, setPoints] = useState([]);
  const [pointsMap, setPointsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // --- Cargar puntos desde API ---
  useEffect(() => {
    if (!selectedMap) return;

    const fetchInitialPoints = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_URL}/control/maps/get-puntos/${selectedMap}`);
        if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("La respuesta del servidor no es un array");

        const map = {};
        const formatted = data.map((point) => {
          const formattedPoint = {
            ...point,
            visualState: 'bg-off'
          };
          map[point.device] = formattedPoint;
          return formattedPoint;
        });

        setPoints(formatted);
        setPointsMap(map);
        setError(null);
      } catch (err) {
        console.error("[API] Error al obtener puntos:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchInitialPoints();
  }, [selectedMap]);

  // --- Simulación periódica de DataLogs (solo para sensores) ---
  useEffect(() => {
    const interval = setInterval(() => {
      setPointsMap((prevMap) => {
        const newMap = { ...prevMap };

        for (const [deviceId, point] of Object.entries(prevMap)) {
          if (!point.sensor) continue;

          const sensors = generateFakeSensorData();
          let visualState = "bg-success";
          let hasDanger = false;
          let hasWarning = false;
          let hasPrecaution = false;

          Object.entries(sensors).forEach(([sensorId, [value]]) => {
            const status =
            sensorId === '1'  checkTemperature(value) :
            sensorId === '2'  checkHumidity(value) :
            checkCO2(value);

            if (status === "danger") hasDanger = true;else
            if (status === "warning") hasWarning = true;else
            if (status === "precaution") hasPrecaution = true;
          });

          if (hasDanger) visualState = "bg-danger";else
          if (hasWarning) visualState = "bg-warning";else
          if (hasPrecaution) visualState = "bg-yellow";else
          visualState = "bg-success";

          newMap[deviceId] = {
            ...point,
            sensorData: sensors,
            visualState,
            lastSensorUpdate: new Date().toISOString()
          };
        }

        setPoints(Object.values(newMap));
        return newMap;
      });
    }, 1000); // Cada 4 segundos

    return () => clearInterval(interval);
  }, []);

  return {
    points,
    loading,
    error
  };
};