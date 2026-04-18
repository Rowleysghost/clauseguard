import { useState, useEffect, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// ClauseGuard — AI-Powered P2P Trade Escrow
// Frontend for GenLayer Bradbury Testnet
// ═══════════════════════════════════════════════════════════════

// Status configuration
const STATUS_CONFIG = {
  open: { label: "Open", color: "#3b82f6", bg: "#eff6ff", icon: "+" },
  funded: { label: "Funded", color: "#8b5cf6", bg: "#f5f3ff", icon: "$" },
  evidence_submitted: { label: "Evidence Submitted", color: "#f59e0b", bg: "#fffbeb", icon: "!" },
  verified: { label: "Verified", color: "#10b981", bg: "#ecfdf5", icon: "v" },
  settled: { label: "Settled", color: "#059669", bg: "#d1fae5", icon: "ok" },
  rejected: { label: "Rejected", color: "#ef4444", bg: "#fef2f2", icon: "x" },
  refunded: { label: "Refunded", color: "#6b7280", bg: "#f3f4f6", icon: "<-" },
  disputed: { label: "Disputed", color: "#dc2626", bg: "#fef2f2", icon: "??" },
  cancelled: { label: "Cancelled", color: "#9ca3af", bg: "#f9fafb", icon: "--" },
};

const EVIDENCE_TYPES = [
  { value: "delivery_proof", label: "Delivery Proof" },
  { value: "quality_report", label: "Quality Report" },
  { value: "tracking", label: "Shipping Tracker" },
  { value: "receipt", label: "Receipt / Invoice" },
  { value: "other", label: "Other" },
];

const STATUS_FLOW = ["open", "funded", "evidence_submitted", "verified", "settled"];

// ── Mock data for demo (replace with live GenLayer reads) ──
const MOCK_DEALS = [
  {
    id: "1",
    seller: "0xABc1...f4E2",
    buyer: "",
    terms: "Ship 200 units of organic coffee beans (Grade A Arabica) via DHL Express to Berlin warehouse. Buyer confirms receipt and quality inspection within 5 business days. Beans must match sample spec: moisture < 12%, zero defects.",
    price_description: "4,500 USDT",
    deadline_description: "Delivery by April 20, 2026",
    verification_urls: "https://www.dhl.com/track,https://coffeegrading.org/reports",
    status: "open",
    evidence: "[]",
    verdict: "",
    verdict_details: "",
    funded_amount: "0",
  },
  {
    id: "2",
    seller: "0x7dF3...a1B9",
    buyer: "0x91Cc...3eD7",
    terms: "Complete redesign of company landing page per approved Figma mockup (v3.2). Deliverables: responsive HTML/CSS/JS, Lighthouse performance score > 90, all assets optimized. Deploy to staging URL for review.",
    price_description: "2,000 USDT",
    deadline_description: "April 15, 2026",
    verification_urls: "https://staging.clientsite.com,https://pagespeed.web.dev",
    status: "evidence_submitted",
    evidence: JSON.stringify([
      {
        submitted_by: "0x7dF3...a1B9",
        type: "delivery_proof",
        url: "https://staging.clientsite.com",
        description: "Staging deployment is live with all responsive breakpoints implemented per Figma v3.2",
      },
      {
        submitted_by: "0x7dF3...a1B9",
        type: "quality_report",
        url: "https://pagespeed.web.dev/analysis?url=staging.clientsite.com",
        description: "Lighthouse score: Performance 94, Accessibility 100, Best Practices 96",
      },
    ]),
    verdict: "",
    verdict_details: "",
    funded_amount: "2000",
  },
  {
    id: "3",
    seller: "0x45De...8fA1",
    buyer: "0xBb22...c7E4",
    terms: "Supply 50kg high-purity titanium powder (Grade 5, particle size 15-45um) with certificate of analysis. Ship via temperature-controlled freight to Austin, TX facility.",
    price_description: "12,800 USDT",
    deadline_description: "April 25, 2026",
    verification_urls: "https://fedex.com/track",
    status: "verified",
    evidence: JSON.stringify([
      {
        submitted_by: "0x45De...8fA1",
        type: "delivery_proof",
        url: "https://fedex.com/track?id=789456123",
        description: "FedEx confirms delivery signed by warehouse manager",
      },
      {
        submitted_by: "0xBb22...c7E4",
        type: "quality_report",
        url: "https://labresults.example.com/report/TI-2026-0412",
        description: "Independent lab confirms Grade 5 specs met, particle size 18-42um, purity 99.6%",
      },
    ]),
    verdict: "approved",
    verdict_details: JSON.stringify({
      conditions_met: true,
      confidence: "high",
      reasoning: "All deal conditions verified. FedEx tracking confirms delivery to Austin facility. Independent lab report validates Grade 5 titanium specifications including particle size range (18-42um within 15-45um requirement) and purity (99.6%). Certificate of analysis provided.",
      unmet_conditions: [],
    }),
    funded_amount: "12800",
  },
];

// ── Components ──

function StatusBadge({ status }) {
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

function StatusTimeline({ currentStatus }) {
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

function DealCard({ deal, onClick }) {
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
      <p style={{ fontSize: "14px", lineHeight: "1.5", color: "#1f2937", margin: "0 0 12px 0", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {deal.terms}
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "16px", fontWeight: 700, color: "#111827" }}>{deal.price_description}</span>
        <span style={{ fontSize: "12px", color: "#9ca3af" }}>
          {evidence.length} evidence{evidence.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "8px" }}>
        {deal.deadline_description}
      </div>
    </div>
  );
}

function CreateDealForm({ onSubmit, onCancel }) {
  const [terms, setTerms] = useState("");
  const [price, setPrice] = useState("");
  const [deadline, setDeadline] = useState("");
  const [urls, setUrls] = useState("");

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
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 5,000 USDT"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Deadline</label>
          <input
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            placeholder="e.g. Delivery by May 1, 2026"
            style={inputStyle}
          />
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
        <button onClick={onCancel} style={{ padding: "10px 20px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 500, color: "#374151" }}>
          Cancel
        </button>
        <button
          onClick={() => onSubmit({ terms, price_description: price, deadline_description: deadline, verification_urls: urls })}
          disabled={!terms || !price || !deadline}
          style={{
            padding: "10px 24px",
            borderRadius: "8px",
            border: "none",
            background: (!terms || !price || !deadline) ? "#d1d5db" : "#3b82f6",
            color: "#fff",
            cursor: (!terms || !price || !deadline) ? "default" : "pointer",
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

function EvidencePanel({ deal, onSubmit }) {
  const [evidenceType, setEvidenceType] = useState("delivery_proof");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const evidence = JSON.parse(deal.evidence || "[]");

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

  return (
    <div style={{ background: "#f9fafb", borderRadius: "12px", padding: "20px", marginTop: "16px" }}>
      <h4 style={{ margin: "0 0 16px 0", fontSize: "15px", color: "#111827" }}>
        Evidence ({evidence.length})
      </h4>

      {evidence.map((e, i) => (
        <div key={i} style={{ background: "#fff", borderRadius: "8px", padding: "12px", marginBottom: "8px", border: "1px solid #e5e7eb" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#3b82f6", textTransform: "uppercase" }}>
              {EVIDENCE_TYPES.find((t) => t.value === e.type)?.label || e.type}
            </span>
            <span style={{ fontSize: "11px", color: "#9ca3af" }}>
              by {e.submitted_by === deal.seller ? "Seller" : "Buyer"}
            </span>
          </div>
          <p style={{ fontSize: "13px", color: "#374151", margin: "4px 0" }}>{e.description}</p>
          <a href={e.url} target="_blank" rel="noopener" style={{ fontSize: "12px", color: "#3b82f6", textDecoration: "none" }}>
            {e.url}
          </a>
        </div>
      ))}

      {(deal.status === "funded" || deal.status === "evidence_submitted") && (
        <div style={{ marginTop: "16px", padding: "16px", background: "#fff", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
          <p style={{ fontSize: "13px", fontWeight: 600, color: "#374151", margin: "0 0 12px 0" }}>Submit New Evidence</p>
          <div style={{ display: "grid", gap: "10px" }}>
            <select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)} style={inputStyle}>
              {EVIDENCE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Evidence URL" style={inputStyle} />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe what this evidence proves..." rows={2} style={{ ...inputStyle, resize: "vertical" }} />
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
                background: (!url || !description) ? "#d1d5db" : "#8b5cf6",
                color: "#fff",
                cursor: (!url || !description) ? "default" : "pointer",
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

function VerdictPanel({ deal }) {
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
          <span style={{ fontSize: "12px", color: isApproved ? "#059669" : "#dc2626" }}>
            Confidence: {verdict.confidence}
          </span>
        </div>
      </div>
      <p style={{ fontSize: "14px", lineHeight: "1.6", color: "#374151", margin: "0 0 12px 0" }}>
        {verdict.reasoning}
      </p>
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

function DealDetail({ deal, onBack, onAction }) {
  const evidence = JSON.parse(deal.evidence || "[]");
  const verificationUrls = deal.verification_urls.split(",").filter((u) => u.trim());

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#6b7280", padding: "0", marginBottom: "16px", fontFamily: "inherit" }}>
        &larr; Back to deals
      </button>

      <div style={{ background: "#fff", borderRadius: "12px", padding: "24px", border: "1px solid #e5e7eb" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h2 style={{ margin: 0, fontSize: "20px", color: "#111827" }}>Deal #{deal.id}</h2>
          <StatusBadge status={deal.status} />
        </div>

        <StatusTimeline currentStatus={deal.status} />

        <div style={{ marginTop: "20px" }}>
          <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Deal Terms</h4>
          <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "16px", border: "1px solid #e5e7eb" }}>
            <p style={{ fontSize: "14px", lineHeight: "1.7", color: "#1f2937", margin: 0, whiteSpace: "pre-wrap" }}>
              {deal.terms}
            </p>
          </div>
        </div>

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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "16px" }}>
          <div>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px 0" }}>Seller</p>
            <code style={{ fontSize: "13px", color: "#374151", background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }}>
              {deal.seller}
            </code>
          </div>
          <div>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px 0" }}>Buyer</p>
            <code style={{ fontSize: "13px", color: "#374151", background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }}>
              {deal.buyer || "Awaiting buyer"}
            </code>
          </div>
        </div>

        {verificationUrls.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 8px 0" }}>Verification URLs</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {verificationUrls.map((url, i) => (
                <a key={i} href={url.trim()} target="_blank" rel="noopener" style={{ fontSize: "12px", color: "#3b82f6", background: "#eff6ff", padding: "4px 10px", borderRadius: "6px", textDecoration: "none" }}>
                  {url.trim()}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons based on deal status */}
        <div style={{ display: "flex", gap: "10px", marginTop: "24px", paddingTop: "20px", borderTop: "1px solid #e5e7eb" }}>
          {deal.status === "open" && (
            <button onClick={() => onAction("fund", deal.id)} style={{ padding: "10px 24px", borderRadius: "8px", border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>
              Fund This Deal
            </button>
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
          {deal.status === "open" && (
            <button onClick={() => onAction("cancel", deal.id)} style={{ padding: "10px 24px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", color: "#374151", cursor: "pointer", fontSize: "14px", fontWeight: 500 }}>
              Cancel Deal
            </button>
          )}
        </div>
      </div>

      {/* Evidence Section */}
      <EvidencePanel deal={deal} onSubmit={(ev) => onAction("evidence", deal.id, ev)} />

      {/* Verdict Section */}
      <VerdictPanel deal={deal} />
    </div>
  );
}

// ── Main App ──

export default function ClauseGuardApp() {
  const [view, setView] = useState("marketplace"); // marketplace | create | detail
  const [deals, setDeals] = useState(MOCK_DEALS);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notification, setNotification] = useState(null);

  const showNotification = useCallback((msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  }, []);

  const handleCreateDeal = (dealData) => {
    const newDeal = {
      id: String(deals.length + 1),
      seller: walletAddress || "0xYou...rAddr",
      buyer: "",
      ...dealData,
      status: "open",
      evidence: "[]",
      verdict: "",
      verdict_details: "",
      funded_amount: "0",
    };
    setDeals([newDeal, ...deals]);
    setView("marketplace");
    showNotification("Deal created! It's now visible in the marketplace.");
  };

  const handleAction = (action, dealId, extra) => {
    setDeals((prev) =>
      prev.map((d) => {
        if (d.id !== dealId) return d;
        const updated = { ...d };
        switch (action) {
          case "fund":
            updated.status = "funded";
            updated.buyer = walletAddress || "0xBuyer...Addr";
            updated.funded_amount = d.price_description.replace(/[^0-9]/g, "");
            showNotification("Deal funded! Funds locked in escrow.");
            break;
          case "evidence":
            const ev = JSON.parse(updated.evidence);
            ev.push({ submitted_by: walletAddress || "0xYou", ...extra });
            updated.evidence = JSON.stringify(ev);
            updated.status = "evidence_submitted";
            showNotification("Evidence submitted successfully.");
            break;
          case "verify":
            // Simulate AI verification
            updated.status = "verified";
            updated.verdict = "approved";
            updated.verdict_details = JSON.stringify({
              conditions_met: true,
              confidence: "high",
              reasoning: "All deal conditions have been verified by AI validators. The submitted evidence aligns with the stated deal terms, and web content from verification URLs corroborates the claims made by both parties.",
              unmet_conditions: [],
            });
            showNotification("AI Verification complete! Conditions met.");
            break;
          case "settle":
            updated.status = "settled";
            showNotification("Deal settled! Funds released to seller.");
            break;
          case "refund":
            updated.status = "refunded";
            showNotification("Refund claimed. Funds returned to buyer.");
            break;
          case "cancel":
            updated.status = "cancelled";
            showNotification("Deal cancelled.");
            break;
        }
        if (selectedDeal?.id === dealId) setSelectedDeal(updated);
        return updated;
      })
    );
  };

  const filteredDeals = statusFilter === "all" ? deals : deals.filter((d) => d.status === statusFilter);

  const stats = {
    total: deals.length,
    open: deals.filter((d) => d.status === "open").length,
    active: deals.filter((d) => ["funded", "evidence_submitted"].includes(d.status)).length,
    settled: deals.filter((d) => d.status === "settled").length,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Notification Toast */}
      {notification && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            right: "20px",
            padding: "12px 20px",
            borderRadius: "10px",
            background: notification.type === "success" ? "#10b981" : "#ef4444",
            color: "#fff",
            fontSize: "14px",
            fontWeight: 500,
            zIndex: 1000,
            boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
            animation: "slideIn 0.3s ease",
          }}
        >
          {notification.msg}
        </div>
      )}

      {/* Header */}
      <header style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", height: "64px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "16px", fontWeight: 800 }}>
              C
            </div>
            <span style={{ fontSize: "18px", fontWeight: 700, color: "#111827" }}>ClauseGuard</span>
            <span style={{ fontSize: "11px", color: "#9ca3af", background: "#f3f4f6", padding: "2px 8px", borderRadius: "4px", fontWeight: 500 }}>
              Bradbury Testnet
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {walletConnected ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981" }} />
                <code style={{ fontSize: "13px", color: "#374151" }}>{walletAddress}</code>
              </div>
            ) : (
              <button
                onClick={() => {
                  setWalletConnected(true);
                  setWalletAddress("0x91Cc...3eD7");
                  showNotification("Wallet connected!");
                }}
                style={{
                  padding: "8px 20px",
                  borderRadius: "8px",
                  border: "none",
                  background: "#111827",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: 600,
                }}
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "24px 32px" }}>
        {view === "detail" && selectedDeal ? (
          <DealDetail
            deal={selectedDeal}
            onBack={() => {
              setView("marketplace");
              setSelectedDeal(null);
            }}
            onAction={handleAction}
          />
        ) : view === "create" ? (
          <CreateDealForm onSubmit={handleCreateDeal} onCancel={() => setView("marketplace")} />
        ) : (
          <>
            {/* Stats Row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
              {[
                { label: "Total Deals", value: stats.total, color: "#3b82f6" },
                { label: "Open", value: stats.open, color: "#f59e0b" },
                { label: "Active", value: stats.active, color: "#8b5cf6" },
                { label: "Settled", value: stats.settled, color: "#10b981" },
              ].map((s) => (
                <div key={s.label} style={{ background: "#fff", borderRadius: "10px", padding: "16px 20px", border: "1px solid #e5e7eb" }}>
                  <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 4px 0" }}>{s.label}</p>
                  <p style={{ fontSize: "24px", fontWeight: 700, color: s.color, margin: 0 }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Toolbar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <div style={{ display: "flex", gap: "6px" }}>
                {["all", "open", "funded", "evidence_submitted", "verified", "settled"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "6px",
                      border: "1px solid",
                      borderColor: statusFilter === f ? "#3b82f6" : "#e5e7eb",
                      background: statusFilter === f ? "#eff6ff" : "#fff",
                      color: statusFilter === f ? "#3b82f6" : "#6b7280",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: 500,
                    }}
                  >
                    {f === "all" ? "All" : STATUS_CONFIG[f]?.label || f}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setView("create")}
                style={{
                  padding: "10px 24px",
                  borderRadius: "8px",
                  border: "none",
                  background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: 600,
                  boxShadow: "0 2px 8px rgba(59,130,246,0.3)",
                }}
              >
                + Create Deal
              </button>
            </div>

            {/* Deal Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
              {filteredDeals.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  onClick={() => {
                    setSelectedDeal(deal);
                    setView("detail");
                  }}
                />
              ))}
            </div>

            {filteredDeals.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#9ca3af" }}>
                <p style={{ fontSize: "16px", margin: "0 0 8px 0" }}>No deals found</p>
                <p style={{ fontSize: "13px", margin: 0 }}>
                  {statusFilter !== "all" ? "Try changing the filter" : "Create your first deal to get started"}
                </p>
              </div>
            )}

            {/* How It Works */}
            <div style={{ marginTop: "48px", background: "#fff", borderRadius: "12px", padding: "32px", border: "1px solid #e5e7eb" }}>
              <h3 style={{ margin: "0 0 24px 0", fontSize: "18px", color: "#111827", textAlign: "center" }}>How ClauseGuard Works</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px" }}>
                {[
                  { step: "1", title: "Create Deal", desc: "Seller writes terms in plain English with verification URLs" },
                  { step: "2", title: "Fund Escrow", desc: "Buyer reviews terms, agrees, and deposits funds into contract" },
                  { step: "3", title: "Submit Evidence", desc: "Either party submits proof links (tracking, reports, receipts)" },
                  { step: "4", title: "AI Verifies", desc: "Validators fetch URLs, reason about terms, and vote on outcome" },
                  { step: "5", title: "Auto-Settle", desc: "Funds release to seller or refund to buyer based on verdict" },
                ].map((s) => (
                  <div key={s.step} style={{ textAlign: "center" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", fontSize: "16px", fontWeight: 700 }}>
                      {s.step}
                    </div>
                    <p style={{ fontSize: "13px", fontWeight: 600, color: "#111827", margin: "0 0 4px 0" }}>{s.title}</p>
                    <p style={{ fontSize: "12px", color: "#6b7280", margin: 0, lineHeight: "1.4" }}>{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer style={{ textAlign: "center", padding: "24px", color: "#9ca3af", fontSize: "12px" }}>
        ClauseGuard · GenLayer Bradbury Testnet · Contract{" "}
        <a href={`https://explorer-studio.genlayer.com/address/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer" style={{ color: "#6366f1", textDecoration: "none", fontFamily: "monospace" }}>
          {process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ? process.env.NEXT_PUBLIC_CONTRACT_ADDRESS.slice(0,6) + "…" + process.env.NEXT_PUBLIC_CONTRACT_ADDRESS.slice(-4) : "not configured"}
        </a>
      </footer>
    </div>
  );
}
