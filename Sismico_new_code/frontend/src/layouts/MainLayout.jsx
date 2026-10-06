import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import "../styles/dashboard.css";
import LegacyOperationalRail from "../components/LegacyOperationalRail";

export default function MainLayout({ children, Sidebar, Header }) {
  const location = useLocation();

  const isPantalla = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.has("pantalla");
  }, [location.search]);

  return (
    <div className={`app-shell ${isPantalla ? "app-shell--pantalla" : ""}`}>
      {isPantalla ? <LegacyOperationalRail /> : (Sidebar ? <Sidebar /> : null)}

      <div className="app-shell__body">
        {!isPantalla && (Header ? <Header /> : null)}
        <main className="app-shell__content">
          {children}
        </main>
      </div>
    </div>
  );
}
