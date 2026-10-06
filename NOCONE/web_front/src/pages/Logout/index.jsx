import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Logout() {
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("full_name");
    localStorage.removeItem("role_name");
    localStorage.removeItem("tm_user_permissions");
    localStorage.removeItem("production_allowed_roles");
    window.dispatchEvent(new Event("auth-updated"));
    navigate("/login", { replace: true });
  }, [navigate]);

  return null;
}