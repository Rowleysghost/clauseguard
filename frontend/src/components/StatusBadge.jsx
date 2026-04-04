import React from "react";
import { STATUS_CONFIG } from "../lib/constants";

export default function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.open;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 12px",
        borderRadius: "9999px",
        fontSize: "12px",
        fontWeight: 600,
        color: config.color,
        backgroundColor: config.bg,
        border: `1px solid ${config.color}22`,
      }}
    >
      {config.label}
    </span>
  );
}
