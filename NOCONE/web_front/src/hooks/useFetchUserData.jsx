import { useState, useEffect } from "react";
import { API_URL } from "../api-config";
import { handleAuthError } from "./ValidateToken";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const normalizeRoles = (payloadRole, payloadRoles) => {
  if (Array.isArray(payloadRoles) && payloadRoles.length) {
    return payloadRoles.map((role) => {
      const name = role?.name || role?.role || String(role || "");
      return { name };
    });
  }

  const raw = String(payloadRole || localStorage.getItem("role_name") || "Admin");
  const normalized = raw.toLowerCase() === "admin" || raw.toLowerCase() === "administrador" ?
  "Admin" :
  raw;
  return [{ name: normalized }];
};

const useFetchUserData = () => {
  const [userData, setUserData] = useState({
    user: localStorage.getItem("full_name") || localStorage.getItem("username") || null,
    user_id: null,
    roles: normalizeRoles(localStorage.getItem("role_name"), null),
    loading: true,
    error: null
  });
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const response = await axios.get(`${API_URL}/auth/me`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        const data = response.data;
        const roles = normalizeRoles(data.role, data.roles);

        if (data.full_name) localStorage.setItem("full_name", data.full_name);
        if (data.username) localStorage.setItem("username", data.username);
        if (roles[0]?.name) localStorage.setItem("role_name", roles[0].name);

        setUserData({
          user: data.full_name || data.username || localStorage.getItem("username"),
          user_id: data.user_id || null,
          roles,
          loading: false,
          error: null
        });
      } catch (error) {
        setUserData((prevState) => ({
          ...prevState,
          loading: false,
          error: error.response?.data?.detail || error.message
        }));
        handleAuthError(error, navigate);
      }
    };

    fetchUserData();
  }, [navigate]);

  return userData;
};

export default useFetchUserData;