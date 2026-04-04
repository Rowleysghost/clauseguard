import React, { useState } from "react";

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

const labelStyle = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: "#374151",
  marginBottom: "6px",
};

export default function CreateDealForm({ onSubmit, onCancel }) {
  const [terms, setTerms] = useState("");
  const [price, setPrice] = useState("");
  const [deadline, setDeadline] = useState("");
  const [urls, setUrls] = useState("");

  const isValid = terms && price && deadline;

  return (
    <div style={{ background: "#fff", borderRadius: "12px", padding: "24px", border: "1px solid #e5e7eb" }}>
      <h3 style={{ margin: "0 0 20px 0", fontSize: "18px", color: "#111827" }}>Create New Deal</h3>

      <div style={{ marginBottom: "16px" }}>
        <label style={labelStyle}>Deal Terms (plain English)</label>
        <textarea
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          placeholder="Describe the exact conditions for this deal. Be specific about deliverables, quality standards, timelines, and acceptance criteria..."
          rows={5}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        <div>
          <label style={labelStyle}>Price</label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 5,000 USDT" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Deadline</label>
          <input value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="e.g. Delivery by May 1, 2026" style={inputStyle} />
        </div>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <label style={labelStyle}>Verification URLs (comma-separated)</label>
        <input
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder="https://tracking.example.com, https://inspection.example.com"
          style={inputStyle}
        />
        <p style={{ fontSize: "12px", color: "#9ca3af", margin: "4px 0 0 0" }}>
          URLs that validators will check to verify deal conditions (tracking pages, inspection portals, etc.)
        </p>
      </div>

      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{ padding: "10px 20px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 500, color: "#374151" }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit({ terms, price_description: price, deadline_description: deadline, verification_urls: urls })}
          disabled={!isValid}
          style={{
            padding: "10px 24px",
            borderRadius: "8px",
            border: "none",
            background: !isValid ? "#d1d5db" : "#3b82f6",
            color: "#fff",
            cursor: !isValid ? "default" : "pointer",
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          Create Deal
        </button>
      </div>
    </div>
  );
}
