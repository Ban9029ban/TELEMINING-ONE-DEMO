import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Oculta banners/headers que estén montados fuera del MainLayout.
 * Este componente solo actúa cuando existe ?pantalla=...
 */
export default function OperationalHeaderKiller() {
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const isPantalla = params.has("pantalla");
    const selectors = [
      "header",
      ".header",
      ".app-header",
      ".navbar",
      ".topbar",
      ".top-bar",
      ".top-banner",
      ".banner",
      ".admin-banner",
      ".status-bar",
      ".env-bar",
      ".layout-header",
      ".main-header",
      ".telemining-header",
      ".dashboard-header",
    ];

    const changed = [];

    if (isPantalla) {
      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
          if (!el.closest(".legacy-card") && !el.closest(".diamante-layout")) {
            const prevDisplay = el.style.display;
            const prevVisibility = el.style.visibility;
            const prevHeight = el.style.height;
            const prevOverflow = el.style.overflow;

            el.style.display = "none";
            el.style.visibility = "hidden";
            el.style.height = "0";
            el.style.overflow = "hidden";

            changed.push([el, prevDisplay, prevVisibility, prevHeight, prevOverflow]);
          }
        });
      });

      document.body.classList.add("pantalla-mode-active");
      document.documentElement.classList.add("pantalla-mode-active");
    }

    return () => {
      changed.forEach(([el, d, v, h, o]) => {
        el.style.display = d;
        el.style.visibility = v;
        el.style.height = h;
        el.style.overflow = o;
      });
      document.body.classList.remove("pantalla-mode-active");
      document.documentElement.classList.remove("pantalla-mode-active");
    };
  }, [location.search]);

  return null;
}
