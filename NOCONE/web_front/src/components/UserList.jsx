import React, { useEffect, useState } from "react";
import axios from "axios";

import { API_URL } from "../api-config";

const UserList = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await axios.get(`${API_URL}/users/`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`
          }
        });
        setUsers(response.data);
      } catch (requestError) {
        setError(requestError.response?.data?.detail || "Error al obtener usuarios");
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  if (loading) return <p className="text-gray-500">Cargando usuarios...</p>;

  if (error) {
    return (
      <p className="text-red-500 dark:text-red-400">
        Error: {error}
      </p>);

  }

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-4">
      <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-4">
        Lista de usuarios
      </h2>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white dark:bg-gray-700">
          <thead>
            <tr>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">ID</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Usuario</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Nombre completo</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Rol</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Activo</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) =>
            <tr key={user.id} className="border-t border-gray-300 dark:border-gray-600">
                <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{user.id}</td>
                <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{user.username}</td>
                <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{user.full_name || "-"}</td>
                <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{user.role || "-"}</td>
                <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{user.is_active  "Si" : "No"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>);

};

export default UserList;