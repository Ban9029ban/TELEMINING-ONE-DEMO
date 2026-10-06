import React, { useState, useEffect } from "react";
import MapSelectAdmin from "../../components/MapSelectAdmin";
import MapShowAdmin from "../../components/MapShowAdmin";
import UserForm from "../../components/UserForm.jsx";
import UserList from "../../components/UserList.jsx";

const AdminPanel = () => {
  const [isSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem("isSidebarCollapsed");
    return stored === "true";
  });

  useEffect(() => {
    localStorage.setItem("isSidebarCollapsed", isSidebarCollapsed);
  }, [isSidebarCollapsed]);

  return (
    <div className="flex">

      {/* Contenido Principal */}
      <div
        className={`transition-all duration-300 flex-1 dark:bg-[#0c0c0c] ${
        isSidebarCollapsed  "ml-20" : "ml-48"}`
        }>
        
        <div className="p-4 bg-white dark:bg-[#0c0c0c] min-h-[calc(100vh-64px)]">
          <MapSelectAdmin />
          <MapShowAdmin />
          <div className="my-6" />
          <UserForm />
          <UserList />
        </div>
      </div>
    </div>);

};

export default AdminPanel;