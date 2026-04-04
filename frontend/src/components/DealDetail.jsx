import React from "react";
import StatusBadge from "./StatusBadge";
import StatusTimeline from "./StatusTimeline";
import EvidencePanel from "./EvidencePanel";
import VerdictPanel from "./VerdictPanel";

export default function DealDetail({ deal, onBack, onAction }) {
  const verificationUrls = deal.verification_urls.split(",").filter((u) => u.trim());

  return (
    <div>
      <button
        onClick={onBack}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#6b7280", padding: "0", marginBottom: "16px", fontFamily: "inherit" }}
      >
        &larr; Back to deals
      </button>

      <div style={{ background: "#fff", borderRadius: "12px", padding: "24px", border: "1px solid #e5e7eb" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h2 style={{ margin: 0, fontSize: "20px", color: "#111827" }}>Deal #{deal.id}</h2>
          <StatusBadge status={deal.status} />
        </div>

        <StatusTimeline currentStatus={deal.status} />

        {/* Terms */}
        <div style={{ marginTop: "20px" }}>
          <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Deal Terms</h4>
          <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "16px", border: "1px solid #e5e7eb" }}>
            <p style={{ fontSize: "14px", lineHeight: "1.7", color: "#1f2937", margin: 0, whiteSpace: "pre-wrap" }}>{deal.terms}</p>
          </div>
        </div>

        {/* Metadata grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginTop: "20px" }}>
          <div>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px 0" }}>Price</p>
            <p style={{ fontSize: "16px", fontWeight: 700, color: "#111827", margin: 0 }}>{deal.price_description}</p>
          </div>
          <div>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px 0" }}>Deadline</p>
            <p style={{ fontSize: "14px", fontWeight: 500, color: "#111827", margin: 0 }}>{deal.deadline_description}</p>
          </div>
          <div>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px 0" }}>Funded</p>
            <p style={{ fontSize: "14px", fontWeight: 500, color: "#111827", margin: 0 }}>
              {deal.funded_amount !== "0" ? `${deal.funded_amount} tokens` : "Not yet funded"}
            </p>
          </div>
        </div>

        {/* Parties */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "16px" }}>
          <div>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px 0" }}>Seller</p>
            <code style={{ fontSize: "13px", color: "#374151", background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }}>{deal.seller}</code>
          </div>
          <div>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px 0" }}>Buyer</p>
            <code style={{ fontSize: "13px", color: "#374151", background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }}>
              {deal.buyer || "Awaiting buyer"}
            </code>
          </div>
        </div>

        {/* Verification URLs */}
        {verificationUrls.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 8px 0" }}>Verification URLs</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {verificationUrls.map((url, i) => (
                <a key={i} href={url.trim()} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "#3b82f6", background: "#eff6ff", padding: "4px 10px", borderRadius: "6px", textDecoration: "none" }}>
                  {url.trim()}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "10px", marginTop: "24px", paddingTop: "20px", borderTop: "1px solid #e5e7eb" }}>
          {deal.status === "open" && (
            <>
              <button onClick={() => onAction("fund", deal.id)} style={{ padding: "10px 24px", borderRadius: "8px", border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>
                Fund This Deal
              </button>
              <button onClick={() => onAction("cancel", deal.id)} style={{ padding: "10px 24px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", color: "#374151", cursor: "pointer", fontSize: "14px", fontWeight: 500 }}>
                Cancel Deal
              </button>
            </>
          )}
          {deal.status === "evidence_submitted" && (
            <button onClick={() => onAction("verify", deal.id)} style={{ padding: "10px 24px", borderRadius: "8px", border: "none", background: "#f59e0b", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>
              Request AI Verification
            </button>
          )}
          {deal.status === "verified" && (
            <button onClick={() => onAction("settle", deal.id)} style={{ padding: "10px 24px", borderRadius: "8px", border: "none", background: "#10b981", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>
              Settle &amp; Release Funds
            </button>
          )}
          {deal.status === "rejected" && (
            <button onClick={() => onAction("refund", deal.id)} style={{ padding: "10px 24px", borderRadius: "8px", border: "none", background: "#ef4444", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>
              Claim Refund
            </button>
          )}
        </div>
      </div>

      <EvidencePanel deal={deal} onSubmit={(ev) => onAction("evidence", deal.id, ev)} />
      <VerdictPanel deal={deal} />
    </div>
  );
}
