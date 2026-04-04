import React, { useState } from "react";
import { EVIDENCE_TYPES } from "../lib/constants";

const inputStyle = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: "8px",
  border: "1px solid #d1d5db",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export default function EvidencePanel({ deal, onSubmit }) {
  const [evidenceType, setEvidenceType] = useState("delivery_proof");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const evidence = JSON.parse(deal.evidence || "[]");
  const canSubmit = deal.status === "funded" || deal.status === "evidence_submitted";

  return (
    <div style={{ background: "#f9fafb", borderRadius: "12px", padding: "20px", marginTop: "16px" }}>
      <h4 style={{ margin: "0 0 16px 0", fontSize: "15px", color: "#111827" }}>Evidence ({evidence.length})</h4>

      {evidence.map((e, i) => (
        <div key={i} style={{ background: "#fff", borderRadius: "8px", padding: "12px", marginBottom: "8px", border: "1px solid #e5e7eb" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#3b82f6", textTransform: "uppercase" }}>
              {EVIDENCE_TYPES.find((t) => t.value === e.type)?.label || e.type}
            </span>
            <span style={{ fontSize: "11px", color: "#9ca3af" }}>by {e.submitted_by === deal.seller ? "Seller" : "Buyer"}</span>
          </div>
          <p style={{ fontSize: "13px", color: "#374151", margin: "4px 0" }}>{e.description}</p>
          <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "#3b82f6", textDecoration: "none" }}>
            {e.url}
          </a>
        </div>
      ))}

      {canSubmit && (
        <div style={{ marginTop: "16px", padding: "16px", background: "#fff", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
          <p style={{ fontSize: "13px", fontWeight: 600, color: "#374151", margin: "0 0 12px 0" }}>Submit New Evidence</p>
          <div style={{ display: "grid", gap: "10px" }}>
            <select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)} style={inputStyle}>
              {EVIDENCE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Evidence URL" style={inputStyle} />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this evidence proves..."
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <button
              onClick={() => {
                onSubmit({ type: evidenceType, url, description });
                setUrl("");
                setDescription("");
              }}
              disabled={!url || !description}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "none",
                background: !url || !description ? "#d1d5db" : "#8b5cf6",
                color: "#fff",
                cursor: !url || !description ? "default" : "pointer",
                fontSize: "13px",
                fontWeight: 600,
                justifySelf: "start",
              }}
            >
              Submit Evidence
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
