import React, { useState } from "react";
import axios from "axios";

import { API_URL } from "../api-config";
import useFetchUserData from "../hooks/useFetchUserData";

const INITIAL_FORM = {
  username: "",
  full_name: "",
  password: "",
  role: "user",
  is_active: true
};

const UserForm = () => {
  const { roles, loading, error } = useFetchUserData();
  const isAdmin = roles.some((role) => role.name === "Admin");
  const [userData, setUserData] = useState(INITIAL_FORM);
  const [message, setMessage] = useState("");

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setUserData((prev) => ({
      ...prev,
      [name]: type === "checkbox"  checked : value
    }));
  };

  const handleCreateUser = async (event) => {
    event.preventDefault();
    setMessage("");

    try {
      const response = await axios.post(`${API_URL}/users/`, userData, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`
        }
      });
      setMessage(`Usuario '${response.data.username}' creado correctamente.`);
      setUserData(INITIAL_FORM);
    } catch (requestError) {
      setMessage(`Error: ${requestError.response?.data?.detail || requestError.message}`);
    }
  };

  if (loading) return <p className="text-gray-500 text-center">Cargando datos del usuario...</p>;

  if (error) {
    return (
      <p className="text-red-500 dark:text-red-400 text-center">
        Error al cargar datos del usuario: {error}
      </p>);

  }

  if (!isAdmin) {
    return (
      <p className="text-red-500 dark:text-red-400 text-center">
        No tienes permiso para crear nuevos usuarios.
      </p>);

  }

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-4 w-3/4">
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-6 text-center">
        Crear nuevo usuario
      </h2>
      <form onSubmit={handleCreateUser} className="space-y-6">
        <div>
          <label
            htmlFor="username"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300">

            Nombre de usuario
          </label>
          <input
            type="text"
            id="username"
            name="username"
            value={userData.username}
            onChange={handleChange}
            required
            placeholder="Ejemplo: juan123"
            className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300" />

        </div>

        <div>
          <label
            htmlFor="full_name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300">

            Nombre completo
          </label>
          <input
            type="text"
            id="full_name"
            name="full_name"
            value={userData.full_name}
            onChange={handleChange}
            placeholder="Ejemplo: Juan Pérez"
            className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300" />

        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300">

            Contraseña
          </label>
          <input
            type="password"
            id="password"
            name="password"
            value={userData.password}
            onChange={handleChange}
            required
            placeholder="********"
            className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300" />

        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label
              htmlFor="role"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300">

              Rol
            </label>
            <select
              id="role"
              name="role"
              value={userData.role}
              onChange={handleChange}
              className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300">

              <option value="user">Usuario</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <label className="flex items-center gap-3 pt-8 text-sm font-medium text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              name="is_active"
              checked={userData.is_active}
              onChange={handleChange} />

            Usuario activo
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="w-48 inline-flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-500 hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300 transition duration-200">

            Crear usuario
          </button>
        </div>
      </form>

      {message ?
      <p
        className={`mt-4 text-sm ${
        message.includes("Error")  "text-red-600" : "text-green-600"} dark:text-green-400 text-center`
        }>

          {message}
        </p> :
      null}
    </div>);

};

export default UserForm;