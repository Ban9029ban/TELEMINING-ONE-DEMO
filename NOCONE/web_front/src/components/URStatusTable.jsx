import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../api-config";

const URStatusTable = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const rowsPerPage = 6;

  function formatDateEs(dateString) {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    if (isNaN(date)) return dateString;
    return date.toLocaleString("es-ES", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem("token");
        const response = await axios.get(
          `${API_URL}/control/visual/actualizar_variables_ur_view`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        console.log("Respuesta UR status:", response.data);

        const api = response.data;
        let formattedData = [];

        // 🔹 NUEVO FORMATO: { items: [ { ur_id, nombre, estado, sensores_online, sensores_total } ] }
        if (Array.isArray(api.items)) {
          formattedData = api.items.map((item) => {
            const shouldHaveTemperature = Math.random() < 0.5;
            const randomTemperature = shouldHaveTemperature
              ? (Math.random() * 10 + 18).toFixed(2) // 18–28 °C
              : null;

            // Como no tenemos personas/vehículos reales, usamos sensores como demo:
            const personCount = item.sensores_online ?? null;
            const vehicleCount =
              item.sensores_total != null && item.sensores_online != null
                ? Math.max(item.sensores_total - item.sensores_online, 0)
                : null;

            return {
              name: item.nombre,
              person_count: personCount,
              vehicle_count: vehicleCount,
              temperature: randomTemperature,
              last_updated: new Date().toISOString(), // demo
            };
          });
        }
        // 🔙 Formato antiguo (por compatibilidad)
        else if (api.info_UR && typeof api.info_UR === "object") {
          formattedData = Object.entries(api.info_UR).map(
            ([name, values]) => {
              const shouldHaveTemperature = Math.random() < 0.5;
              const randomTemperature = shouldHaveTemperature
                ? (Math.random() * 10 + 18).toFixed(2)
                : null;

              return {
                name,
                person_count: values[1],
                vehicle_count: values[0],
                temperature: randomTemperature,
                last_updated: values[3],
              };
            }
          );
        } else {
          console.warn("Formato de respuesta UR no reconocido, se deja arreglo vacío.");
        }

        setData(formattedData);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching UR status data:", err);
        setError("No se pudieron cargar los datos de las URs.");
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const totalPages = Math.ceil(data.length / rowsPerPage) || 1;
  const startIndex = (page - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const currentPageData = data.slice(startIndex, endIndex);

  return (
    <div className="flex-1">
      <h5 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-200">
        Estado Actual de URs
      </h5>
      {loading && (
        <div className="text-gray-700 dark:text-gray-300">Cargando datos...</div>
      )}
      {error && (
        <div className="text-red-500 dark:text-red-400">{error}</div>
      )}
      {!loading && !error && (
        <>
          <table className="w-full border-collapse border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700">
                <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left font-medium text-gray-700 dark:text-gray-200">
                  UR
                </th>
                <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left font-medium text-gray-700 dark:text-gray-200">
                  Personas
                </th>
                <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left font-medium text-gray-700 dark:text-gray-200">
                  Vehículos
                </th>
                <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left font-medium text-gray-700 dark:text-gray-200">
                  Temperatura
                </th>
                <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left font-medium text-gray-700 dark:text-gray-200">
                  Última actualización
                </th>
              </tr>
            </thead>
            <tbody>
              {currentPageData.length > 0 ? (
                currentPageData.map((ur, index) => (
                  <tr
                    key={startIndex + index}
                    className="hover:bg-gray-50 dark:hover:bg-gray-600"
                  >
                    <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-800 dark:text-gray-100">
                      {ur.name}
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-800 dark:text-gray-100">
                      {ur.person_count ?? "N/A"}
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-800 dark:text-gray-100">
                      {ur.vehicle_count ?? "N/A"}
                    </td>
                    <td
                      className={`border border-gray-300 dark:border-gray-600 px-4 py-2 ${
                        ur.temperature !== null && ur.temperature !== undefined
                          ? ur.temperature <= 21
                            ? "text-green-500 dark:text-green-400"
                            : ur.temperature > 21 && ur.temperature <= 22
                            ? "text-orange-500 dark:text-orange-400"
                            : "text-red-500 dark:text-red-400"
                          : "text-gray-800 dark:text-gray-100"
                      }`}
                    >
                      {ur.temperature ? `${ur.temperature} °C` : "N/A"}
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-800 dark:text-gray-100">
                      {formatDateEs(ur.last_updated)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="5"
                    className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-center text-gray-800 dark:text-gray-100"
                  >
                    No se encontraron URs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex justify-center mt-2 gap-2">
              <button
                className="px-2 py-1 border rounded disabled:opacity-50 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Anterior
              </button>
              <span className="px-2 py-1 text-gray-800 dark:text-gray-100">
                Página {page} de {totalPages}
              </span>
              <button
                className="px-2 py-1 border rounded disabled:opacity-50 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default URStatusTable;
