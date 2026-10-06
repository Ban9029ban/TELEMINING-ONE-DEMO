import React, { useState, useEffect } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import Footer from "./Footer";
import FloatingMCPChat from "./MCP/FloatingMCPChat";
import { Outlet } from "react-router-dom";

const Layout = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem("isSidebarCollapsed");
    return stored === "true";
  });

  useEffect(() => {
    localStorage.setItem("isSidebarCollapsed", isSidebarCollapsed);
  }, [isSidebarCollapsed]);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const toggleSidebar = () => setIsSidebarCollapsed((prev) => !prev);

  return (
    <div className="min-h-screen">
      <button
        type="button"
        aria-label="Cerrar menú lateral"
        onClick={() => setIsMobileSidebarOpen(false)}
        className={`fixed inset-0 z-30 bg-slate-950/45 backdrop-blur-sm transition lg:hidden ${
        isMobileSidebarOpen ?
        "pointer-events-auto opacity-100" :
        "pointer-events-none opacity-0"}`
        } />


      <Sidebar
        isCollapsed={isSidebarCollapsed}
        toggleSidebar={toggleSidebar}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)} />


      <div
        className={`transition-[padding] duration-300 ${
        isSidebarCollapsed ?
        "lg:pl-[78px]" :
        "lg:pl-[170px] xl:pl-[176px]"}`
        }>

        <div
          className="mx-auto min-h-screen w-full px-3 pb-4 pt-3 sm:px-4 lg:px-5 xl:px-6"
          style={{ maxWidth: "100vw" }}>

          <Topbar onOpenSidebar={() => setIsMobileSidebarOpen(true)} />
          <main className="mt-3 min-h-[calc(100vh-138px)]">
            <Outlet />
          </main>
          <Footer />
        </div>
      </div>

      <FloatingMCPChat />
    </div>);

};

export default Layout;