import React, { useState, useEffect } from "react";
import axios from "axios";
import { API_URL } from "../api-config";

const MapShowAdmin = () => {
  const [mapas, setMapas] = useState([]);

  useEffect(() => {
    const fetchMapas = async () => {
      try {
        const response = await axios.get(`${API_URL}/control/maps/`);
        setMapas(response.data);
      } catch (error) {
        console.error("Error:", error);
      }
    };
    fetchMapas();
  }, []);

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md w-3/4">
      <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-4">
        Mapas Disponibles
      </h2>
      <ul className="space-y-2">
        {mapas.length > 0 ?
        mapas.map((mapa) =>
        <li
          key={mapa.id}
          className="flex flex-col justify-between items-center px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-md">
          
              <span className="text-gray-800 dark:text-gray-300">{mapa.name}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {mapa.proyecto}
              </span>
              <img
            src={`${API_URL}/control/maps/image/${mapa.proyecto}/${mapa.name}`}
            alt={`Mapa ${mapa.name}`}
            className="mt-2 max-w-full h-auto rounded-md" />
          
            </li>
        ) :

        <p className="text-gray-500 dark:text-gray-400">No hay mapas disponibles.</p>
        }
      </ul>
    </div>);

};

export default MapShowAdmin;