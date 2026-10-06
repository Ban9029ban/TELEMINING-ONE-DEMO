import React from "react";

const ITEMS = [
  "home",
  "tower",
  "camera",
  "target",
  "traffic",
  "chart",
  "chip",
  "settings",
  "bulb",
  "map",
];

export default function LegacyOperationalRail() {
  return (
    <aside className="legacy-rail" aria-label="Navegación operacional">
      <button className="legacy-rail__toggle" type="button" aria-label="Rail contraído">
        <span className="legacy-rail__arrow">|→</span>
      </button>

      <nav className="legacy-rail__nav">
        {ITEMS.map((key) => (
          <button
            key={key}
            type="button"
            className={`legacy-rail__item legacy-rail__item--${key}`}
            aria-label={key}
          />
        ))}
      </nav>
    </aside>
  );
}
