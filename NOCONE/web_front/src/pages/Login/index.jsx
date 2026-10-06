import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { BsBoxArrowInRight, BsKey, BsPerson } from "react-icons/bs";

import { API_URL } from "../../api-config";
import {
  getFirstAccessiblePath,
  syncStoredUserPermissions,
} from "../../utils/accessControl";
import telemininLogo from "../../images/teleminin.png";
import "./login.css";

const Login = () => {
  const [formData, setFormData] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const form = new URLSearchParams();
      form.append("username", formData.username);
      form.append("password", formData.password);

      const response = await axios.post(`${API_URL}/auth/token`, form, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300 && response.data?.access_token) {
        localStorage.setItem("token", response.data.access_token);

        if (response.data?.username) {
          localStorage.setItem("username", response.data.username);
        }
        if (response.data?.full_name) {
          localStorage.setItem("full_name", response.data.full_name);
        }
        const roleName = response.data?.roles?.[0]?.name || response.data?.role || "User";
        localStorage.setItem("role_name", roleName);
        const permissions = await syncStoredUserPermissions();
        const nextPath = getFirstAccessiblePath({
          permissions,
          roles: [roleName],
        });
        window.dispatchEvent(new Event("auth-updated"));
        navigate(nextPath || "/sin-modulos", { replace: true });
        return;
      }

      const detail =
        response.data?.detail ||
        (Array.isArray(response.data) && response.data[0]?.msg) ||
        `HTTP ${response.status}`;
      setError(`No se pudo iniciar sesión: ${detail}`);
    } catch (err) {
      console.error("Error al iniciar sesión:", err);
      setError("No fue posible conectar con el API. Verifica backend, proxy y red.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tm-login-page">
      <div className="tm-login-background" />

      <section className="tm-login-card">
        <div className="tm-login-brand">
          <img src={telemininLogo} alt="Telemining" />
          <span>TM One</span>
        </div>

        <div className="tm-login-copy">
          <h1>Acceso TM One</h1>
          <p>Ingresa con tu usuario y contraseña para entrar al centro operacional.</p>
        </div>

        {error ? <div className="tm-login-alert">{error}</div> : null}

        <form className="tm-login-form" onSubmit={handleSubmit}>
          <label className="tm-login-field">
            <span>Usuario</span>
            <div className="tm-login-input-wrap">
              <BsPerson />
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                placeholder="Nombre de usuario"
                autoComplete="username"
                required
              />
            </div>
          </label>

          <label className="tm-login-field">
            <span>Contraseña</span>
            <div className="tm-login-input-wrap">
              <BsKey />
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Contraseña"
                autoComplete="current-password"
                required
              />
            </div>
          </label>

          <button type="submit" className="tm-login-submit" disabled={loading}>
            <BsBoxArrowInRight />
            {loading ? "Ingresando..." : "Login"}
          </button>
        </form>

        <div className="tm-login-footer">
          <span>Acceso seguro para monitoreo, analítica y agentes IA en TM One.</span>
        </div>
      </section>
    </div>
  );
};

export default Login;
