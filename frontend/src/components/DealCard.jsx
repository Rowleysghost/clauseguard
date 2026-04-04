import React from "react";
import StatusBadge from "./StatusBadge";

export default function DealCard({ deal, onClick }) {
  const evidence = JSON.parse(deal.evidence || "[]");
  return (
    <div
      onClick={onClick}
      style={{
        background: "#fff",
        borderRadius: "12px",
        padding: "20px",
        border: "1px solid #e5e7eb",
        cursor: "pointer",
        transition: "all 0.15s ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#3b82f6";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(59,130,246,0.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#e5e7eb";
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
        <span style={{ fontSize: "13px", color: "#6b7280", fontWeight: 500 }}>Deal #{deal.id}</span>
        <StatusBadge status={deal.status} />
      </div>
      <p
        style={{
          fontSize: "14px",
          lineHeight: "1.5",
          color: "#1f2937",
          margin: "0 0 12px 0",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {deal.terms}
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "16px", fontWeight: 700, color: "#111827" }}>{deal.price_description}</span>
        <span style={{ fontSize: "12px", color: "#9ca3af" }}>
          {evidence.length} evidence{evidence.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "8px" }}>{deal.deadline_description}</div>
    </div>
  );
}
