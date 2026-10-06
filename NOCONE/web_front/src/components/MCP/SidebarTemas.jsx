import React, { useMemo, useState } from "react";
import faqConfig from "../../config/mcpFaq.json";

const SidebarTemas = ({ onPreguntaSeleccionada }) => {
  const groups = useMemo(() => faqConfig.groups || [], []);
  const [activeGroup, setActiveGroup] = useState(groups[0]?.id || "");

  const currentGroup =
    groups.find((group) => group.id === activeGroup) || groups[0] || null;

  if (!currentGroup) {
    return null;
  }

  return (
    <div className="mcp-faq-shell">
      <div className="mcp-faq-tabs">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`mcp-faq-tab ${
              group.id === currentGroup.id ? "is-active" : ""
            }`}
            onClick={() => setActiveGroup(group.id)}
          >
            {group.label}
          </button>
        ))}
      </div>

      <div className="mcp-faq-copy">
        <h4>{currentGroup.label}</h4>
        <p>{currentGroup.hint}</p>
      </div>

      <div className="mcp-faq-list">
        {(currentGroup.items || []).map((item) => (
          <button
            key={item.id || item.text}
            type="button"
            className="mcp-faq-card"
            onClick={() => onPreguntaSeleccionada(item)}
            title={item.text}
          >
            <span className="mcp-faq-card-title">{item.text}</span>
            {item.description ? (
              <span className="mcp-faq-card-description">{item.description}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SidebarTemas;
