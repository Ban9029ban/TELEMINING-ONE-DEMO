import React, { Suspense, lazy, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import AccessDeniedModal from "../components/AccessDeniedModal";
import Layout from "../components/Layout";
import useUserPermissions from "../hooks/useUserPermissions";
import AgentsPage from "../pages/Agents";
import AccessPage from "../pages/Access";
import CamerasPage from "../pages/Cameras";
import NokCamarasPage from "../pages/Cameras/nok_camaras";
import VerCamaras from "../pages/Cameras/ver_camaras";
import ChartsPage from "../pages/ChartsPage";
import ConfigPage from "../pages/Config";
import Home from "../pages/Home";
import Login from "../pages/Login";
import Logout from "../pages/Logout";
import NoModules from "../pages/NoModules";
import Produccion from "../pages/Produccion";
import SemaforosVial from "../pages/SemaforosVial";
import ControlTraficoBarreras from "../pages/ControlTraficoBarreras";
import Sismico from "../pages/Sismico";
import {
  getFirstAccessiblePath,
  getRouteAccessRule,
  hasAnyPermission } from
"../utils/accessControl";

const Lobby = lazy(() => import("../pages/Lobby"));

const PrivateLayout = () => {
  const token = localStorage.getItem("token");
  return token ? <Layout /> : <Navigate to="/login" replace />;
};

const ProtectedModuleRoute = ({ path, children }) => {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(true);
  const { permissions, roles, ready } = useUserPermissions();
  const rule = getRouteAccessRule(path);
  const allowed = !rule || hasAnyPermission(rule.permissionKeys, { permissions, roles });

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Cargando permisos...
      </div>);

  }

  if (allowed) {
    return children;
  }

  const fallbackPath = getFirstAccessiblePath({ permissions, roles });

  return (
    <>
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Acceso restringido al módulo solicitado.
      </div>
      <AccessDeniedModal
        open={dialogOpen}
        resourceLabel={rule?.label || "este recurso"}
        onClose={() => {
          setDialogOpen(false);
          navigate(fallbackPath && fallbackPath !== path ? fallbackPath : "/sin-modulos", { replace: true });
        }} />
      
    </>);

};

function GeneralRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/logout" element={<Logout />} />

      <Route element={<PrivateLayout />}>
        <Route path="/sin-modulos" element={<NoModules />} />
        <Route path="/" element={<ProtectedModuleRoute path="/"><Home /></ProtectedModuleRoute>} />
        <Route path="/produccion" element={<ProtectedModuleRoute path="/produccion"><Produccion /></ProtectedModuleRoute>} />
        <Route path="/mcp" element={<ProtectedModuleRoute path="/mcp"><AgentsPage /></ProtectedModuleRoute>} />
        <Route path="/productividad" element={<ProtectedModuleRoute path="/productividad"><ChartsPage /></ProtectedModuleRoute>} />
        <Route path="/grafic" element={<Navigate to="/productividad" replace />} />
        <Route
          path="/lobby"
          element={
          <ProtectedModuleRoute path="/lobby">
              <Suspense
              fallback={
              <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
                    Cargando vista 3D...
                  </div>
              }>
              
                <Lobby />
              </Suspense>
            </ProtectedModuleRoute>
          } />
        
        <Route path="/access" element={<ProtectedModuleRoute path="/access"><AccessPage /></ProtectedModuleRoute>} />
        <Route path="/cameras" element={<ProtectedModuleRoute path="/cameras"><CamerasPage /></ProtectedModuleRoute>} />
        <Route path="/cameras/nok" element={<ProtectedModuleRoute path="/cameras/nok"><NokCamarasPage /></ProtectedModuleRoute>} />
        <Route path="/cameras/ver" element={<ProtectedModuleRoute path="/cameras/ver"><VerCamaras /></ProtectedModuleRoute>} />
        <Route path="/config" element={<ProtectedModuleRoute path="/config"><ConfigPage /></ProtectedModuleRoute>} />
        <Route path="/sismico" element={<ProtectedModuleRoute path="/sismico"><Sismico /></ProtectedModuleRoute>} />
        <Route path="/semaforos-control-vial" element={<ProtectedModuleRoute path="/semaforos-control-vial"><SemaforosVial /></ProtectedModuleRoute>} />
        <Route path="/control-trafico-barreras" element={<ProtectedModuleRoute path="/control-trafico-barreras"><ControlTraficoBarreras /></ProtectedModuleRoute>} />
      </Route>
    </Routes>);

}

export default GeneralRoutes;
