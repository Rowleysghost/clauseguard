"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import * as GL from "./lib/genlayer";
import { uploadScreenshot, validateImageFile } from "./lib/upload";

// ═══════════════════════════════════════════════════════════════
// ClauseGuard — AI-Powered P2P Trade Escrow (Real Build)
// Reads/writes against GenLayer Bradbury Testnet
// Wallet: Rabby / MetaMask via window.ethereum
// Evidence uploads: imgbb
// ═══════════════════════════════════════════════════════════════

// ── Theme tokens ─────────────────────────────────────────────
const T = {
  dark: {
    bg: "#0f1117",
    surface: "#1a1d27",
    surfaceHover: "#22263a",
    border: "#2e3148",
    borderLight: "#3a3f5c",
    text: "#e8eaf6",
    textMuted: "#8b90b8",
    textFaint: "#555a7a",
    accent: "#6366f1",
    accentHover: "#818cf8",
    accentBg: "#1e1f3a",
    success: "#10b981",
    successBg: "#0d2a1e",
    warn: "#f59e0b",
    warnBg: "#2a1f0d",
    danger: "#ef4444",
    dangerBg: "#2a0d0d",
    info: "#3b82f6",
    infoBg: "#0d1a2a",
  },
  light: {
    bg: "#f8f9fc",
    surface: "#ffffff",
    surfaceHover: "#f1f3fa",
    border: "#e2e5f0",
    borderLight: "#d0d5eb",
    text: "#1a1d2e",
    textMuted: "#5c6080",
    textFaint: "#9ca3c8",
    accent: "#4f46e5",
    accentHover: "#4338ca",
    accentBg: "#eef2ff",
    success: "#059669",
    successBg: "#ecfdf5",
    warn: "#d97706",
    warnBg: "#fffbeb",
    danger: "#dc2626",
    dangerBg: "#fef2f2",
    info: "#2563eb",
    infoBg: "#eff6ff",
  },
};

const STATUS_META = {
  open:               { label: "Open",               dot: "#3b82f6" },
  funded:             { label: "Funded",              dot: "#8b5cf6" },
  evidence_submitted: { label: "Evidence Submitted",  dot: "#f59e0b" },
  verified:           { label: "Verified",            dot: "#10b981" },
  settled:            { label: "Settled",             dot: "#059669" },
  rejected:           { label: "Rejected",            dot: "#ef4444" },
  refunded:           { label: "Refunded",            dot: "#6b7280" },
  disputed:           { label: "Disputed",            dot: "#dc2626" },
  cancelled:          { label: "Cancelled",           dot: "#9ca3af" },
};

const EVIDENCE_TYPES = [
  { value: "delivery_proof",  label: "Delivery Proof"   },
  { value: "quality_report",  label: "Quality Report"   },
  { value: "tracking",        label: "Shipping Tracker" },
  { value: "receipt",         label: "Receipt / Invoice"},
  { value: "other",           label: "Other"            },
];

function shortAddr(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

// ── Toast ─────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  }, []);
  return { toasts, add };
}

function ToastContainer({ toasts, theme }) {
  const c = T[theme];
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10 }}>
      {toasts.map(t => {
        const color = t.type === "success" ? c.success : t.type === "error" ? c.danger : c.accent;
        const bg    = t.type === "success" ? c.successBg : t.type === "error" ? c.dangerBg : c.accentBg;
        return (
          <div key={t.id} style={{
            background: bg, border: `1px solid ${color}`, color: c.text,
            padding: "12px 18px", borderRadius: 10, maxWidth: 340,
            fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
            borderLeft: `4px solid ${color}`,
          }}>
            {t.msg}
          </div>
        );
      })}
    </div>
  );
}

// ── Tx overlay ────────────────────────────────────────────────
function TxOverlay({ msg, theme }) {
  const c = T[theme];
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      zIndex: 9000, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 20,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: "50%",
        border: `4px solid ${c.border}`, borderTopColor: c.accent,
        animation: "spin 0.8s linear infinite",
      }} />
      <div style={{ color: "#fff", fontSize: 16, fontWeight: 500 }}>{msg}</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Evidence upload form ──────────────────────────────────────
function EvidenceForm({ deal, walletAddress, provider, theme, onSuccess, onCancel, toast }) {
  const c = T[theme];
  const [evType, setEvType] = useState("delivery_proof");
  const [evUrl, setEvUrl] = useState("");
  const [evDesc, setEvDesc] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef(null);

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      validateImageFile(file);
      setUploading(true);
      const url = await uploadScreenshot(file);
      setEvUrl(url);
      toast("Screenshot uploaded ✓", "success");
    } catch (err) {
      toast("Upload failed: " + err.message, "error");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    if (!evUrl.trim()) { toast("Provide an evidence URL or upload a screenshot", "error"); return; }
    if (!evDesc.trim()) { toast("Add a short description", "error"); return; }
    try {
      setSubmitting(true);
      await GL.submitEvidence(walletAddress, provider, parseInt(deal.id), evType, evUrl.trim(), evDesc.trim());
      toast("Evidence submitted on-chain ✓", "success");
      onSuccess();
    } catch (err) {
      toast("Submit failed: " + err.message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  const inp = {
    background: c.surfaceHover, border: `1px solid ${c.border}`, borderRadius: 8,
    padding: "10px 14px", color: c.text, fontSize: 14, width: "100%", boxSizing: "border-box",
    outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={{ fontSize: 12, color: c.textMuted, display: "block", marginBottom: 6 }}>Evidence Type</label>
        <select value={evType} onChange={e => setEvType(e.target.value)} style={inp}>
          {EVIDENCE_TYPES.map(et => <option key={et.value} value={et.value}>{et.label}</option>)}
        </select>
      </div>

      <div>
        <label style={{ fontSize: 12, color: c.textMuted, display: "block", marginBottom: 6 }}>
          Evidence URL <span style={{ color: c.textFaint }}>(paste a link or upload screenshot below)</span>
        </label>
        <input
          value={evUrl}
          onChange={e => setEvUrl(e.target.value)}
          placeholder="https://tracking.dhl.com/... or imgbb URL"
          style={inp}
        />
      </div>

      <div>
        <label style={{ fontSize: 12, color: c.textMuted, display: "block", marginBottom: 6 }}>Upload Screenshot</label>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: "none" }} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            background: c.surfaceHover, border: `1px dashed ${c.border}`, borderRadius: 8,
            color: uploading ? c.textMuted : c.text, cursor: uploading ? "not-allowed" : "pointer",
            padding: "10px 18px", fontSize: 14, width: "100%",
          }}
        >
          {uploading ? "Uploading…" : "📎 Choose image (JPEG / PNG / WebP, max 32MB)"}
        </button>
        {evUrl && evUrl.startsWith("https://i.ibb.co") && (
          <div style={{ marginTop: 8, fontSize: 12, color: c.success }}>
            ✓ Uploaded: <a href={evUrl} target="_blank" rel="noreferrer" style={{ color: c.accent }}>{evUrl}</a>
          </div>
        )}
      </div>

      <div>
        <label style={{ fontSize: 12, color: c.textMuted, display: "block", marginBottom: 6 }}>Description</label>
        <textarea
          value={evDesc}
          onChange={e => setEvDesc(e.target.value)}
          placeholder="Brief description of what this evidence shows…"
          rows={3}
          style={{ ...inp, resize: "vertical" }}
        />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onCancel} style={{
          flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${c.border}`,
          background: "transparent", color: c.textMuted, cursor: "pointer", fontSize: 14,
        }}>Cancel</button>
        <button onClick={handleSubmit} disabled={submitting} style={{
          flex: 2, padding: "10px 0", borderRadius: 8, border: "none",
          background: submitting ? c.textFaint : c.accent, color: "#fff",
          cursor: submitting ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 600,
        }}>
          {submitting ? "Submitting…" : "Submit Evidence On-Chain"}
        </button>
      </div>
    </div>
  );
}

// ── Create Deal form ──────────────────────────────────────────
function CreateDealForm({ walletAddress, provider, theme, onSuccess, onCancel, toast }) {
  const c = T[theme];
  const [terms, setTerms] = useState("");
  const [price, setPrice] = useState("");
  const [deadline, setDeadline] = useState("");
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!terms.trim())    { toast("Deal terms are required", "error"); return; }
    if (!price.trim())    { toast("Price description is required", "error"); return; }
    if (!deadline.trim()) { toast("Deadline description is required", "error"); return; }
    try {
      setLoading(true);
      const urlArray = urls.split(",").map(u => u.trim()).filter(Boolean);
      await GL.createDeal(walletAddress, provider, {
        terms: terms.trim(),
        priceDescription: price.trim(),
        deadlineDescription: deadline.trim(),
        verificationUrls: urlArray,
      });
      toast("Deal created on-chain ✓", "success");
      onSuccess();
    } catch (err) {
      toast("Create failed: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  const inp = {
    background: c.surfaceHover, border: `1px solid ${c.border}`, borderRadius: 8,
    padding: "10px 14px", color: c.text, fontSize: 14, width: "100%", boxSizing: "border-box",
    outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={{ fontSize: 12, color: c.textMuted, display: "block", marginBottom: 6 }}>Deal Terms <span style={{ color: c.danger }}>*</span></label>
        <textarea
          value={terms}
          onChange={e => setTerms(e.target.value)}
          placeholder="Describe exactly what must happen for funds to be released. Be specific — AI validators will read this."
          rows={5}
          style={{ ...inp, resize: "vertical" }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, color: c.textMuted, display: "block", marginBottom: 6 }}>Price / Amount <span style={{ color: c.danger }}>*</span></label>
          <input value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 1.5 ETH" style={inp} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: c.textMuted, display: "block", marginBottom: 6 }}>Deadline <span style={{ color: c.danger }}>*</span></label>
          <input value={deadline} onChange={e => setDeadline(e.target.value)} placeholder="e.g. May 15, 2026" style={inp} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 12, color: c.textMuted, display: "block", marginBottom: 6 }}>
          Verification URLs <span style={{ color: c.textFaint }}>(comma-separated — validators will crawl these)</span>
        </label>
        <input value={urls} onChange={e => setUrls(e.target.value)} placeholder="https://track.dhl.com, https://yoursite.com/order/123" style={inp} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onCancel} style={{
          flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${c.border}`,
          background: "transparent", color: c.textMuted, cursor: "pointer", fontSize: 14,
        }}>Cancel</button>
        <button onClick={handleCreate} disabled={loading} style={{
          flex: 2, padding: "10px 0", borderRadius: 8, border: "none",
          background: loading ? c.textFaint : c.accent, color: "#fff",
          cursor: loading ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 600,
        }}>
          {loading ? "Creating…" : "Create Deal On-Chain"}
        </button>
      </div>
    </div>
  );
}

// ── Deal status pipeline bar (visible to parties only) ───────
function DealStatusBar({ deal, theme }) {
  const c = T[theme];
  const PIPELINE = [
    { key: "open",               label: "Open"      },
    { key: "funded",             label: "Funded"    },
    { key: "evidence_submitted", label: "Evidence"  },
    { key: "verified",           label: "Verified"  },
    { key: "settled",            label: "Settled"   },
  ];
  const ERROR_STATES = { rejected: "Rejected by AI", refunded: "Refunded", disputed: "Disputed", cancelled: "Cancelled" };
  const status = deal.status || "open";

  if (ERROR_STATES[status]) {
    return (
      <div style={{ background: c.dangerBg, border: `1px solid ${c.danger}44`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: c.danger, fontWeight: 600 }}>
        ✗ {ERROR_STATES[status]}
        {status === "rejected" && <span style={{ color: c.textMuted, fontWeight: 400, marginLeft: 8 }}>— Buyer may claim refund</span>}
      </div>
    );
  }

  const activeIdx = PIPELINE.findIndex(s => s.key === status);
  const isPending = status === "evidence_submitted";

  return (
    <div style={{ marginBottom: 16 }}>
      {isPending && (
        <div style={{ fontSize: 11, color: c.warn, marginBottom: 8, fontWeight: 600 }}>
          ⏳ Awaiting AI verification — validators are reviewing evidence (2–10 min)
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        {PIPELINE.map((stage, i) => {
          const done    = i < activeIdx;
          const active  = i === activeIdx;
          const future  = i > activeIdx;
          const color   = done ? c.success : active ? c.accent : c.textFaint;
          return (
            <div key={stage.key} style={{ display: "flex", alignItems: "center", flex: i < PIPELINE.length - 1 ? 1 : "none" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                  background: future ? c.surfaceHover : color,
                  border: `2px solid ${future ? c.border : color}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, color: future ? c.textFaint : "#fff", fontWeight: 700,
                  boxShadow: active ? `0 0 0 3px ${c.accent}33` : "none",
                }}>
                  {done ? "✓" : i + 1}
                </div>
                <div style={{ fontSize: 10, color, whiteSpace: "nowrap", fontWeight: active ? 700 : 400 }}>{stage.label}</div>
              </div>
              {i < PIPELINE.length - 1 && (
                <div style={{ flex: 1, height: 2, background: done ? c.success : c.border, margin: "0 4px", marginBottom: 16 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Deal card ─────────────────────────────────────────────────
function DealCard({ deal, walletAddress, provider, theme, onRefresh, toast }) {
  const c = T[theme];
  const [expanded, setExpanded] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [txMsg, setTxMsg] = useState(null);
  const [fundAmt, setFundAmt] = useState("");

  const status = deal.status || "open";
  const meta   = STATUS_META[status] || STATUS_META.open;
  const isAddr = (a) => a && walletAddress && a.toLowerCase() === walletAddress.toLowerCase();
  const isSeller = isAddr(deal.seller);
  const isBuyer  = isAddr(deal.buyer);

  async function tx(label, fn) {
    try {
      setTxMsg(label);
      await fn();
      toast(label + " ✓", "success");
      await onRefresh();
    } catch (err) {
      toast(err.message || "Transaction failed", "error");
    } finally {
      setTxMsg(null);
    }
  }

  let evidence = [];
  try { evidence = JSON.parse(deal.evidence || "[]"); } catch {}

  const verdictColor = deal.verdict === "conditions_met" ? c.success
    : deal.verdict === "conditions_not_met" ? c.danger
    : c.textMuted;

  return (
    <div style={{
      background: c.surface, border: `1px solid ${c.border}`, borderRadius: 14,
      overflow: "hidden", transition: "border-color 0.2s",
    }}>
      {txMsg && <TxOverlay msg={txMsg} theme={theme} />}

      {/* Header row */}
      <div
        onClick={() => setExpanded(p => !p)}
        style={{ padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 12, fontWeight: 600, color: meta.dot,
              background: meta.dot + "22", borderRadius: 20, padding: "3px 10px",
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.dot, display: "inline-block" }} />
              {meta.label}
            </span>
            <span style={{ fontSize: 12, color: c.textFaint }}>#{deal.id}</span>
          </div>
          <div style={{ fontSize: 14, color: c.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {deal.terms?.slice(0, 90)}{deal.terms?.length > 90 ? "…" : ""}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: c.accent }}>{deal.price_description}</span>
          <span style={{ fontSize: 11, color: c.textMuted }}>{deal.deadline_description}</span>
        </div>
        <span style={{ color: c.textFaint, fontSize: 18 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: "0 20px 20px", borderTop: `1px solid ${c.border}` }}>
          {/* Status pipeline — visible to deal parties only */}
          {(isSeller || isBuyer) && <div style={{ marginTop: 14 }}><DealStatusBar deal={deal} theme={theme} /></div>}
          {/* Parties */}
          <div style={{ display: "flex", gap: 16, marginTop: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: c.textMuted }}>
              Seller: <span style={{ color: deal.seller === walletAddress ? c.accent : c.text, fontFamily: "monospace" }}>
                {shortAddr(deal.seller)}{isSeller ? " (you)" : ""}
              </span>
            </div>
            {deal.buyer && (
              <div style={{ fontSize: 12, color: c.textMuted }}>
                Buyer: <span style={{ color: isBuyer ? c.accent : c.text, fontFamily: "monospace" }}>
                  {shortAddr(deal.buyer)}{isBuyer ? " (you)" : ""}
                </span>
              </div>
            )}
          </div>

          {/* Full terms */}
          <div style={{
            background: c.surfaceHover, borderRadius: 8, padding: "12px 14px",
            fontSize: 13, color: c.text, lineHeight: 1.6, marginBottom: 14,
          }}>
            {deal.terms}
          </div>

          {/* Verification URLs */}
          {deal.verification_urls && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: c.textFaint, marginBottom: 4 }}>VERIFICATION URLS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(Array.isArray(deal.verification_urls)
                  ? deal.verification_urls
                  : deal.verification_urls.split(",")
                ).filter(Boolean).map((u, i) => (
                  <a key={i} href={u.trim()} target="_blank" rel="noreferrer" style={{
                    fontSize: 11, color: c.accent, textDecoration: "none",
                    background: c.accentBg, padding: "3px 8px", borderRadius: 4,
                  }}>{u.trim().slice(0, 40)}{u.trim().length > 40 ? "…" : ""}</a>
                ))}
              </div>
            </div>
          )}

          {/* Verdict */}
          {deal.verdict && (
            <div style={{
              background: c.surfaceHover, border: `1px solid ${verdictColor}40`, borderRadius: 8,
              padding: "12px 14px", marginBottom: 14,
            }}>
              <div style={{ fontSize: 11, color: c.textFaint, marginBottom: 4 }}>AI VERDICT</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: verdictColor }}>
                {deal.verdict === "conditions_met" ? "✓ Conditions Met" : "✗ Conditions Not Met"}
              </div>
              {deal.verdict_details && (
                <div style={{ fontSize: 12, color: c.textMuted, marginTop: 6 }}>{deal.verdict_details}</div>
              )}
            </div>
          )}

          {/* Evidence list */}
          {evidence.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: c.textFaint, marginBottom: 8 }}>SUBMITTED EVIDENCE ({evidence.length})</div>
              {evidence.map((ev, i) => (
                <div key={i} style={{
                  background: c.surfaceHover, borderRadius: 8, padding: "10px 12px",
                  marginBottom: 6, fontSize: 12, color: c.text,
                }}>
                  <div style={{ fontWeight: 600, color: c.textMuted, marginBottom: 2 }}>{ev.evidence_type?.replace(/_/g," ")}</div>
                  <a href={ev.url} target="_blank" rel="noreferrer" style={{ color: c.accent, wordBreak: "break-all" }}>{ev.url}</a>
                  {ev.description && <div style={{ marginTop: 4, color: c.textMuted }}>{ev.description}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Evidence form */}
          {showEvidence && (
            <div style={{
              background: c.surfaceHover, borderRadius: 10, padding: "16px",
              border: `1px solid ${c.border}`, marginBottom: 14,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.text, marginBottom: 12 }}>Submit Evidence</div>
              <EvidenceForm
                deal={deal}
                walletAddress={walletAddress}
                provider={provider}
                theme={theme}
                toast={toast}
                onSuccess={async () => { setShowEvidence(false); await onRefresh(); }}
                onCancel={() => setShowEvidence(false)}
              />
            </div>
          )}

          {/* Fund form */}
          {status === "open" && !isSeller && walletAddress && (
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                value={fundAmt}
                onChange={e => setFundAmt(e.target.value)}
                placeholder="Amount in wei (e.g. 1000000000000000000 = 1 ETH)"
                style={{
                  flex: 1, background: c.surfaceHover, border: `1px solid ${c.border}`,
                  borderRadius: 8, padding: "10px 14px", color: c.text, fontSize: 13, outline: "none",
                }}
              />
              <button
                onClick={() => tx("Funding deal…", () => GL.fundDeal(walletAddress, provider, parseInt(deal.id), fundAmt))}
                style={{
                  background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8,
                  padding: "10px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                }}
              >
                Fund Deal
              </button>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(status === "funded" || status === "open") && !showEvidence && (
              <button
                onClick={() => setShowEvidence(true)}
                style={btnStyle(c.warn, c.surface)}
              >
                Submit Evidence
              </button>
            )}
            {status === "evidence_submitted" && isSeller && (
              <button
                onClick={() => tx("Requesting AI verification…", () => GL.requestVerification(walletAddress, provider, parseInt(deal.id)))}
                style={btnStyle(c.info, c.surface)}
              >
                Request AI Verification
              </button>
            )}
            {status === "verified" && (isSeller || isBuyer) && (
              <button
                onClick={() => tx("Settling deal…", () => GL.settleDeal(walletAddress, provider, parseInt(deal.id)))}
                style={btnStyle(c.success, c.surface)}
              >
                Settle & Release Funds
              </button>
            )}
            {status === "rejected" && isBuyer && (
              <button
                onClick={() => tx("Claiming refund…", () => GL.claimRefund(walletAddress, provider, parseInt(deal.id)))}
                style={btnStyle(c.danger, c.surface)}
              >
                Claim Refund
              </button>
            )}
            {status === "open" && isSeller && (
              <button
                onClick={() => tx("Cancelling deal…", () => GL.cancelDeal(walletAddress, provider, parseInt(deal.id)))}
                style={btnStyle(c.textFaint, c.surface)}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(color, surface) {
  return {
    background: color + "22", color: color, border: `1px solid ${color}44`,
    borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600,
  };
}

// ── Main App ──────────────────────────────────────────────────
export default function ClauseGuardApp() {
  const [theme, setTheme] = useState("dark");
  const c = T[theme];

  const [walletAddress, setWalletAddress] = useState(null);
  const [provider, setProvider] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);

  const [deals, setDeals] = useState([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealsError, setDealsError] = useState(null);

  const [tab, setTab] = useState("all"); // all | mine | create
  const [showCreate, setShowCreate] = useState(false);

  const { toasts, add: toast } = useToast();

  // ── Wallet connect ─────────────────────────────────────────
  async function connectWallet() {
    if (!window.ethereum) {
      toast("No wallet detected. Install Rabby or MetaMask.", "error");
      return;
    }
    try {
      setWalletLoading(true);
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (accounts.length === 0) throw new Error("No accounts returned");
      setWalletAddress(accounts[0]);
      setProvider(window.ethereum);
      toast("Wallet connected: " + shortAddr(accounts[0]), "success");
    } catch (err) {
      toast("Connect failed: " + err.message, "error");
    } finally {
      setWalletLoading(false);
    }
  }

  function disconnectWallet() {
    setWalletAddress(null);
    setProvider(null);
    toast("Wallet disconnected", "info");
  }

  // Listen for account changes
  useEffect(() => {
    if (!window.ethereum) return;
    const handler = (accounts) => {
      if (accounts.length === 0) disconnectWallet();
      else setWalletAddress(accounts[0]);
    };
    window.ethereum.on("accountsChanged", handler);
    return () => window.ethereum.removeListener?.("accountsChanged", handler);
  }, []);

  // ── Load deals ─────────────────────────────────────────────
  const loadDeals = useCallback(async () => {
    try {
      setDealsLoading(true);
      setDealsError(null);
      const data = await GL.fetchAllDeals();
      setDeals(Array.isArray(data) ? data : []);
    } catch (err) {
      setDealsError(err.message);
      toast("Failed to load deals: " + err.message, "error");
    } finally {
      setDealsLoading(false);
    }
  }, []);

  useEffect(() => { loadDeals(); }, [loadDeals]);

  // ── Filter deals ───────────────────────────────────────────
  const filteredDeals = deals.filter(d => {
    if (tab === "mine") {
      return walletAddress && (
        d.seller?.toLowerCase() === walletAddress.toLowerCase() ||
        d.buyer?.toLowerCase() === walletAddress.toLowerCase()
      );
    }
    return true;
  });

  // ── Styles ──────────────────────────────────────────────────
  const headerBtnBase = {
    borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
    cursor: "pointer", border: "none", transition: "opacity 0.2s",
  };

  return (
    <div style={{ minHeight: "100vh", background: c.bg, color: c.text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        input, textarea, select { color-scheme: ${theme}; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${c.border}; border-radius: 3px; }
        a { color: ${c.accent}; }
      `}</style>

      {/* ── Navbar ── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: c.surface + "ee", backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${c.border}`,
        padding: "0 24px", height: 60,
        display: "flex", alignItems: "center", gap: 16,
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `linear-gradient(135deg, ${c.accent}, #8b5cf6)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 900, color: "#fff",
          }}>C</div>
          <span style={{ fontWeight: 700, fontSize: 18, color: c.text }}>ClauseGuard</span>
          <span style={{
            fontSize: 10, fontWeight: 700, color: c.accent,
            background: c.accentBg, padding: "2px 7px", borderRadius: 4,
          }}>BRADBURY TESTNET</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
          style={{
            ...headerBtnBase,
            background: c.surfaceHover, color: c.textMuted,
            border: `1px solid ${c.border}`,
          }}
          title="Toggle theme"
        >
          {theme === "dark" ? "☀ Light" : "☾ Dark"}
        </button>

        {/* Wallet */}
        {walletAddress ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              background: c.accentBg, border: `1px solid ${c.accent}44`,
              borderRadius: 8, padding: "7px 14px", fontSize: 13, color: c.accent,
              fontFamily: "monospace",
            }}>
              {shortAddr(walletAddress)}
            </div>
            <button
              onClick={disconnectWallet}
              style={{ ...headerBtnBase, background: c.dangerBg, color: c.danger }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={connectWallet}
            disabled={walletLoading}
            style={{
              ...headerBtnBase,
              background: walletLoading ? c.textFaint : c.accent, color: "#fff",
            }}
          >
            {walletLoading ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
      </nav>

      {/* ── Hero ── */}
      <div style={{
        padding: "48px 24px 32px",
        background: `linear-gradient(180deg, ${c.accentBg} 0%, ${c.bg} 100%)`,
        textAlign: "center",
      }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, margin: "0 0 12px", color: c.text }}>
          AI-Powered Trade Escrow
        </h1>
        <p style={{ fontSize: 16, color: c.textMuted, maxWidth: 560, margin: "0 auto 28px" }}>
          Write deal terms in plain English. GenLayer validators autonomously verify conditions
          by crawling web evidence and reasoning with LLMs. Funds release automatically.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
          {[
            { label: "Total Deals", val: deals.length },
            { label: "Open",        val: deals.filter(d => d.status === "open").length },
            { label: "Settled",     val: deals.filter(d => d.status === "settled").length },
          ].map(s => (
            <div key={s.label} style={{
              background: c.surface, border: `1px solid ${c.border}`, borderRadius: 12,
              padding: "16px 28px", textAlign: "center",
            }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: c.accent }}>{s.val}</div>
              <div style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 24px 80px" }}>

        {/* Tabs + New Deal button */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, paddingTop: 24 }}>
          {[["all", "All Deals"], ["mine", "My Deals"]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: "pointer", transition: "all 0.15s",
                background: tab === key ? c.accent : "transparent",
                color: tab === key ? "#fff" : c.textMuted,
                border: tab === key ? "none" : `1px solid ${c.border}`,
              }}
            >
              {label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => loadDeals()}
            style={{
              ...headerBtnBase, background: c.surfaceHover,
              color: c.textMuted, border: `1px solid ${c.border}`,
            }}
            title="Refresh deals from chain"
          >
            ↻ Refresh
          </button>
          {walletAddress && (
            <button
              onClick={() => setShowCreate(p => !p)}
              style={{
                ...headerBtnBase,
                background: showCreate ? c.dangerBg : c.accent,
                color: showCreate ? c.danger : "#fff",
              }}
            >
              {showCreate ? "✕ Cancel" : "+ New Deal"}
            </button>
          )}
        </div>

        {/* Create deal form */}
        {showCreate && walletAddress && (
          <div style={{
            background: c.surface, border: `1px solid ${c.border}`, borderRadius: 14,
            padding: 24, marginBottom: 20,
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: c.text, marginBottom: 16 }}>
              Create New Deal
            </div>
            <CreateDealForm
              walletAddress={walletAddress}
              provider={provider}
              theme={theme}
              toast={toast}
              onSuccess={async () => { setShowCreate(false); await loadDeals(); }}
              onCancel={() => setShowCreate(false)}
            />
          </div>
        )}

        {/* Wallet prompt */}
        {!walletAddress && tab === "mine" && (
          <div style={{
            textAlign: "center", padding: "48px 24px",
            background: c.surface, borderRadius: 14, border: `1px solid ${c.border}`,
            marginBottom: 20,
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔐</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: c.text, marginBottom: 8 }}>Connect your wallet</div>
            <div style={{ fontSize: 13, color: c.textMuted, marginBottom: 20 }}>Connect Rabby or MetaMask to view your deals</div>
            <button onClick={connectWallet} style={{ ...headerBtnBase, background: c.accent, color: "#fff" }}>
              Connect Wallet
            </button>
          </div>
        )}

        {/* Loading state */}
        {dealsLoading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: c.textMuted }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%", margin: "0 auto 16px",
              border: `3px solid ${c.border}`, borderTopColor: c.accent,
              animation: "spin 0.8s linear infinite",
            }} />
            Loading deals from GenLayer Bradbury…
          </div>
        )}

        {/* Error state */}
        {dealsError && !dealsLoading && (
          <div style={{
            background: c.dangerBg, border: `1px solid ${c.danger}44`, borderRadius: 12,
            padding: "20px 24px", marginBottom: 20, color: c.danger,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Failed to load deals</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>{dealsError}</div>
            <button
              onClick={loadDeals}
              style={{ ...headerBtnBase, marginTop: 12, background: c.danger, color: "#fff" }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Deal list */}
        {!dealsLoading && !dealsError && (
          <>
            {filteredDeals.length === 0 ? (
              <div style={{
                textAlign: "center", padding: "60px 24px",
                background: c.surface, borderRadius: 14, border: `1px solid ${c.border}`,
                color: c.textMuted,
              }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: c.text, marginBottom: 8 }}>
                  {tab === "mine" ? "No deals yet" : "No deals on-chain yet"}
                </div>
                <div style={{ fontSize: 13 }}>
                  {tab === "mine" ? "Create your first deal to get started" : "Be the first to create a deal"}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {filteredDeals.slice().reverse().map(deal => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    walletAddress={walletAddress}
                    provider={provider}
                    theme={theme}
                    onRefresh={loadDeals}
                    toast={toast}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        textAlign: "center", padding: "24px", fontSize: 12,
        borderTop: `1px solid ${c.border}`, color: c.textFaint,
      }}>
        ClauseGuard · GenLayer Bradbury Testnet · Contract{" "}
        <a
          href={`https://explorer-studio.genlayer.com/address/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS}`}
          target="_blank" rel="noreferrer"
          style={{ fontFamily: "monospace", color: c.accent, textDecoration: "none" }}
        >
          {process.env.NEXT_PUBLIC_CONTRACT_ADDRESS
            ? shortAddr(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS)
            : "not configured"}
        </a>
      </div>

      <ToastContainer toasts={toasts} theme={theme} />
    </div>
  );
}
