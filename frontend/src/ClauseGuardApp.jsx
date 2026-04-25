"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import * as GL from "./lib/genlayer";
import { uploadScreenshot, validateImageFile } from "./lib/upload";

// ═══════════════════════════════════════════════════════════════
// ClauseGuard — AI-Powered P2P Trade Escrow
// Real reads/writes against GenLayer studionet
// Brand: pink #E37DF7 · purple #9B6AF6 · blue #110FFF · navy #282B5D
// ═══════════════════════════════════════════════════════════════

// ── Theme tokens ─────────────────────────────────────────────
const T = {
  dark: {
    bg:        "#07071a",
    bgElev:    "#0d0e2a",
    surface:   "#11122e",
    surfaceHi: "#181a3a",
    border:    "rgba(155,106,246,0.18)",
    borderHi:  "rgba(227,125,247,0.45)",
    text:      "#ffffff",
    textDim:   "#a8a9c8",
    textMute:  "#6e6f8e",
    accent:    "#9B6AF6",
    accent2:   "#E37DF7",
    accent3:   "#110FFF",
    navy:      "#282B5D",
    success:   "#5BE3A4",
    warn:      "#FFB547",
    danger:    "#FF6B8A",
    shadow:    "0 18px 40px -20px rgba(155,106,246,0.6), 0 6px 18px -8px rgba(0,0,0,0.6)",
  },
  light: {
    bg:        "#f5f4fb",
    bgElev:    "#ffffff",
    surface:   "#ffffff",
    surfaceHi: "#fafaff",
    border:    "rgba(40,43,93,0.12)",
    borderHi:  "rgba(155,106,246,0.55)",
    text:      "#0d0e2a",
    textDim:   "#4a4c70",
    textMute:  "#8587a8",
    accent:    "#7B4AE6",
    accent2:   "#C657E0",
    accent3:   "#110FFF",
    navy:      "#282B5D",
    success:   "#1AA86F",
    warn:      "#C97A0F",
    danger:    "#D84662",
    shadow:    "0 12px 30px -16px rgba(40,43,93,0.25), 0 4px 12px -6px rgba(40,43,93,0.12)",
  },
};

// ── Real contract status metadata ─────────────────────────────
const STATUS_META = {
  open:               { label: "Open",               tone: "open",     pipeStep: 0 },
  funded:             { label: "Funded",              tone: "funded",   pipeStep: 1 },
  evidence_submitted: { label: "Evidence",            tone: "verifying",pipeStep: 2 },
  verified:           { label: "AI Verified",         tone: "released", pipeStep: 3 },
  settled:            { label: "Settled",             tone: "released", pipeStep: 4 },
  rejected:           { label: "Rejected",            tone: "refunded", pipeStep: 3 },
  refunded:           { label: "Refunded",            tone: "refunded", pipeStep: 4 },
  disputed:           { label: "Disputed",            tone: "disputed", pipeStep: 3 },
  cancelled:          { label: "Cancelled",           tone: "default",  pipeStep: 0 },
};

const EVIDENCE_TYPES = [
  { value: "delivery_proof",  label: "Delivery Proof"   },
  { value: "quality_report",  label: "Quality Report"   },
  { value: "tracking",        label: "Shipping Tracker" },
  { value: "receipt",         label: "Receipt / Invoice"},
  { value: "other",           label: "Other"            },
];

const PIPELINE_STAGES = ["Listed", "Funded", "Evidence", "Verified", "Settled"];

function shortAddr(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

// ── Global keyframe styles ────────────────────────────────────
function GlobalStyles({ dark }) {
  return (
    <style>{`
      @import url('https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700&f[]=cabinet-grotesk@400,500,700&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Switzer', 'Inter', system-ui, sans-serif; }
      @keyframes cg-fadeup  { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
      @keyframes cg-fadein  { from { opacity:0; } to { opacity:1; } }
      @keyframes cg-shimmer { 0% { background-position:-240px 0; } 100% { background-position:240px 0; } }
      @keyframes cg-pulse   { 0%,100%{box-shadow:0 0 0 0 rgba(227,125,247,0.55),0 0 22px 4px rgba(227,125,247,0.35);} 50%{box-shadow:0 0 0 8px rgba(227,125,247,0),0 0 28px 8px rgba(155,106,246,0.55);} }
      @keyframes cg-driftA  { 0%{transform:translate(0,0)scale(1);} 50%{transform:translate(8%,-6%)scale(1.15);} 100%{transform:translate(0,0)scale(1);} }
      @keyframes cg-driftB  { 0%{transform:translate(0,0)scale(1);} 50%{transform:translate(-10%,8%)scale(1.1);} 100%{transform:translate(0,0)scale(1);} }
      @keyframes cg-driftC  { 0%{transform:translate(0,0)scale(1);} 50%{transform:translate(6%,10%)scale(1.2);} 100%{transform:translate(0,0)scale(1);} }
      @keyframes spin        { to { transform:rotate(360deg); } }
      @keyframes cg-orbit    { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
      @keyframes cg-sweep    { 0%{transform:translateX(-100%);} 100%{transform:translateX(100%);} }
      .cg-card-hover { transition: transform 240ms cubic-bezier(.2,.8,.2,1), box-shadow 240ms ease, border-color 240ms ease; }
      .cg-card-hover:hover { transform: translateY(-2px); }
      .cg-btn { transition: transform 160ms ease, box-shadow 220ms ease, background 220ms ease, color 220ms ease; }
      .cg-btn:hover:not(:disabled) { transform: translateY(-1px); }
      .cg-btn:active:not(:disabled) { transform: translateY(0); }
      .cg-btn:disabled { opacity: 0.5; cursor: not-allowed !important; }
      input, textarea, select { color-scheme: ${dark ? "dark" : "light"}; font-family: inherit; }
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(155,106,246,0.3); border-radius: 3px; }
      *::selection { background: rgba(227,125,247,0.4); color: #fff; }
      a { color: inherit; }
    `}</style>
  );
}

// ── Brand mark ────────────────────────────────────────────────
function ClauseGuardMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id="cg-pink" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#E37DF7" />
          <stop offset="1" stopColor="#9B6AF6" />
        </linearGradient>
        <linearGradient id="cg-blue" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#9B6AF6" />
          <stop offset="1" stopColor="#110FFF" />
        </linearGradient>
      </defs>
      <path d="M8 14 L32 30 L8 46 L8 36 L20 30 L8 24 Z" fill="url(#cg-pink)" />
      <path d="M56 14 L32 30 L56 46 L56 36 L44 30 L56 24 Z" fill="url(#cg-blue)" />
      <path d="M32 22 L38 34 L26 34 Z" fill="#fff">
        <animate attributeName="opacity" values="1;0.55;1" dur="3.2s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

// ── Mochi mascot ──────────────────────────────────────────────
function Mochi({ size = 140 }) {
  return (
    <svg width={size} height={size * 1.05} viewBox="0 0 200 210" fill="none" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id="m-ear" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#E37DF7"/><stop offset="1" stopColor="#9B6AF6"/></linearGradient>
        <linearGradient id="m-body" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#FAFBFF"/><stop offset="1" stopColor="#E5E7F4"/></linearGradient>
        <linearGradient id="m-armor" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#C5C8DA"/><stop offset="1" stopColor="#7F84A0"/></linearGradient>
        <linearGradient id="m-visor" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0d2447"/><stop offset="1" stopColor="#1a1d3d"/></linearGradient>
      </defs>
      <path d="M150 150 Q180 145 188 165 Q193 180 178 188 Q170 192 168 184 Q176 180 178 172 Q179 164 170 162 Q160 162 152 168 Z" fill="#0A0B1F"/>
      <ellipse cx="78" cy="178" rx="14" ry="14" fill="#FAFBFF" stroke="#7F84A0" strokeWidth="1"/>
      <ellipse cx="118" cy="178" rx="14" ry="14" fill="#FAFBFF" stroke="#7F84A0" strokeWidth="1"/>
      <path d="M58 120 Q58 85 98 85 Q138 85 138 120 L138 165 Q138 178 98 178 Q58 178 58 165 Z" fill="url(#m-body)" stroke="#7F84A0" strokeWidth="1"/>
      <path d="M70 110 Q70 95 98 95 Q126 95 126 110 L126 132 Q126 138 98 138 Q70 138 70 132 Z" fill="url(#m-armor)" opacity="0.55"/>
      <g transform="translate(98 122) scale(0.55)">
        <path d="M-30 -16 L0 0 L-30 16 L-30 8 L-15 0 L-30 -8 Z" fill="#E37DF7"/>
        <path d="M30 -16 L0 0 L30 16 L30 8 L15 0 L30 -8 Z" fill="#110FFF"/>
        <path d="M0 -10 L7 5 L-7 5 Z" fill="#fff"/>
      </g>
      <g><ellipse cx="48" cy="142" rx="16" ry="13" fill="url(#m-armor)" stroke="#7F84A0" strokeWidth="1"/><circle cx="44" cy="138" r="2.4" fill="#7BE9F0"/><circle cx="50" cy="135" r="2.4" fill="#7BE9F0"/><circle cx="55" cy="139" r="2.4" fill="#7BE9F0"/><ellipse cx="50" cy="146" rx="4" ry="2.6" fill="#7BE9F0"/></g>
      <g><circle cx="143" cy="132" r="6" fill="#7BE9F0" opacity="0.85"/><circle cx="143" cy="132" r="2.5" fill="#fff"/></g>
      <circle cx="100" cy="62" r="46" fill="url(#m-armor)" opacity="0.9"/>
      <path d="M62 30 L58 8 L82 22 Z" fill="url(#m-ear)"/>
      <path d="M138 30 L142 8 L118 22 Z" fill="url(#m-ear)"/>
      <path d="M70 50 Q70 36 100 36 Q130 36 130 50 L130 78 Q130 88 100 88 Q70 88 70 78 Z" fill="url(#m-visor)"/>
      <path d="M82 56 L96 58 L94 70 L82 66 Z" fill="#7BE9F0"><animate attributeName="opacity" values="1;1;0.2;1;1" dur="5s" repeatCount="indefinite"/></path>
      <path d="M118 56 L104 58 L106 70 L118 66 Z" fill="#7BE9F0"><animate attributeName="opacity" values="1;1;0.2;1;1" dur="5s" repeatCount="indefinite"/></path>
      <path d="M94 78 L100 82 L106 78" stroke="#7BE9F0" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <line x1="100" y1="16" x2="100" y2="6" stroke="#7F84A0" strokeWidth="1.5"/>
      <circle cx="100" cy="5" r="2.5" fill="#E37DF7"><animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite"/></circle>
    </svg>
  );
}

// ── Icon set ──────────────────────────────────────────────────
function Icon({ name, size = 18, color = "currentColor" }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "plus":   return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case "shield": return <svg {...p}><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6l8-3z"/></svg>;
    case "check":  return <svg {...p}><path d="M5 12l4 4 10-10"/></svg>;
    case "x":      return <svg {...p}><path d="M6 6l12 12M18 6l-12 12"/></svg>;
    case "wallet": return <svg {...p}><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/></svg>;
    case "doc":    return <svg {...p}><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z"/><path d="M14 3v6h6M9 14h6M9 18h6"/></svg>;
    case "upload": return <svg {...p}><path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 18v2a1 1 0 001 1h14a1 1 0 001-1v-2"/></svg>;
    case "spark":  return <svg {...p}><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>;
    case "arrowR": return <svg {...p}><path d="M5 12h14M13 5l7 7-7 7"/></svg>;
    case "sun":    return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>;
    case "moon":   return <svg {...p}><path d="M21 13a8 8 0 11-9-9 6 6 0 009 9z"/></svg>;
    case "globe":  return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>;
    case "refresh":return <svg {...p}><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"/></svg>;
    case "link":   return <svg {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>;
    default: return null;
  }
}

// ── Primitive: Btn ────────────────────────────────────────────
function Btn({ kind = "primary", size = "md", children, icon, iconRight, c, style, ...rest }) {
  const sizes = { sm: { p: "7px 13px", f: 12 }, md: { p: "11px 20px", f: 14 }, lg: { p: "15px 28px", f: 15 } };
  const s = sizes[size] || sizes.md;
  const base = { fontFamily: "inherit", fontWeight: 600, fontSize: s.f, padding: s.p, borderRadius: 999, border: "1px solid transparent", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, letterSpacing: "-0.01em", lineHeight: 1, ...style };
  let palette;
  if (kind === "primary")  palette = { background: `linear-gradient(135deg, ${c.accent2} 0%, ${c.accent} 50%, ${c.accent3} 120%)`, color: "#fff", boxShadow: `0 6px 18px -8px ${c.accent}` };
  else if (kind === "ghost")  palette = { background: "transparent", color: c.text, border: `1px solid ${c.border}` };
  else if (kind === "subtle") palette = { background: c.surface, color: c.text, border: `1px solid ${c.border}` };
  else if (kind === "danger") palette = { background: "transparent", color: c.danger, border: `1px solid ${c.danger}55` };
  else if (kind === "success")palette = { background: `${c.success}22`, color: c.success, border: `1px solid ${c.success}55` };
  return (
    <button className="cg-btn" style={{ ...base, ...palette }} {...rest}>
      {icon && <Icon name={icon} size={s.f + 2} />}
      {children}
      {iconRight && <Icon name={iconRight} size={s.f + 2} />}
    </button>
  );
}

// ── Primitive: Card ───────────────────────────────────────────
function Card({ children, c, style, hover = false, onClick, ...rest }) {
  return (
    <div
      className={hover ? "cg-card-hover" : ""}
      style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 18, padding: 22, boxShadow: c.shadow, ...style }}
      onClick={onClick}
      onMouseEnter={hover ? (e) => { e.currentTarget.style.borderColor = c.borderHi; } : undefined}
      onMouseLeave={hover ? (e) => { e.currentTarget.style.borderColor = c.border; } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

// ── Primitive: Pill ───────────────────────────────────────────
function Pill({ children, c, tone = "default", style }) {
  const tones = {
    default:   { bg: c.surfaceHi, fg: c.textDim,  br: c.border },
    open:      { bg: "rgba(59,130,246,0.10)",  fg: "#60a5fa", br: "rgba(59,130,246,0.35)" },
    funded:    { bg: "rgba(91,227,164,0.10)",  fg: c.success,  br: "rgba(91,227,164,0.3)" },
    verifying: { bg: "rgba(227,125,247,0.10)", fg: c.accent2,  br: "rgba(227,125,247,0.35)" },
    released:  { bg: "rgba(91,227,164,0.14)",  fg: c.success,  br: "rgba(91,227,164,0.4)" },
    refunded:  { bg: "rgba(255,107,138,0.10)", fg: c.danger,   br: "rgba(255,107,138,0.35)" },
    disputed:  { bg: "rgba(255,181,71,0.10)",  fg: c.warn,     br: "rgba(255,181,71,0.35)" },
  };
  const t = tones[tone] || tones.default;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: t.bg, color: t.fg, border: `1px solid ${t.br}`, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", ...style }}>
      {tone === "verifying" && <span style={{ width: 6, height: 6, borderRadius: 99, background: t.fg, animation: "cg-pulse 1.6s ease-in-out infinite" }} />}
      {children}
    </span>
  );
}

// ── Deal pipeline ─────────────────────────────────────────────
function Pipeline({ c, status }) {
  const meta = STATUS_META[status] || STATUS_META.open;
  const currentIndex = meta.pipeStep;
  const isError = ["rejected", "disputed", "cancelled"].includes(status);
  const isRefunded = status === "refunded";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, width: "100%" }}>
      {PIPELINE_STAGES.map((label, i) => {
        const done   = i < currentIndex;
        const active = i === currentIndex && !isError;
        const errAt  = isError && i === currentIndex;
        const fg = errAt ? c.danger : done ? c.success : active ? c.accent2 : c.textMute;
        const bg = errAt ? c.danger : done ? c.success : active ? `linear-gradient(135deg, ${c.accent2}, ${c.accent})` : c.surfaceHi;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: i < PIPELINE_STAGES.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, minWidth: 64 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 99, background: bg,
                border: active ? "none" : done ? "none" : `1px solid ${c.border}`,
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700,
                animation: active ? "cg-pulse 1.6s ease-in-out infinite" : undefined,
              }}>
                {done && !isError ? <Icon name="check" size={14} color="#fff" /> : (i + 1)}
              </div>
              <span style={{ fontSize: 10, color: fg, fontWeight: active ? 700 : 500, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</span>
            </div>
            {i < PIPELINE_STAGES.length - 1 && (
              <div style={{ flex: 1, height: 2, marginBottom: 22, marginInline: 2, background: done ? c.success : c.border, borderRadius: 2, position: "relative", overflow: "hidden" }}>
                {active && (
                  <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, transparent, ${c.accent2}, transparent)`, animation: "cg-sweep 1.6s ease-in-out infinite" }} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Dialog ────────────────────────────────────────────────────
function Dialog({ c, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(7,7,26,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "4vh 20px", animation: "cg-fadein 220ms ease both" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", width: "100%", maxWidth: wide ? 860 : 600, maxHeight: "92vh", overflowY: "auto", background: c.bgElev, border: `1px solid ${c.border}`, borderRadius: 22, boxShadow: "0 40px 80px -20px rgba(0,0,0,0.7)", animation: "cg-fadeup 320ms ease both" }}
      >
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, zIndex: 2, width: 32, height: 32, borderRadius: 99, background: "transparent", color: c.textDim, border: `1px solid ${c.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Icon name="x" size={14} />
        </button>
        {children}
      </div>
    </div>
  );
}

// ── Toast stack ───────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, kind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, msg, kind }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 5000);
  }, []);
  return { toasts, add };
}

function ToastStack({ toasts, c }) {
  return (
    <div style={{ position: "fixed", top: 80, right: 24, zIndex: 300, display: "flex", flexDirection: "column", gap: 10, width: 320 }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          padding: "14px 16px", borderRadius: 12, animation: "cg-fadeup 280ms ease both",
          background: c.bgElev,
          border: `1px solid ${t.kind === "error" ? "rgba(255,107,138,0.4)" : t.kind === "success" ? "rgba(91,227,164,0.4)" : c.borderHi}`,
          boxShadow: "0 12px 28px -8px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: t.kind === "error" ? c.danger : t.kind === "success" ? c.success : c.accent2, marginBottom: 3 }}>
            {t.kind === "success" ? "✓ " : t.kind === "error" ? "✕ " : "· "}{t.kind.charAt(0).toUpperCase() + t.kind.slice(1)}
          </div>
          <div style={{ fontSize: 13, color: c.textDim, lineHeight: 1.4 }}>{t.msg}</div>
        </div>
      ))}
    </div>
  );
}

// ── Tx spinner overlay ────────────────────────────────────────
function TxOverlay({ msg, c }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(7,7,26,0.8)", zIndex: 500, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, backdropFilter: "blur(6px)" }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", border: `4px solid ${c.border}`, borderTopColor: c.accent2, animation: "spin 0.9s linear infinite" }} />
      <div style={{ color: c.text, fontSize: 16, fontWeight: 500 }}>{msg}</div>
      <div style={{ color: c.textMute, fontSize: 13 }}>Waiting for GenLayer consensus…</div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────
function Header({ c, dark, onToggleTheme, walletAddress, walletLoading, onConnect, onDisconnect, onCreate, onRefresh }) {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 100,
      backdropFilter: "saturate(140%) blur(18px)",
      WebkitBackdropFilter: "saturate(140%) blur(18px)",
      background: dark ? "rgba(7,7,26,0.78)" : "rgba(245,244,251,0.85)",
      borderBottom: `1px solid ${c.border}`,
    }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "13px 28px", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ClauseGuardMark size={32} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em", color: c.text }}>clauseguard</span>
            <span style={{ fontSize: 10, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", marginTop: 3 }}>studionet · testnet</span>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <button className="cg-btn" onClick={onRefresh} style={{ background: "transparent", border: `1px solid ${c.border}`, borderRadius: 99, width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", color: c.textDim, cursor: "pointer" }} title="Refresh deals">
          <Icon name="refresh" size={15} />
        </button>

        <button className="cg-btn" onClick={onToggleTheme} style={{ background: "transparent", border: `1px solid ${c.border}`, borderRadius: 99, width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", color: c.textDim, cursor: "pointer" }}>
          <Icon name={dark ? "sun" : "moon"} size={15} />
        </button>

        {walletAddress ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 6px", borderRadius: 99, background: c.surface, border: `1px solid ${c.border}` }}>
              <div style={{ width: 24, height: 24, borderRadius: 99, background: `linear-gradient(135deg, ${c.accent2}, ${c.accent3})`, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: c.text, fontFamily: "ui-monospace, monospace" }}>{shortAddr(walletAddress)}</span>
            </div>
            <button className="cg-btn" onClick={onDisconnect} style={{ background: "transparent", border: `1px solid ${c.border}`, borderRadius: 99, padding: "7px 14px", color: c.danger, fontSize: 12, cursor: "pointer" }}>Disconnect</button>
          </div>
        ) : (
          <Btn kind="ghost" c={c} icon="wallet" onClick={onConnect} disabled={walletLoading}>
            {walletLoading ? "Connecting…" : "Connect wallet"}
          </Btn>
        )}

        <Btn kind="primary" c={c} icon="plus" onClick={onCreate} disabled={!walletAddress}>New deal</Btn>
      </div>
    </header>
  );
}

// ── Hero section ──────────────────────────────────────────────
function Hero({ c, dark, deals, onCreateClick, onConnectClick, walletAddress }) {
  const stats = [
    { label: "Total Deals",  val: deals.length },
    { label: "Open",         val: deals.filter((d) => d.status === "open").length },
    { label: "Settled",      val: deals.filter((d) => d.status === "settled").length },
    { label: "Verified",     val: deals.filter((d) => d.status === "verified").length },
  ];

  return (
    <section style={{ position: "relative", overflow: "hidden", padding: "72px 28px 80px", borderBottom: `1px solid ${c.border}` }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-20%", left: "-10%", width: 680, height: 680, borderRadius: "50%", background: `radial-gradient(circle at 30% 30%, ${c.accent2}bb 0%, ${c.accent2}00 60%)`, filter: "blur(40px)", animation: "cg-driftA 14s ease-in-out infinite", opacity: dark ? 0.5 : 0.25 }} />
        <div style={{ position: "absolute", top: "10%", right: "-10%", width: 760, height: 760, borderRadius: "50%", background: `radial-gradient(circle at 60% 40%, ${c.accent}cc 0%, ${c.accent}00 65%)`, filter: "blur(48px)", animation: "cg-driftB 18s ease-in-out infinite", opacity: dark ? 0.5 : 0.28 }} />
        <div style={{ position: "absolute", bottom: "-30%", left: "20%", width: 820, height: 820, borderRadius: "50%", background: `radial-gradient(circle at 50% 50%, ${c.accent3}99 0%, ${c.accent3}00 60%)`, filter: "blur(56px)", animation: "cg-driftC 22s ease-in-out infinite", opacity: dark ? 0.4 : 0.18 }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(${dark ? "rgba(255,255,255,0.05)" : "rgba(40,43,93,0.08)"} 1px, transparent 1px)`, backgroundSize: "22px 22px", maskImage: "radial-gradient(ellipse at center, black 30%, transparent 72%)", WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 72%)" }} />
      </div>

      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ animation: "cg-fadeup 700ms ease both", maxWidth: 820 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px 5px 8px", borderRadius: 99, background: dark ? "rgba(255,255,255,0.06)" : "rgba(40,43,93,0.06)", border: `1px solid ${c.border}`, marginBottom: 24 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: c.success, boxShadow: `0 0 8px ${c.success}` }} />
            <span style={{ fontSize: 11, color: c.textDim, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>Live on GenLayer Studionet</span>
          </div>

          <h1 style={{ fontWeight: 800, fontSize: "clamp(48px, 7vw, 88px)", lineHeight: 0.96, letterSpacing: "-0.03em", color: c.text, margin: 0 }}>
            Escrow that{" "}
            <span style={{ background: `linear-gradient(120deg, ${c.accent2} 0%, ${c.accent} 50%, ${c.accent3} 100%)`, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>reads English.</span>
          </h1>

          <p style={{ maxWidth: 540, marginTop: 22, fontSize: 18, lineHeight: 1.55, color: c.textDim }}>
            Write deal terms in plain language. Lock funds on-chain. A network of AI validators crawls the web, reasons over evidence, and releases — or refunds — autonomously.
          </p>

          <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
            {walletAddress ? (
              <Btn kind="primary" size="lg" c={c} iconRight="arrowR" onClick={onCreateClick}>Create a deal</Btn>
            ) : (
              <Btn kind="primary" size="lg" c={c} icon="wallet" onClick={onConnectClick}>Connect wallet to start</Btn>
            )}
            <Btn kind="ghost" size="lg" c={c} icon="globe" onClick={() => window.open(`https://explorer-studio.genlayer.com/address/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS}`, "_blank")}>
              View contract
            </Btn>
          </div>
        </div>

        <div style={{ display: "flex", gap: 32, marginTop: 56, flexWrap: "wrap" }}>
          {stats.map((s, i) => (
            <div key={s.label} style={{ animation: `cg-fadeup 700ms ${200 + i * 120}ms ease both` }}>
              <div style={{ fontWeight: 800, fontSize: 36, color: c.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.val}</div>
              <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", marginTop: 6, fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Evidence upload form ──────────────────────────────────────
function EvidenceForm({ deal, walletAddress, provider, c, onSuccess, onCancel, toast }) {
  const [evType, setEvType] = useState("delivery_proof");
  const [evUrl, setEvUrl] = useState("");
  const [evDesc, setEvDesc] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef(null);

  const inp = { background: c.bgElev, border: `1px solid ${c.border}`, borderRadius: 10, padding: "11px 14px", color: c.text, fontSize: 14, width: "100%", outline: "none", transition: "border-color 200ms" };

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      validateImageFile(file);
      setUploading(true);
      const url = await uploadScreenshot(file);
      setEvUrl(url);
      toast("Screenshot uploaded", "success");
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
      toast("Evidence submitted on-chain", "success");
      onSuccess();
    } catch (err) {
      toast(err.message || "Submit failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 8 }}>Evidence Type</label>
        <select value={evType} onChange={(e) => setEvType(e.target.value)} style={{ ...inp, appearance: "none" }}>
          {EVIDENCE_TYPES.map((et) => <option key={et.value} value={et.value}>{et.label}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 8 }}>Evidence URL</label>
        <input value={evUrl} onChange={(e) => setEvUrl(e.target.value)} placeholder="https://tracking.dhl.com/... or paste imgbb URL" style={inp} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
      </div>
      <div>
        <label style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 8 }}>Upload Screenshot</label>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: "none" }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ ...inp, cursor: uploading ? "wait" : "pointer", textAlign: "left", border: `1px dashed ${c.border}`, color: c.textDim }}>
          {uploading ? "Uploading…" : "📎 Choose image (JPEG / PNG / WebP, max 32MB)"}
        </button>
        {evUrl && evUrl.startsWith("https://i.ibb.co") && (
          <div style={{ marginTop: 6, fontSize: 11, color: c.success }}>✓ Uploaded: <a href={evUrl} target="_blank" rel="noreferrer" style={{ color: c.accent }}>{evUrl}</a></div>
        )}
      </div>
      <div>
        <label style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 8 }}>Description</label>
        <textarea value={evDesc} onChange={(e) => setEvDesc(e.target.value)} placeholder="Brief description of what this evidence shows…" rows={3} style={{ ...inp, resize: "vertical" }} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn kind="ghost" c={c} onClick={onCancel} style={{ flex: 1 }}>Cancel</Btn>
        <Btn kind="primary" c={c} onClick={handleSubmit} disabled={submitting} style={{ flex: 2 }}>
          {submitting ? "Submitting…" : "Submit On-Chain"}
        </Btn>
      </div>
    </div>
  );
}

// ── Create deal dialog ────────────────────────────────────────
function CreateDealDialog({ c, walletAddress, provider, onClose, onSuccess, toast }) {
  const [terms, setTerms] = useState("");
  const [price, setPrice] = useState("");
  const [deadline, setDeadline] = useState("");
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);

  const inp = { background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "11px 14px", color: c.text, fontSize: 14, width: "100%", outline: "none", transition: "border-color 200ms", fontFamily: "inherit" };

  async function handleCreate() {
    if (!terms.trim())    { toast("Deal terms are required", "error"); return; }
    if (!price.trim())    { toast("Price description is required", "error"); return; }
    if (!deadline.trim()) { toast("Deadline is required", "error"); return; }
    try {
      setLoading(true);
      const urlArray = urls.split(",").map((u) => u.trim()).filter(Boolean);
      await GL.createDeal(walletAddress, provider, {
        terms: terms.trim(),
        priceDescription: price.trim(),
        deadlineDescription: deadline.trim(),
        verificationUrls: urlArray,
      });
      toast("Deal created on-chain", "success");
      onSuccess();
    } catch (err) {
      toast(err.message || "Create failed", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog c={c} onClose={onClose}>
      <div style={{ padding: "28px 32px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <Icon name="plus" size={20} color={c.accent2} />
          <h2 style={{ fontWeight: 700, fontSize: 26, letterSpacing: "-0.02em", color: c.text }}>New escrow deal</h2>
        </div>
        <p style={{ color: c.textDim, fontSize: 14, lineHeight: 1.5 }}>Write your terms in plain English. Validators will read them exactly as-is.</p>
      </div>

      <div style={{ padding: "0 32px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 8 }}>Deal Terms <span style={{ color: c.danger }}>*</span></label>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Describe exactly what must happen for funds to be released. Be specific — AI validators will read this verbatim." rows={5} style={{ ...inp, resize: "vertical" }} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
          <div style={{ marginTop: 5, fontSize: 11, color: c.textMute }}>{terms.length} chars · validators read this verbatim</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 8 }}>Price / Amount <span style={{ color: c.danger }}>*</span></label>
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 1.5 GEN" style={inp} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 8 }}>Deadline <span style={{ color: c.danger }}>*</span></label>
            <input value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="e.g. May 15, 2026" style={inp} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 8 }}>Verification URLs <span style={{ color: c.textMute, fontWeight: 400 }}>(comma-separated — validators crawl these)</span></label>
          <input value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://track.dhl.com/123, https://yoursite.com/order/456" style={inp} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
        </div>
      </div>

      <div style={{ padding: "18px 32px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${c.border}`, gap: 12 }}>
        <span style={{ fontSize: 12, color: c.textMute }}>Deal visible to buyers immediately after creation</span>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn kind="ghost" c={c} onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" c={c} onClick={handleCreate} disabled={loading || !terms || !price || !deadline}>
            {loading ? "Creating on-chain…" : "Create deal"}
          </Btn>
        </div>
      </div>
    </Dialog>
  );
}

// ── Deal detail dialog ────────────────────────────────────────
function DealDetailDialog({ c, deal, walletAddress, provider, onClose, onRefresh, toast }) {
  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const [fundAmt, setFundAmt] = useState("");
  const [txMsg, setTxMsg] = useState(null);

  const status = deal.status || "open";
  const isAddr = (a) => a && walletAddress && a.toLowerCase() === walletAddress.toLowerCase();
  const isSeller = isAddr(deal.seller);
  const isBuyer  = isAddr(deal.buyer);
  const isParty  = isSeller || isBuyer;

  let evidence = [];
  try { evidence = JSON.parse(deal.evidence || "[]"); } catch {}

  let verdictDetails = null;
  try { verdictDetails = deal.verdict_details ? JSON.parse(deal.verdict_details) : null; } catch {}

  const meta = STATUS_META[status] || STATUS_META.open;

  async function tx(label, fn) {
    try {
      setTxMsg(label);
      await fn();
      toast(label + " complete", "success");
      onRefresh();
      onClose();
    } catch (err) {
      toast(err.message || "Transaction failed", "error");
    } finally {
      setTxMsg(null);
    }
  }

  const inp = { background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "10px 14px", color: c.text, fontSize: 14, outline: "none", flex: 1, fontFamily: "inherit" };

  return (
    <Dialog c={c} onClose={onClose} wide>
      {txMsg && <TxOverlay msg={txMsg} c={c} />}

      {/* Header */}
      <div style={{ padding: "24px 32px", borderBottom: `1px solid ${c.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <Pill c={c} tone={meta.tone}>{meta.label}</Pill>
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: c.textMute }}>Deal #{deal.id}</span>
          <span style={{ flex: 1 }} />
          {deal.price_description && (
            <span style={{ fontWeight: 700, fontSize: 20, color: c.text }}>{deal.price_description}</span>
          )}
        </div>
        <p style={{ fontSize: 15, color: c.textDim, lineHeight: 1.6, maxWidth: 720, fontStyle: "italic", borderLeft: `2px solid ${c.borderHi}`, paddingLeft: 14 }}>
          "{deal.terms}"
        </p>
        <div style={{ display: "flex", gap: 18, marginTop: 14, fontSize: 12, color: c.textMute }}>
          {deal.deadline_description && <span>⏰ Deadline: <span style={{ color: c.text }}>{deal.deadline_description}</span></span>}
          <span>Seller: <span style={{ color: isSeller ? c.accent : c.text, fontFamily: "ui-monospace, monospace" }}>{shortAddr(deal.seller)}{isSeller ? " (you)" : ""}</span></span>
          {deal.buyer && <span>Buyer: <span style={{ color: isBuyer ? c.accent : c.text, fontFamily: "ui-monospace, monospace" }}>{shortAddr(deal.buyer)}{isBuyer ? " (you)" : ""}</span></span>}
        </div>
      </div>

      {/* Pipeline */}
      {isParty && (
        <div style={{ padding: "22px 32px", borderBottom: `1px solid ${c.border}` }}>
          <Pipeline c={c} status={status} />
          {status === "evidence_submitted" && (
            <div style={{ marginTop: 14, fontSize: 12, color: c.warn, fontWeight: 600 }}>⏳ Evidence submitted — seller can request AI verification</div>
          )}
        </div>
      )}

      <div style={{ padding: "20px 32px 28px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
        {/* Left: Evidence */}
        <div>
          <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>Evidence ({evidence.length})</div>

          {evidence.length === 0 && !showEvidenceForm && (
            <div style={{ padding: 20, borderRadius: 12, border: `1px dashed ${c.border}`, color: c.textMute, fontSize: 13, textAlign: "center" }}>No evidence submitted yet.</div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {evidence.map((ev, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 13px", background: c.surface, border: `1px solid ${c.border}`, borderRadius: 10 }}>
                <Icon name="doc" size={15} color={c.accent2} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: c.textMute, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>{(ev.type || ev.evidence_type || "other").replace(/_/g, " ")}</div>
                  {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: c.accent, wordBreak: "break-all", display: "block" }}>{ev.url.slice(0, 60)}{ev.url.length > 60 ? "…" : ""}</a>}
                  {ev.description && <div style={{ marginTop: 3, fontSize: 12, color: c.textDim }}>{ev.description}</div>}
                </div>
              </div>
            ))}
          </div>

          {showEvidenceForm ? (
            <div style={{ marginTop: 12, padding: 16, background: c.surface, border: `1px solid ${c.border}`, borderRadius: 12 }}>
              <EvidenceForm deal={deal} walletAddress={walletAddress} provider={provider} c={c} toast={toast} onSuccess={async () => { setShowEvidenceForm(false); onRefresh(); }} onCancel={() => setShowEvidenceForm(false)} />
            </div>
          ) : (
            isParty && ["funded", "evidence_submitted", "open"].includes(status) && walletAddress && (
              <Btn kind="ghost" c={c} icon="upload" style={{ marginTop: 12 }} onClick={() => setShowEvidenceForm(true)}>Attach evidence</Btn>
            )
          )}

          {/* Verification URLs */}
          {deal.verification_urls && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Verification URLs</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(Array.isArray(deal.verification_urls) ? deal.verification_urls : deal.verification_urls.split(",")).filter(Boolean).map((u, i) => (
                  <a key={i} href={u.trim()} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: c.accent, textDecoration: "none", background: c.surface, padding: "4px 10px", borderRadius: 99, border: `1px solid ${c.border}` }}>
                    <Icon name="link" size={11} />{u.trim().slice(0, 35)}{u.trim().length > 35 ? "…" : ""}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div>
          <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>Actions</div>

          {/* AI verdict */}
          {verdictDetails && (
            <div style={{ padding: "14px 16px", borderRadius: 12, border: `1px solid ${deal.verdict === "approved" ? "rgba(91,227,164,0.4)" : "rgba(255,107,138,0.4)"}`, background: deal.verdict === "approved" ? "rgba(91,227,164,0.06)" : "rgba(255,107,138,0.06)", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: deal.verdict === "approved" ? c.success : c.danger, marginBottom: 8 }}>
                {deal.verdict === "approved" ? "✓ AI: Conditions Met" : "✕ AI: Conditions Not Met"}
              </div>
              <div style={{ fontSize: 12, color: c.textDim, lineHeight: 1.55 }}>{verdictDetails.reasoning || deal.verdict_details}</div>
              {verdictDetails.unmet_conditions?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: c.warn, fontWeight: 600, marginBottom: 4 }}>Unmet:</div>
                  {verdictDetails.unmet_conditions.map((u, i) => <div key={i} style={{ fontSize: 12, color: c.textDim }}>· {u}</div>)}
                </div>
              )}
              {verdictDetails.confidence && <div style={{ marginTop: 6, fontSize: 11, color: c.textMute }}>Confidence: <span style={{ color: c.text, fontWeight: 600 }}>{verdictDetails.confidence}</span></div>}
            </div>
          )}

          {/* Fund form */}
          {status === "open" && !isSeller && walletAddress && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Fund this deal</div>
              <div style={{ fontSize: 12, color: c.textDim, marginBottom: 10 }}>Amount in GEN (1 GEN = 1×10¹⁸ wei)</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={fundAmt} onChange={(e) => setFundAmt(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 1.5" style={{ ...inp }} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
                <Btn kind="primary" c={c} onClick={() => {
                  const wei = BigInt(Math.round(parseFloat(fundAmt || "0") * 1e18));
                  tx("Funding deal…", () => GL.fundDeal(walletAddress, provider, parseInt(deal.id), wei.toString()));
                }} disabled={!fundAmt || parseFloat(fundAmt) <= 0}>Fund</Btn>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {status === "evidence_submitted" && isSeller && (
              <Btn kind="primary" c={c} icon="spark" onClick={() => tx("Requesting AI verification…", () => GL.requestVerification(walletAddress, provider, parseInt(deal.id)))}>
                Request AI Verification
              </Btn>
            )}
            {status === "verified" && isParty && (
              <Btn kind="success" c={c} icon="check" onClick={() => tx("Settling deal…", () => GL.settleDeal(walletAddress, provider, parseInt(deal.id)))}>
                Settle & Release Funds
              </Btn>
            )}
            {status === "rejected" && isBuyer && (
              <Btn kind="danger" c={c} icon="x" onClick={() => tx("Claiming refund…", () => GL.claimRefund(walletAddress, provider, parseInt(deal.id)))}>
                Claim Refund
              </Btn>
            )}
            {status === "open" && isSeller && (
              <Btn kind="danger" c={c} onClick={() => tx("Cancelling deal…", () => GL.cancelDeal(walletAddress, provider, parseInt(deal.id)))}>
                Cancel Deal
              </Btn>
            )}
            {!walletAddress && (
              <div style={{ fontSize: 13, color: c.textMute, fontStyle: "italic" }}>Connect wallet to take actions on this deal.</div>
            )}
            {walletAddress && !isParty && status === "open" && (
              <div style={{ fontSize: 13, color: c.textMute }}>Fund this deal above to become the buyer.</div>
            )}
            {walletAddress && !isParty && status !== "open" && (
              <div style={{ fontSize: 13, color: c.textMute, fontStyle: "italic" }}>You are not a party to this deal.</div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ── Deal card ─────────────────────────────────────────────────
function DealCard({ deal, walletAddress, c, index = 0, onOpen }) {
  const status = deal.status || "open";
  const meta   = STATUS_META[status] || STATUS_META.open;
  const isAddr = (a) => a && walletAddress && a.toLowerCase() === walletAddress.toLowerCase();
  const isSeller = isAddr(deal.seller);
  const isBuyer  = isAddr(deal.buyer);

  return (
    <div style={{ animation: `cg-fadeup 600ms ${80 * index}ms ease both` }}>
      <Card c={c} hover onClick={() => onOpen(deal)} style={{ cursor: "pointer", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 14, right: 14, width: 8, height: 8, borderRadius: 99, background: meta.tone === "verifying" ? c.accent2 : meta.tone === "funded" || meta.tone === "released" ? c.success : c.textMute, boxShadow: meta.tone === "verifying" ? `0 0 10px ${c.accent2}` : "none" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: c.textMute }}>#{deal.id}</span>
          <span style={{ flex: 1 }} />
          <Pill c={c} tone={meta.tone}>{meta.label}</Pill>
          {(isSeller || isBuyer) && (
            <span style={{ fontSize: 10, color: c.accent, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", background: `${c.accent}18`, padding: "3px 7px", borderRadius: 99 }}>
              {isSeller ? "Your deal" : "Funding"}
            </span>
          )}
        </div>

        <p style={{ margin: 0, fontSize: 15, color: c.text, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {deal.terms}
        </p>

        <div style={{ height: 1, background: c.border, margin: "16px 0 14px" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            {deal.price_description && (
              <>
                <div style={{ fontSize: 10, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}>Amount</div>
                <div style={{ fontWeight: 700, fontSize: 18, color: c.text, lineHeight: 1, marginTop: 4 }}>{deal.price_description}</div>
              </>
            )}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}>Seller</div>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: c.textDim, marginTop: 4 }}>{shortAddr(deal.seller)}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Skeleton card ─────────────────────────────────────────────
function SkeletonCard({ c }) {
  const shimmer = { background: `linear-gradient(90deg, ${c.surface} 0%, ${c.surfaceHi} 40%, ${c.surface} 80%)`, backgroundSize: "240px 100%", animation: "cg-shimmer 1.4s linear infinite", borderRadius: 8 };
  return (
    <Card c={c} style={{ pointerEvents: "none" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ ...shimmer, width: 40, height: 18 }} />
        <div style={{ flex: 1 }} />
        <div style={{ ...shimmer, width: 60, height: 18 }} />
      </div>
      <div style={{ ...shimmer, height: 16, marginBottom: 8 }} />
      <div style={{ ...shimmer, height: 16, width: "70%" }} />
      <div style={{ height: 1, background: c.border, margin: "16px 0 14px" }} />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ ...shimmer, width: 80, height: 24 }} />
        <div style={{ ...shimmer, width: 80, height: 24 }} />
      </div>
    </Card>
  );
}

// ── Segmented tabs ────────────────────────────────────────────
function SegmentedControl({ c, options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", padding: 4, borderRadius: 99, background: c.surface, border: `1px solid ${c.border}` }}>
      {options.map(([key, label]) => (
        <button key={key} onClick={() => onChange(key)} style={{ padding: "7px 16px", borderRadius: 99, background: value === key ? `linear-gradient(135deg, ${c.accent2}, ${c.accent})` : "transparent", color: value === key ? "#fff" : c.textDim, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 200ms" }}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════
export default function ClauseGuardApp() {
  const [dark, setDark] = useState(true);
  const c = T[dark ? "dark" : "light"];

  const [walletAddress, setWalletAddress] = useState(null);
  const [provider, setProvider] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);

  const [deals, setDeals] = useState([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealsError, setDealsError] = useState(null);

  const [tab, setTab] = useState("all");
  const [openDeal, setOpenDeal] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const { toasts, add: toast } = useToast();

  // ── Wallet ──────────────────────────────────────────────────
  async function connectWallet() {
    if (!window.ethereum) { toast("No wallet detected. Install Rabby or MetaMask.", "error"); return; }
    try {
      setWalletLoading(true);
      // wallet_requestPermissions forces the account picker to appear even if
      // the site already has a prior approval — lets the user switch accounts.
      try {
        await window.ethereum.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch (permErr) {
        // User cancelled the picker — don't proceed
        if (permErr.code === 4001) throw permErr;
        // Some wallets don't support wallet_requestPermissions — fall through
      }
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts.length) throw new Error("No accounts returned");
      setWalletAddress(accounts[0]);
      setProvider(window.ethereum);
      toast("Connected: " + shortAddr(accounts[0]), "success");
    } catch (err) {
      if (err.code !== 4001) toast("Connect failed: " + err.message, "error");
    } finally {
      setWalletLoading(false);
    }
  }

  function disconnectWallet() {
    setWalletAddress(null);
    setProvider(null);
    toast("Wallet disconnected", "info");
  }

  useEffect(() => {
    if (!window.ethereum) return;
    const handler = (accounts) => {
      if (accounts.length === 0) disconnectWallet();
      else setWalletAddress(accounts[0]);
    };
    window.ethereum.on("accountsChanged", handler);
    return () => window.ethereum.removeListener?.("accountsChanged", handler);
  }, []);

  // ── Load deals ──────────────────────────────────────────────
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

  // ── Filter deals ────────────────────────────────────────────
  const filteredDeals = deals.filter((d) => {
    if (tab === "mine") return walletAddress && (d.seller?.toLowerCase() === walletAddress.toLowerCase() || d.buyer?.toLowerCase() === walletAddress.toLowerCase());
    if (tab === "open") return d.status === "open";
    return true;
  });

  return (
    <div style={{ minHeight: "100vh", background: c.bg, color: c.text }}>
      <GlobalStyles dark={dark} />

      <Header
        c={c} dark={dark}
        onToggleTheme={() => setDark((d) => !d)}
        walletAddress={walletAddress}
        walletLoading={walletLoading}
        onConnect={connectWallet}
        onDisconnect={disconnectWallet}
        onCreate={() => walletAddress ? setShowCreate(true) : connectWallet()}
        onRefresh={loadDeals}
      />

      <Hero c={c} dark={dark} deals={deals} onCreateClick={() => setShowCreate(true)} onConnectClick={connectWallet} walletAddress={walletAddress} />

      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "48px 28px 120px" }}>
        {/* Section header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28, gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Escrow deals</div>
            <h2 style={{ fontWeight: 800, fontSize: 38, letterSpacing: "-0.025em", color: c.text }}>
              {tab === "mine" ? "My deals" : tab === "open" ? "Open marketplace" : "All deals"}
            </h2>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <SegmentedControl c={c} options={[["all", "All"], ["open", "Open"], ["mine", "Mine"]]} value={tab} onChange={setTab} />
          </div>
        </div>

        {/* Loading */}
        {dealsLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 18 }}>
            {[0, 1, 2].map((i) => <SkeletonCard key={i} c={c} />)}
          </div>
        )}

        {/* Error */}
        {dealsError && !dealsLoading && (
          <div style={{ background: `${c.danger}18`, border: `1px solid ${c.danger}44`, borderRadius: 14, padding: "24px 28px", marginBottom: 20 }}>
            <div style={{ fontWeight: 700, color: c.danger, marginBottom: 6 }}>Failed to load deals</div>
            <div style={{ fontSize: 13, color: c.textDim }}>{dealsError}</div>
            <Btn kind="danger" c={c} style={{ marginTop: 14 }} onClick={loadDeals}>Retry</Btn>
          </div>
        )}

        {/* Empty */}
        {!dealsLoading && !dealsError && filteredDeals.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 24px", background: c.surface, borderRadius: 18, border: `1px solid ${c.border}` }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <h3 style={{ fontSize: 20, fontWeight: 700, color: c.text, marginBottom: 10 }}>
              {tab === "mine" ? "No deals yet" : tab === "open" ? "No open deals" : "No deals on-chain yet"}
            </h3>
            <p style={{ fontSize: 14, color: c.textMute, marginBottom: 24 }}>
              {tab === "mine" ? "Create your first deal to get started." : "Be the first to create a deal."}
            </p>
            {walletAddress && (
              <Btn kind="primary" c={c} icon="plus" onClick={() => setShowCreate(true)}>Create a deal</Btn>
            )}
          </div>
        )}

        {/* Deal grid */}
        {!dealsLoading && !dealsError && filteredDeals.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 18 }}>
            {filteredDeals.slice().reverse().map((deal, i) => (
              <DealCard key={deal.id} deal={deal} walletAddress={walletAddress} c={c} index={i} onOpen={setOpenDeal} />
            ))}
          </div>
        )}

        {/* How it works */}
        <section style={{ marginTop: 96 }}>
          <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 48px" }}>
            <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>How it works</div>
            <h2 style={{ fontWeight: 800, fontSize: 44, letterSpacing: "-0.025em", color: c.text }}>Trust without intermediaries.</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
            {[
              { n: "01", t: "Write the clause", d: "In plain English. No legalese, no smart-contract syntax. Validators read what you wrote — verbatim." },
              { n: "02", t: "Lock funds",        d: "Escrowed on the GenLayer studionet chain. Visible to both parties, untouchable until consensus." },
              { n: "03", t: "AI consensus",      d: "Validators crawl the open web, reason over the evidence, and reach a verdict in minutes via Optimistic Democracy." },
            ].map((step) => (
              <Card key={step.n} c={c} hover>
                <div style={{ fontWeight: 800, fontSize: 40, color: c.accent2, lineHeight: 1, marginBottom: 14, opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>{step.n}</div>
                <h3 style={{ fontWeight: 700, fontSize: 18, color: c.text, letterSpacing: "-0.01em", marginBottom: 10 }}>{step.t}</h3>
                <p style={{ fontSize: 14, color: c.textDim, lineHeight: 1.6 }}>{step.d}</p>
              </Card>
            ))}
          </div>
        </section>
      </main>

      {/* Mochi + footer */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, position: "relative" }}>
        <div style={{ position: "relative", animation: "cg-driftA 6s ease-in-out infinite" }}>
          <div aria-hidden style={{ position: "absolute", inset: -24, borderRadius: "50%", background: `radial-gradient(circle, ${c.accent2}44 0%, transparent 65%)`, filter: "blur(22px)", pointerEvents: "none" }} />
          <Mochi size={130} />
          <div style={{ position: "absolute", top: 10, right: -170, width: 150, background: c.bgElev, border: `1px solid ${c.borderHi}`, borderRadius: 12, padding: "9px 13px", fontSize: 12, color: c.textDim, lineHeight: 1.4, boxShadow: c.shadow }}>
            <span style={{ color: c.text, fontWeight: 700 }}>Mochi</span> here — your friendly escrow validator. Trust is autonomous now.
            <div style={{ position: "absolute", left: -7, top: 16, width: 11, height: 11, background: c.bgElev, borderLeft: `1px solid ${c.borderHi}`, borderBottom: `1px solid ${c.borderHi}`, transform: "rotate(45deg)" }} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}>Built on GenLayer · Intelligent Contracts + Optimistic Democracy</div>
      </div>

      <footer style={{ borderTop: `1px solid ${c.border}`, padding: "24px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1280, margin: "0 auto", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: c.textMute, fontSize: 12 }}>
          <ClauseGuardMark size={18} />
          <span>ClauseGuard · built on GenLayer studionet · Contract{" "}
            <a href={`https://explorer-studio.genlayer.com/address/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer" style={{ color: c.accent, fontFamily: "ui-monospace, monospace", textDecoration: "none" }}>
              {process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ? shortAddr(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS) : "not configured"}
            </a>
          </span>
        </div>
        <div style={{ display: "flex", gap: 18, fontSize: 12, color: c.textMute }}>
          <a href={`https://explorer-studio.genlayer.com/address/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>Explorer</a>
          <a href="https://genlayer.com" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>GenLayer</a>
          <a href="https://docs.genlayer.com" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>Docs</a>
        </div>
      </footer>

      {/* Modals */}
      {showCreate && (
        <CreateDealDialog c={c} walletAddress={walletAddress} provider={provider} toast={toast} onClose={() => setShowCreate(false)} onSuccess={async () => { setShowCreate(false); await loadDeals(); }} />
      )}
      {openDeal && (
        <DealDetailDialog c={c} deal={openDeal} walletAddress={walletAddress} provider={provider} toast={toast} onClose={() => setOpenDeal(null)} onRefresh={loadDeals} />
      )}

      <ToastStack toasts={toasts} c={c} />
    </div>
  );
}
