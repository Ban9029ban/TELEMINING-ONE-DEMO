import React, { useState } from "react";
import axios from "axios";
import { API_URL } from "../api-config";

const MapSelectAdmin = () => {
  const [mapaData, setMapaData] = useState({
    name: "",
    proyecto: "",
    file: null
  });
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setMapaData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    setMapaData((prev) => ({ ...prev, file: e.target.files[0] }));
  };

  const handleCreateMap = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("name", mapaData.name);
    formData.append("proyecto", mapaData.proyecto);
    formData.append("file", mapaData.file);

    try {
      const response = await axios.post(`${API_URL}/control/maps/`, formData, {
        headers: {
          "Content-Type": "multipart/form-data"
        }
      });
      setMessage(`Mapa '${response.data.mapa_id}' creado correctamente.`);
    } catch (error) {
      setMessage(`Error: ${error.response?.data?.message || error.message}`);
    }
  };

  return (
    <div className="bg-white w-3/4 dark:bg-gray-800 p-6 rounded-lg shadow-md mb-4">
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-6 text-center">
        Administrar Mapas
      </h2>

      <form className="space-y-6 ">
        {/* Campo Nombre del Mapa */}
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            
            Nombre del Mapa
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={mapaData.name}
            onChange={handleChange}
            className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300"
            placeholder="Ejemplo: Zona Diamante" />
          
        </div>

        {/* Campo Proyecto */}
        <div>
          <label
            htmlFor="proyecto"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            
            Proyecto
          </label>
          <input
            type="text"
            id="proyecto"
            name="proyecto"
            value={mapaData.proyecto}
            onChange={handleChange}
            className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300"
            placeholder="Ejemplo: Proyecto Alfa" />
          
        </div>

        {/* Campo Archivo del Mapa */}
        <div>
          <label
            htmlFor="file"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            
            Archivo del Mapa
          </label>
          <input
            type="file"
            id="file"
            name="file"
            onChange={handleFileChange}
            className="mt-1 block w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 cursor-pointer dark:text-gray-400 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400" />
          
        </div>

        {/* Botón de Crear Mapa */}
        <div className="flex justify-end">
          <button
            onClick={handleCreateMap}
            className="w-48 inline-flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition duration-200">
            
            Crear Mapa
          </button>
        </div>
      </form>

      {/* Mensaje de Estado */}
      {message &&
      <p
        className={`mt-4 text-sm ${
        message.includes("Error")  "text-red-600" : "text-green-600"} dark:text-green-400 text-center`
        }>
        
          {message}
        </p>
      }
    </div>);

};

export default MapSelectAdmin;