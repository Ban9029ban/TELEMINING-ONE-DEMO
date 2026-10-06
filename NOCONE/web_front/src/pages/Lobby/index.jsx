import React, { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { FaCube } from "react-icons/fa";

import Sidebar from "../../components/SidebarDET";
import ThreeDViewer from "../../components/Model";
import "../../styles/css/lobby.css";

const Lobby = () => {
  const [selectedZone, setSelectedZone] = useState(null);

  return (
    <div className="flex h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe_0%,#eef2ff_24%,#f8fafc_52%,#e2e8f0_100%)]">
      <aside className="w-64 p-0">
        <Sidebar onZoneClick={setSelectedZone} />
      </aside>

      <main className="relative flex-1 overflow-auto p-6">
        <button
          onClick={() => {
            window.location.href = "/";
          }}
          className="absolute right-6 top-6 rounded-2xl border border-transparent bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(79,70,229,0.24)] transition hover:translate-y-[-1px]">
          
          Volver
        </button>

        <header className="mb-6 overflow-hidden rounded-[32px] border border-white/70 bg-white/92 px-6 py-6 shadow-[0_24px_50px_rgba(15,23,42,0.08)]">
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
            <FaCube />
            Vista 3D
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
            Centro de rastreo TMOne
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Supervisa la ubicación y el estado de los dispositivos TMOne en tiempo real con una experiencia 3D más limpia, moderna y coherente con el resto del sistema.
          </p>
        </header>

        <div className="overflow-hidden rounded-[34px] border border-white/70 bg-white/92 p-4 shadow-[0_28px_55px_rgba(15,23,42,0.1)]">
          <div id="threeCanvas" className="h-[600px] w-full overflow-hidden rounded-[26px] border border-slate-200/80 bg-slate-100/90">
            <Canvas camera={{ position: [180, 50, 42], fov: 50 }}>
              <ThreeDViewer selectedZone={selectedZone} />
            </Canvas>
          </div>
        </div>
      </main>
    </div>);

};

export default Lobby;