import React from "react";
import { STATUS_CONFIG, STATUS_FLOW } from "../lib/constants";
import StatusBadge from "./StatusBadge";

export default function StatusTimeline({ currentStatus }) {
  const currentIdx = STATUS_FLOW.indexOf(currentStatus);
  const isTerminal = ["rejected", "refunded", "disputed", "cancelled"].includes(currentStatus);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "16px 0" }}>
      {STATUS_FLOW.map((step, i) => {
        const isActive = i <= currentIdx && !isTerminal;
        const isCurrent = step === currentStatus;
        const conf = STATUS_CONFIG[step];
        return (
          <div key={step} style={{ display: "flex", alignItems: "center", gap: "4px", flex: 1 }}>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
                fontWeight: 700,
                backgroundColor: isActive ? conf.color : "#e5e7eb",
                color: isActive ? "#fff" : "#9ca3af",
                border: isCurrent ? `2px solid ${conf.color}` : "2px solid transparent",
                boxShadow: isCurrent ? `0 0 0 3px ${conf.color}33` : "none",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </div>
            {i < STATUS_FLOW.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: "2px",
                  backgroundColor: i < currentIdx && !isTerminal ? conf.color : "#e5e7eb",
                }}
              />
            )}
          </div>
        );
      })}
      {isTerminal && (
        <div style={{ marginLeft: "8px" }}>
          <StatusBadge status={currentStatus} />
        </div>
      )}
    </div>
  );
}
