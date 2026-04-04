import React from "react";

export default function VerdictPanel({ deal }) {
  if (!deal.verdict_details) return null;
  let verdict;
  try {
    verdict = JSON.parse(deal.verdict_details);
  } catch {
    return null;
  }

  const isApproved = verdict.conditions_met;

  return (
    <div
      style={{
        background: isApproved ? "#ecfdf5" : "#fef2f2",
        borderRadius: "12px",
        padding: "20px",
        marginTop: "16px",
        border: `1px solid ${isApproved ? "#10b981" : "#ef4444"}33`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isApproved ? "#10b981" : "#ef4444",
            color: "#fff",
            fontSize: "16px",
            fontWeight: 700,
          }}
        >
          {isApproved ? "\u2713" : "\u2717"}
        </div>
        <div>
          <h4 style={{ margin: 0, fontSize: "15px", color: isApproved ? "#065f46" : "#991b1b" }}>
            AI Verdict: {isApproved ? "Conditions Met" : "Conditions Not Met"}
          </h4>
          <span style={{ fontSize: "12px", color: isApproved ? "#059669" : "#dc2626" }}>Confidence: {verdict.confidence}</span>
        </div>
      </div>
      <p style={{ fontSize: "14px", lineHeight: "1.6", color: "#374151", margin: "0 0 12px 0" }}>{verdict.reasoning}</p>
      {verdict.unmet_conditions && verdict.unmet_conditions.length > 0 && (
        <div>
          <p style={{ fontSize: "12px", fontWeight: 600, color: "#991b1b", margin: "0 0 4px 0" }}>Unmet Conditions:</p>
          {verdict.unmet_conditions.map((c, i) => (
            <span key={i} style={{ display: "inline-block", padding: "2px 8px", margin: "2px 4px 2px 0", borderRadius: "4px", fontSize: "12px", background: "#fecaca", color: "#991b1b" }}>
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
