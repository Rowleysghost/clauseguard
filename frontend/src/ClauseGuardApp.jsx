"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { useDisconnect } from "wagmi";
import * as GL from "./lib/genlayer";
import { uploadScreenshot, validateImageFile } from "./lib/upload";

// ── Theme tokens ──────────────────────────────────────────────
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

const STATUS_META = {
  open:               { label: "Open",        tone: "open",      pipeStep: 0 },
  funded:             { label: "Funded",       tone: "funded",    pipeStep: 1 },
  evidence_submitted: { label: "Evidence",     tone: "verifying", pipeStep: 2 },
  verified:           { label: "AI Verified",  tone: "released",  pipeStep: 3 },
  settled:            { label: "Settled",      tone: "released",  pipeStep: 4 },
  rejected:           { label: "Rejected",     tone: "refunded",  pipeStep: 3 },
  refunded:           { label: "Refunded",     tone: "refunded",  pipeStep: 4 },
  disputed:           { label: "Disputed",     tone: "disputed",  pipeStep: 3 },
  cancelled:          { label: "Cancelled",    tone: "default",   pipeStep: 0 },
};

const EVIDENCE_TYPES = [
  { value: "delivery_proof",  label: "Delivery Proof"    },
  { value: "quality_report",  label: "Quality Report"    },
  { value: "tracking",        label: "Shipping Tracker"  },
  { value: "receipt",         label: "Receipt / Invoice" },
  { value: "other",           label: "Other"             },
];

const PIPELINE_STAGES = ["Listed", "Funded", "Evidence", "Verified", "Settled"];

const VERIFY_STAGES = [
  "Crawling web evidence",
  "Distributing to validators",
  "LLM consensus reasoning",
  "Sealing verdict on-chain",
];

function shortAddr(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function dealTitle(deal) {
  if (!deal?.terms) return `Deal #${deal?.id ?? "?"}`;
  const first = deal.terms.split(/[.!?\n]/)[0].trim();
  return first.length > 72 ? first.slice(0, 70) + "…" : first || `Deal #${deal.id}`;
}

function confidencePct(conf) {
  if (typeof conf === "number") return Math.round(conf * 100);
  if (conf === "high")   return 92;
  if (conf === "medium") return 64;
  return 38;
}

// ── Global keyframes ─────────────────────────────────────────
function GlobalStyles({ dark }) {
  return (
    <style>{`
      @import url('https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700&f[]=lineca@400&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Switzer', system-ui, sans-serif; }
      @keyframes cg-fadeup   { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
      @keyframes cg-fadein   { from { opacity:0; } to { opacity:1; } }
      @keyframes cg-shimmer  { 0%{background-position:-240px 0;} 100%{background-position:240px 0;} }
      @keyframes cg-pulse    { 0%,100%{box-shadow:0 0 0 0 rgba(227,125,247,0.55),0 0 22px 4px rgba(227,125,247,0.35);} 50%{box-shadow:0 0 0 8px rgba(227,125,247,0),0 0 28px 8px rgba(155,106,246,0.55);} }
      @keyframes cg-driftA   { 0%{transform:translate(0,0)scale(1);} 50%{transform:translate(8%,-6%)scale(1.15);} 100%{transform:translate(0,0)scale(1);} }
      @keyframes cg-driftB   { 0%{transform:translate(0,0)scale(1);} 50%{transform:translate(-10%,8%)scale(1.1);} 100%{transform:translate(0,0)scale(1);} }
      @keyframes cg-driftC   { 0%{transform:translate(0,0)scale(1);} 50%{transform:translate(6%,10%)scale(1.2);} 100%{transform:translate(0,0)scale(1);} }
      @keyframes cg-orbit    { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
      @keyframes cg-sweep    { 0%{transform:translateX(-100%);} 100%{transform:translateX(100%);} }
      @keyframes spin        { to{transform:rotate(360deg);} }
      .cg-skeleton {
        background: linear-gradient(90deg, rgba(155,106,246,0.06) 0%, rgba(227,125,247,0.18) 40%, rgba(155,106,246,0.06) 80%);
        background-size: 240px 100%;
        animation: cg-shimmer 1.4s linear infinite;
      }
      .cg-card-hover { transition: transform 240ms cubic-bezier(.2,.8,.2,1), box-shadow 240ms ease, border-color 240ms ease; }
      .cg-card-hover:hover { transform: translateY(-2px); }
      .cg-btn { transition: transform 160ms ease, box-shadow 220ms ease, background 220ms ease, color 220ms ease; }
      .cg-btn:hover:not(:disabled) { transform: translateY(-1px); }
      .cg-btn:active:not(:disabled) { transform: translateY(0); }
      .cg-btn:disabled { opacity: 0.5; cursor: not-allowed !important; }
      input, textarea, select { color-scheme: ${dark ? "dark" : "light"}; font-family: inherit; }
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-thumb { background: rgba(155,106,246,0.3); border-radius: 3px; }
      *::selection { background: rgba(227,125,247,0.4); color: #fff; }
      a { color: inherit; }
      .cg-rm * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
    `}</style>
  );
}

// ── Brand mark ────────────────────────────────────────────────
function ClauseGuardMark({ size = 40, animated = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id="cg-pink" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#E37DF7" /><stop offset="1" stopColor="#9B6AF6" />
        </linearGradient>
        <linearGradient id="cg-blue" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#9B6AF6" /><stop offset="1" stopColor="#110FFF" />
        </linearGradient>
      </defs>
      <path d="M8 14 L32 30 L8 46 L8 36 L20 30 L8 24 Z" fill="url(#cg-pink)" />
      <path d="M56 14 L32 30 L56 46 L56 36 L44 30 L56 24 Z" fill="url(#cg-blue)" />
      <path d="M32 22 L38 34 L26 34 Z" fill="#fff" opacity={animated ? undefined : 1}>
        {animated && <animate attributeName="opacity" values="1;0.55;1" dur="3.2s" repeatCount="indefinite" />}
      </path>
    </svg>
  );
}

// ── Mochi mascot ──────────────────────────────────────────────
function Mochi({ size = 140 }) {
  return (
    <svg width={size} height={size * 1.05} viewBox="0 0 200 210" fill="none" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id="m-ear"   x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#E37DF7"/><stop offset="1" stopColor="#9B6AF6"/></linearGradient>
        <linearGradient id="m-body"  x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#FAFBFF"/><stop offset="1" stopColor="#E5E7F4"/></linearGradient>
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
      <path d="M72 52 H128 M72 56 H128 M72 60 H128 M72 64 H128 M72 68 H128 M72 72 H128 M72 76 H128 M72 80 H128 M72 84 H128" stroke="#7BE9F0" strokeWidth="0.5" opacity="0.18"/>
      <path d="M82 56 L96 58 L94 70 L82 66 Z" fill="#7BE9F0"><animate attributeName="opacity" values="1;1;0.2;1;1" dur="5s" repeatCount="indefinite"/></path>
      <path d="M118 56 L104 58 L106 70 L118 66 Z" fill="#7BE9F0"><animate attributeName="opacity" values="1;1;0.2;1;1" dur="5s" repeatCount="indefinite"/></path>
      <path d="M94 78 L100 82 L106 78" stroke="#7BE9F0" strokeWidth="2" strokeLinecap="round" fill="none"/>
      <path d="M54 62 Q70 50 100 48 Q130 50 146 62" stroke="#7F84A0" strokeWidth="1" fill="none" opacity="0.6"/>
      <line x1="100" y1="16" x2="100" y2="6" stroke="#7F84A0" strokeWidth="1.5"/>
      <circle cx="100" cy="5" r="2.5" fill="#E37DF7"><animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite"/></circle>
    </svg>
  );
}

// ── Icon set ──────────────────────────────────────────────────
function Icon({ name, size = 18, color = "currentColor" }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "plus":    return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case "shield":  return <svg {...p}><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6l8-3z"/></svg>;
    case "check":   return <svg {...p}><path d="M5 12l4 4 10-10"/></svg>;
    case "x":       return <svg {...p}><path d="M6 6l12 12M18 6l-12 12"/></svg>;
    case "wallet":  return <svg {...p}><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/></svg>;
    case "doc":     return <svg {...p}><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6z"/><path d="M14 3v6h6M9 14h6M9 18h6"/></svg>;
    case "upload":  return <svg {...p}><path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 18v2a1 1 0 001 1h14a1 1 0 001-1v-2"/></svg>;
    case "spark":   return <svg {...p}><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>;
    case "arrowR":  return <svg {...p}><path d="M5 12h14M13 5l7 7-7 7"/></svg>;
    case "sun":     return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>;
    case "moon":    return <svg {...p}><path d="M21 13a8 8 0 11-9-9 6 6 0 009 9z"/></svg>;
    case "globe":   return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>;
    case "refresh": return <svg {...p}><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"/></svg>;
    case "link":    return <svg {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>;
    case "clock":   return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    default: return null;
  }
}

// ── Display (Lineca heading) ──────────────────────────────────
function Display({ children, size = 64, c, style }) {
  return (
    <h1 style={{ fontFamily: "'Lineca', 'Switzer', system-ui, sans-serif", fontWeight: 400, fontSize: size, lineHeight: 0.98, letterSpacing: "-0.025em", margin: 0, color: c.text, ...style }}>
      {children}
    </h1>
  );
}

// ── Primitives ────────────────────────────────────────────────
function Btn({ kind = "primary", size = "md", children, icon, iconRight, c, style, ...rest }) {
  const sizes = { sm: { p: "7px 13px", f: 12 }, md: { p: "11px 20px", f: 14 }, lg: { p: "15px 28px", f: 15 } };
  const s = sizes[size] || sizes.md;
  const base = { fontFamily: "inherit", fontWeight: 600, fontSize: s.f, padding: s.p, borderRadius: 999, border: "1px solid transparent", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, letterSpacing: "-0.01em", lineHeight: 1, ...style };
  let palette;
  if (kind === "primary")  palette = { background: `linear-gradient(135deg, ${c.accent2} 0%, ${c.accent} 50%, ${c.accent3} 120%)`, color: "#fff", boxShadow: `0 6px 18px -8px ${c.accent}, inset 0 1px 0 rgba(255,255,255,0.2)` };
  else if (kind === "ghost")   palette = { background: "transparent", color: c.text, border: `1px solid ${c.border}` };
  else if (kind === "subtle")  palette = { background: c.surface, color: c.text, border: `1px solid ${c.border}` };
  else if (kind === "danger")  palette = { background: "transparent", color: c.danger, border: `1px solid ${c.danger}55` };
  else if (kind === "success") palette = { background: `${c.success}22`, color: c.success, border: `1px solid ${c.success}55` };
  return (
    <button className="cg-btn" style={{ ...base, ...palette }} {...rest}>
      {icon && <Icon name={icon} size={s.f + 2} />}
      {children}
      {iconRight && <Icon name={iconRight} size={s.f + 2} />}
    </button>
  );
}

function Card({ children, c, style, hover = false, onClick, ...rest }) {
  return (
    <div
      className={hover ? "cg-card-hover" : ""}
      style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 18, padding: 22, boxShadow: c.shadow, ...style }}
      onClick={onClick}
      onMouseEnter={hover ? (e) => { e.currentTarget.style.borderColor = c.borderHi; e.currentTarget.style.boxShadow = `0 22px 50px -22px ${c.accent}aa, 0 8px 24px -10px rgba(0,0,0,0.5)`; } : undefined}
      onMouseLeave={hover ? (e) => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.boxShadow = c.shadow; } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

function Pill({ children, c, tone = "default", style }) {
  const tones = {
    default:   { bg: c.surfaceHi,                    fg: c.textDim,  br: c.border },
    open:      { bg: "rgba(59,130,246,0.10)",         fg: "#60a5fa",  br: "rgba(59,130,246,0.35)" },
    funded:    { bg: "rgba(91,227,164,0.10)",         fg: c.success,  br: "rgba(91,227,164,0.3)" },
    verifying: { bg: "rgba(227,125,247,0.10)",        fg: c.accent2,  br: "rgba(227,125,247,0.35)" },
    released:  { bg: "rgba(91,227,164,0.14)",         fg: c.success,  br: "rgba(91,227,164,0.4)" },
    refunded:  { bg: "rgba(255,107,138,0.10)",        fg: c.danger,   br: "rgba(255,107,138,0.35)" },
    disputed:  { bg: "rgba(255,181,71,0.10)",         fg: c.warn,     br: "rgba(255,181,71,0.35)" },
  };
  const t = tones[tone] || tones.default;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: t.bg, color: t.fg, border: `1px solid ${t.br}`, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", ...style }}>
      {tone === "verifying" && <span style={{ width: 6, height: 6, borderRadius: 99, background: t.fg, animation: "cg-pulse 1.6s ease-in-out infinite" }} />}
      {children}
    </span>
  );
}

const SectionLabel = ({ c, children }) => (
  <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}>{children}</div>
);

const Field = ({ c, label, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <span style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}>{label}</span>
    {children}
  </label>
);

// ── Pipeline ──────────────────────────────────────────────────
function Pipeline({ c, status }) {
  const meta = STATUS_META[status] || STATUS_META.open;
  const currentIndex = meta.pipeStep;
  const isError = ["rejected", "disputed", "cancelled"].includes(status);

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
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, minWidth: 68 }}>
              <div style={{ width: 32, height: 32, borderRadius: 99, background: bg, border: (active || done || errAt) ? "none" : `1px solid ${c.border}`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, animation: active ? "cg-pulse 1.6s ease-in-out infinite" : undefined }}>
                {done && !isError ? <Icon name="check" size={14} color="#fff" /> : (i + 1)}
              </div>
              <span style={{ fontSize: 10, color: fg, fontWeight: active ? 700 : 500, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</span>
            </div>
            {i < PIPELINE_STAGES.length - 1 && (
              <div style={{ flex: 1, height: 2, marginBottom: 22, marginInline: 2, background: done ? c.success : c.border, borderRadius: 2, position: "relative", overflow: "hidden" }}>
                {active && <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, transparent, ${c.accent2}, transparent)`, animation: "cg-sweep 1.6s ease-in-out infinite" }} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Validator ring (hero decoration) ─────────────────────────
function ValidatorRing({ c, active = true }) {
  const N = 5, radius = 58;
  return (
    <div style={{ position: "relative", height: 140, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", width: radius * 2 + 30, height: radius * 2 + 30, borderRadius: "50%", border: `1px dashed ${c.border}` }} />
      <div style={{ position: "absolute", width: radius * 2 + 30, height: radius * 2 + 30, borderRadius: "50%", animation: active ? "cg-orbit 22s linear infinite" : undefined }}>
        {Array.from({ length: N }).map((_, i) => {
          const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
          const decided = i < 4;
          return (
            <div key={i} style={{ position: "absolute", left: "50%", top: "50%", transform: `translate(${x}px, ${y}px) translate(-50%, -50%)`, width: 24, height: 24, borderRadius: 99, background: decided ? `linear-gradient(135deg, ${c.accent2}, ${c.accent})` : c.surfaceHi, border: decided ? "none" : `1px solid ${c.border}`, boxShadow: decided ? `0 0 12px ${c.accent}aa` : "none" }} />
          );
        })}
      </div>
      <div style={{ width: 64, height: 64, borderRadius: 99, background: c.bgElev, border: `1px solid ${c.border}`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 2, boxShadow: `0 0 0 1px ${c.borderHi}, 0 0 24px ${c.accent}66` }}>
        <ClauseGuardMark size={36} />
      </div>
    </div>
  );
}

// ── Featured deal card (hero right panel) ─────────────────────
function FeaturedDealVis({ c, dark, deal }) {
  const title   = deal ? dealTitle(deal) : "Vintage Leica M6 — Hong Kong → Berlin";
  const amount  = deal ? deal.price_description : "2,400 GEN";
  const status  = deal ? deal.status : "evidence_submitted";
  const meta    = STATUS_META[status] || STATUS_META.open;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", inset: -1, borderRadius: 24, background: `linear-gradient(135deg, ${c.accent2}, ${c.accent}, ${c.accent3})`, opacity: 0.45, filter: "blur(18px)" }} />
      <Card c={c} style={{ position: "relative", padding: 0, overflow: "hidden", borderRadius: 22, background: dark ? "#0c0d24" : c.surface }}>
        {/* Window chrome */}
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${c.border}` }}>
          <div style={{ display: "flex", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 99, background: c.danger }} />
            <span style={{ width: 10, height: 10, borderRadius: 99, background: c.warn }} />
            <span style={{ width: 10, height: 10, borderRadius: 99, background: c.success }} />
          </div>
          <span style={{ fontSize: 11, color: c.textMute, fontFamily: "ui-monospace, monospace", marginLeft: 8 }}>
            deal · #{deal?.id ?? "9F2A1B"}
          </span>
          <span style={{ flex: 1 }} />
          <Pill c={c} tone={meta.tone}>{meta.label}</Pill>
        </div>
        <div style={{ padding: 22 }}>
          <SectionLabel c={c}>Clause</SectionLabel>
          <p style={{ margin: "10px 0 0", fontSize: 15, color: c.text, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            <span style={{ color: c.accent2 }}>"</span>{title}<span style={{ color: c.accent2 }}>"</span>
          </p>
          <div style={{ height: 1, background: c.border, margin: "20px 0" }} />
          <ValidatorRing c={c} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, alignItems: "flex-end" }}>
            <div>
              <SectionLabel c={c}>In escrow</SectionLabel>
              <div style={{ fontFamily: "'Lineca', sans-serif", fontSize: 32, color: c.text, lineHeight: 1, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{amount}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <SectionLabel c={c}>Consensus</SectionLabel>
              <div style={{ fontFamily: "'Lineca', sans-serif", fontSize: 32, color: c.accent2, lineHeight: 1, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                4<span style={{ fontSize: 16, color: c.textDim }}>/5</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
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
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(7,7,26,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "4vh 20px", animation: "cg-fadein 220ms ease both" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "100%", maxWidth: wide ? 880 : 600, maxHeight: "92vh", overflowY: "auto", background: c.bgElev, border: `1px solid ${c.border}`, borderRadius: 22, boxShadow: "0 40px 80px -20px rgba(0,0,0,0.7)", animation: "cg-fadeup 320ms ease both" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, zIndex: 2, width: 32, height: 32, borderRadius: 99, background: "transparent", color: c.textDim, border: `1px solid ${c.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Icon name="x" size={14} />
        </button>
        {children}
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, kind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, msg, kind }].slice(-3));
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);
  return { toasts, add };
}

function ToastStack({ toasts, c }) {
  return (
    <div style={{ position: "fixed", top: 80, right: 24, zIndex: 300, display: "flex", flexDirection: "column", gap: 10, width: 310 }}>
      {toasts.map((t) => (
        <div key={t.id} style={{ padding: "13px 16px", borderRadius: 12, animation: "cg-fadeup 280ms ease both", background: c.bgElev, border: `1px solid ${t.kind === "error" ? "rgba(255,107,138,0.4)" : t.kind === "success" ? "rgba(91,227,164,0.4)" : c.borderHi}`, boxShadow: c.shadow, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ width: 22, height: 22, borderRadius: 99, flexShrink: 0, background: t.kind === "error" ? c.danger : t.kind === "success" ? c.success : `linear-gradient(135deg, ${c.accent2}, ${c.accent})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 10px ${t.kind === "error" ? c.danger : t.kind === "success" ? c.success : c.accent2}88` }}>
            <Icon name={t.kind === "error" ? "x" : t.kind === "success" ? "check" : "spark"} size={11} color="#fff" />
          </div>
          <div style={{ flex: 1, fontSize: 12, color: c.textDim, lineHeight: 1.45 }}>{t.msg}</div>
        </div>
      ))}
    </div>
  );
}

// ── TX spinner overlay ────────────────────────────────────────
function TxOverlay({ msg, c }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(7,7,26,0.85)", zIndex: 500, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, backdropFilter: "blur(6px)" }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", border: `4px solid ${c.border}`, borderTopColor: c.accent2, animation: "spin 0.9s linear infinite" }} />
      <div style={{ color: c.text, fontSize: 16, fontWeight: 500 }}>{msg}</div>
      <div style={{ color: c.textMute, fontSize: 13 }}>Waiting for GenLayer consensus…</div>
    </div>
  );
}

// ── Skeleton card ─────────────────────────────────────────────
function SkeletonCard({ c }) {
  return (
    <Card c={c} style={{ pointerEvents: "none" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div className="cg-skeleton" style={{ height: 14, width: 60, borderRadius: 99 }} />
        <div style={{ flex: 1 }} />
        <div className="cg-skeleton" style={{ height: 20, width: 70, borderRadius: 99 }} />
      </div>
      <div className="cg-skeleton" style={{ height: 18, width: "85%", borderRadius: 6, marginBottom: 8 }} />
      <div className="cg-skeleton" style={{ height: 14, width: "100%", borderRadius: 6, marginBottom: 6 }} />
      <div className="cg-skeleton" style={{ height: 14, width: "70%", borderRadius: 6 }} />
      <div style={{ height: 1, background: c.border, margin: "18px 0 14px" }} />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div className="cg-skeleton" style={{ height: 24, width: 100, borderRadius: 6 }} />
        <div className="cg-skeleton" style={{ height: 14, width: 80, borderRadius: 6 }} />
      </div>
    </Card>
  );
}

// ── Header ────────────────────────────────────────────────────
function Header({ c, dark, onToggleTheme, walletAddress, walletLoading, onConnect, onDisconnect, onCreate, onRefresh }) {
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 100, backdropFilter: "saturate(140%) blur(18px)", WebkitBackdropFilter: "saturate(140%) blur(18px)", background: dark ? "rgba(7,7,26,0.78)" : "rgba(245,244,251,0.85)", borderBottom: `1px solid ${c.border}` }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "13px 28px", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ClauseGuardMark size={32} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={{ fontFamily: "'Lineca', sans-serif", fontSize: 18, letterSpacing: "-0.01em", color: c.text }}>clauseguard</span>
            <span style={{ fontSize: 10, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", marginTop: 3 }}>studionet · testnet</span>
          </div>
        </div>

        <nav style={{ display: "flex", gap: 4, marginLeft: 24 }}>
          <a href="#deals" style={{ padding: "8px 14px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: c.text, textDecoration: "none", position: "relative" }}>
            Deals
            <span style={{ position: "absolute", left: 14, right: 14, bottom: 2, height: 2, background: `linear-gradient(90deg, ${c.accent2}, ${c.accent3})`, borderRadius: 2 }} />
          </a>
        </nav>

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
  const liveStats = [
    { label: "Total deals",  val: deals.length },
    { label: "Open",         val: deals.filter((d) => d.status === "open").length },
    { label: "Settled",      val: deals.filter((d) => d.status === "settled").length },
    { label: "Validator agreement", val: "99.4%" },
  ];
  const featuredDeal = deals.find((d) => ["evidence_submitted", "verified", "funded"].includes(d.status)) || deals[deals.length - 1] || null;

  return (
    <section style={{ position: "relative", overflow: "hidden", padding: "72px 28px 92px", borderBottom: `1px solid ${c.border}` }}>
      {/* Animated mesh gradient */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-20%", left: "-10%", width: 680, height: 680, borderRadius: "50%", background: `radial-gradient(circle at 30% 30%, ${c.accent2}cc 0%, ${c.accent2}00 60%)`, filter: "blur(40px)", animation: "cg-driftA 14s ease-in-out infinite", opacity: dark ? 0.55 : 0.30 }} />
        <div style={{ position: "absolute", top: "10%", right: "-10%", width: 760, height: 760, borderRadius: "50%", background: `radial-gradient(circle at 60% 40%, ${c.accent}dd 0%, ${c.accent}00 65%)`, filter: "blur(48px)", animation: "cg-driftB 18s ease-in-out infinite", opacity: dark ? 0.55 : 0.32 }} />
        <div style={{ position: "absolute", bottom: "-30%", left: "20%", width: 820, height: 820, borderRadius: "50%", background: `radial-gradient(circle at 50% 50%, ${c.accent3}aa 0%, ${c.accent3}00 60%)`, filter: "blur(56px)", animation: "cg-driftC 22s ease-in-out infinite", opacity: dark ? 0.45 : 0.20 }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(${dark ? "rgba(255,255,255,0.06)" : "rgba(40,43,93,0.10)"} 1px, transparent 1px)`, backgroundSize: "22px 22px", maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)", WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)" }} />
      </div>

      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 56, alignItems: "center" }}>
        {/* Left: copy */}
        <div style={{ animation: "cg-fadeup 700ms ease both" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px 5px 8px", borderRadius: 99, background: dark ? "rgba(255,255,255,0.06)" : "rgba(40,43,93,0.06)", border: `1px solid ${c.border}`, marginBottom: 24 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: c.success, boxShadow: `0 0 8px ${c.success}` }} />
            <span style={{ fontSize: 11, color: c.textDim, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>Live on GenLayer Studionet</span>
          </div>

          <Display c={c} size={84} style={{ maxWidth: 720 }}>
            Escrow that{" "}
            <em style={{ fontStyle: "normal", background: `linear-gradient(120deg, ${c.accent2} 0%, ${c.accent} 50%, ${c.accent3} 100%)`, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>reads English.</em>
          </Display>

          <p style={{ maxWidth: 520, marginTop: 22, fontSize: 18, lineHeight: 1.55, color: c.textDim }}>
            Write deal terms in plain language. Lock funds on-chain. A network of AI validators crawls the web, reasons over evidence, and releases — or refunds — autonomously.
          </p>

          <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
            {walletAddress ? (
              <Btn kind="primary" size="lg" c={c} iconRight="arrowR" onClick={onCreateClick}>Create your first deal</Btn>
            ) : (
              <Btn kind="primary" size="lg" c={c} icon="wallet" onClick={onConnectClick}>Connect wallet to start</Btn>
            )}
            <Btn kind="ghost" size="lg" c={c} icon="globe" onClick={() => window.open(`https://explorer-studio.genlayer.com/address/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS}`, "_blank")}>
              View contract
            </Btn>
          </div>

          <div style={{ display: "flex", gap: 36, marginTop: 52, flexWrap: "wrap" }}>
            {liveStats.map((s, i) => (
              <div key={s.label} style={{ animation: `cg-fadeup 700ms ${200 + i * 120}ms ease both` }}>
                <div style={{ fontFamily: "'Lineca', sans-serif", fontSize: 32, color: c.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.val}</div>
                <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", marginTop: 6, fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: featured deal card */}
        <div style={{ animation: "cg-fadeup 700ms 200ms ease both" }}>
          <FeaturedDealVis c={c} dark={dark} deal={featuredDeal} />
        </div>
      </div>
    </section>
  );
}

// ── Verifying state (in-dialog animation) ─────────────────────
function VerifyingState({ c, stage, validators }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {VERIFY_STAGES.map((s, i) => {
          const done   = i < stage;
          const active = i === stage;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: active ? `linear-gradient(90deg, ${c.accent2}1a, ${c.accent3}10)` : "transparent", borderRadius: 10, border: active ? `1px solid ${c.borderHi}` : "1px solid transparent" }}>
              <div style={{ width: 18, height: 18, borderRadius: 99, background: done ? c.success : active ? c.accent2 : c.surfaceHi, border: (!done && !active) ? `1px solid ${c.border}` : "none", display: "flex", alignItems: "center", justifyContent: "center", animation: active ? "cg-pulse 1.6s ease-in-out infinite" : undefined, flexShrink: 0 }}>
                {done && <Icon name="check" size={11} color="#fff" />}
              </div>
              <span style={{ fontSize: 13, color: active ? c.text : done ? c.textDim : c.textMute, fontWeight: active ? 600 : 400 }}>{s}</span>
              {active && <span className="cg-skeleton" style={{ flex: 1, height: 6, borderRadius: 99, marginLeft: 6 }} />}
            </div>
          );
        })}
      </div>

      {validators.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <SectionLabel c={c}>Validators reporting</SectionLabel>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {validators.map((v) => (
              <div key={v} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px 6px 8px", borderRadius: 99, border: `1px solid ${c.border}`, background: c.bg, fontFamily: "ui-monospace, monospace", fontSize: 11, color: c.textDim, animation: "cg-fadeup 320ms ease both" }}>
                <div style={{ width: 7, height: 7, borderRadius: 99, background: c.accent2, animation: "cg-pulse 1.6s ease-in-out infinite" }} />
                {v}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Verdict panel ─────────────────────────────────────────────
function VerdictPanel({ c, verdictDetails, deal }) {
  const isRelease = verdictDetails?.conditions_met === true;
  const pct = confidencePct(verdictDetails?.confidence);

  return (
    <div style={{ marginTop: 14, animation: "cg-fadeup 500ms ease both" }}>
      <div style={{ position: "relative", overflow: "hidden", padding: "18px 18px 16px", borderRadius: 14, border: `1px solid ${isRelease ? "rgba(91,227,164,0.4)" : "rgba(255,107,138,0.4)"}`, background: isRelease ? "linear-gradient(135deg, rgba(91,227,164,0.08), rgba(91,227,164,0.02))" : "linear-gradient(135deg, rgba(255,107,138,0.08), rgba(255,107,138,0.02))" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 99, background: isRelease ? c.success : c.danger, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: isRelease ? `0 0 18px ${c.success}88` : `0 0 18px ${c.danger}88`, flexShrink: 0 }}>
            <Icon name={isRelease ? "check" : "x"} size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontFamily: "'Lineca', sans-serif", fontSize: 22, color: c.text, lineHeight: 1 }}>
              {isRelease ? "Release funds" : "Refund buyer"}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: c.textDim }}>
              Confidence{" "}
              <span style={{ color: isRelease ? c.success : c.danger, fontWeight: 700 }}>{pct}%</span>
            </div>
          </div>
        </div>
        {verdictDetails?.reasoning && (
          <p style={{ margin: "14px 0 0", fontSize: 13, color: c.textDim, lineHeight: 1.55 }}>{verdictDetails.reasoning}</p>
        )}
        {verdictDetails?.unmet_conditions?.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: c.warn, fontWeight: 600, marginBottom: 4 }}>Unmet conditions:</div>
            {verdictDetails.unmet_conditions.map((u, i) => (
              <div key={i} style={{ fontSize: 12, color: c.textDim }}>· {u}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Evidence upload form ──────────────────────────────────────
function EvidenceForm({ deal, walletAddress, provider, c, onSuccess, onCancel, toast }) {
  const [evType, setEvType]     = useState("delivery_proof");
  const [evUrl, setEvUrl]       = useState("");
  const [evDesc, setEvDesc]     = useState("");
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
    } finally { setUploading(false); }
  }

  async function handleSubmit() {
    if (!evUrl.trim()) { toast("Provide an evidence URL or upload a screenshot", "error"); return; }
    if (!evUrl.trim().startsWith("https://")) { toast("Evidence URL must start with https://", "error"); return; }
    if (!evDesc.trim()) { toast("Add a short description", "error"); return; }
    try {
      setSubmitting(true);
      await GL.submitEvidence(walletAddress, provider, parseInt(deal.id), evType, evUrl.trim(), evDesc.trim());
      toast("Evidence submitted on-chain", "success");
      onSuccess();
    } catch (err) {
      toast(err.message || "Submit failed", "error");
    } finally { setSubmitting(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field c={c} label="Evidence Type">
        <select value={evType} onChange={(e) => setEvType(e.target.value)} style={{ ...inp, appearance: "none" }}>
          {EVIDENCE_TYPES.map((et) => <option key={et.value} value={et.value}>{et.label}</option>)}
        </select>
      </Field>
      <Field c={c} label="Evidence URL">
        <input value={evUrl} onChange={(e) => setEvUrl(e.target.value)} placeholder="https://tracking.carrier.com/... or imgbb URL" maxLength={2048} style={inp} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
      </Field>
      <Field c={c} label="Upload Screenshot">
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: "none" }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ ...inp, cursor: uploading ? "wait" : "pointer", textAlign: "left", border: `1px dashed ${c.border}`, color: c.textDim }}>
          {uploading ? "Uploading…" : "📎 Choose image (JPEG / PNG / WebP, max 32MB)"}
        </button>
        {evUrl?.startsWith("https://i.ibb.co") && (
          <div style={{ marginTop: 4, fontSize: 11, color: c.success }}>✓ Uploaded: <a href={evUrl} target="_blank" rel="noreferrer" style={{ color: c.accent }}>{evUrl}</a></div>
        )}
      </Field>
      <Field c={c} label="Description">
        <textarea value={evDesc} onChange={(e) => setEvDesc(e.target.value)} placeholder="Brief description of what this evidence shows…" rows={3} maxLength={500} style={{ ...inp, resize: "vertical" }} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
      </Field>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn kind="ghost" c={c} onClick={onCancel} style={{ flex: 1 }}>Cancel</Btn>
        <Btn kind="primary" c={c} onClick={handleSubmit} disabled={submitting} style={{ flex: 2 }}>{submitting ? "Submitting…" : "Submit On-Chain"}</Btn>
      </div>
    </div>
  );
}

// ── Create deal dialog ────────────────────────────────────────
function CreateDealDialog({ c, walletAddress, provider, onClose, onSuccess, toast }) {
  const [terms, setTerms]       = useState("");
  const [price, setPrice]       = useState("");
  const [deadline, setDeadline] = useState("");
  const [urls, setUrls]         = useState("");
  const [minSources, setMinSources] = useState(1);
  const [loading, setLoading]   = useState(false);

  const inp = { background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "11px 14px", color: c.text, fontSize: 14, width: "100%", outline: "none", transition: "border-color 200ms", fontFamily: "inherit" };

  async function handleCreate() {
    if (!terms.trim())    { toast("Deal terms are required", "error"); return; }
    if (!price.trim())    { toast("Price description is required", "error"); return; }
    if (!deadline.trim()) { toast("Deadline is required", "error"); return; }
    try {
      setLoading(true);
      const urlArray = urls.split(",").map((u) => u.trim()).filter(Boolean);
      await GL.createDeal(walletAddress, provider, { terms: terms.trim(), priceDescription: price.trim(), deadlineDescription: deadline.trim(), verificationUrls: urlArray, minSourcesRequired: minSources });
      toast("Deal created on-chain", "success");
      onSuccess();
    } catch (err) {
      toast(err.message || "Create failed", "error");
    } finally { setLoading(false); }
  }

  const EXAMPLE = "Release funds when buyer receives the item in working condition. Tracking number must be visible to validators within 48h of payment.";

  return (
    <Dialog c={c} onClose={onClose}>
      <div style={{ padding: "28px 32px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Icon name="plus" size={20} color={c.accent2} />
          <Display c={c} size={28}>New escrow deal</Display>
        </div>
        <p style={{ margin: "10px 0 0", color: c.textDim, fontSize: 14, maxWidth: 520 }}>Write your terms in plain English. Validators will read them exactly as-is.</p>
      </div>

      <div style={{ padding: "20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        <Field c={c} label={<>Deal Terms <span style={{ color: c.danger }}>*</span></>}>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={EXAMPLE} rows={5} maxLength={2000} style={{ ...inp, resize: "vertical" }} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: c.textMute }}>
            <span>{terms.length} chars · validators read this verbatim</span>
            <button onClick={() => setTerms(EXAMPLE)} style={{ background: "none", border: "none", color: c.accent2, cursor: "pointer", fontSize: 11, padding: 0, fontWeight: 500 }}>Use example</button>
          </div>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field c={c} label={<>Price / Amount <span style={{ color: c.danger }}>*</span></>}>
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 1.5 GEN" maxLength={200} style={inp} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
          </Field>
          <Field c={c} label={<>Deadline <span style={{ color: c.danger }}>*</span></>}>
            <input value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="e.g. May 15, 2026" maxLength={200} style={inp} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
          </Field>
        </div>

        <Field c={c} label="Verification URLs (comma-separated — validators crawl these)">
          <input value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://track.dhl.com/123, https://yoursite.com/order/456" maxLength={2048} style={inp} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
        </Field>

        <div>
          <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>
            Min. verification sources <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— require {minSources} independent source{minSources > 1 ? "s" : ""}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[1, 2, 3].map((n) => (
              <button key={n} onClick={() => setMinSources(n)} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${minSources === n ? c.accent : c.border}`, background: minSources === n ? `${c.accent}22` : c.bg, color: minSources === n ? c.accent : c.textDim, fontWeight: 700, fontSize: 15, cursor: "pointer", transition: "all 160ms" }}>
                {n}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: c.textMute }}>
            {minSources === 1 ? "Standard — any evidence that satisfies the terms" : `Multi-sig — AI must find confirmation from at least ${minSources} distinct sources`}
          </div>
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
  const [showCounterForm, setShowCounterForm]   = useState(false);
  const [counterTermsInput, setCounterTermsInput] = useState("");
  const [fundAmt, setFundAmt] = useState("");
  const [txMsg, setTxMsg]     = useState(null);
  // Verification animation state
  const [verifying, setVerifying]       = useState(false);
  const [verifyStage, setVerifyStage]   = useState(0);
  const [validators, setValidators]     = useState([]);

  const status   = deal.status || "open";
  const isAddr   = (a) => a && walletAddress && a.toLowerCase() === walletAddress.toLowerCase();
  const isSeller = isAddr(deal.seller);
  const isBuyer  = isAddr(deal.buyer);
  const isParty  = isSeller || isBuyer;
  const meta     = STATUS_META[status] || STATUS_META.open;

  let evidence = [];
  try { evidence = JSON.parse(deal.evidence || "[]"); } catch {}

  let verdictDetails = null;
  try { verdictDetails = deal.verdict_details ? JSON.parse(deal.verdict_details) : null; } catch {}

  async function tx(label, fn) {
    try {
      setTxMsg(label);
      await fn();
      toast(label + " complete", "success");
      onRefresh();
      onClose();
    } catch (err) {
      toast(err.message || "Transaction failed", "error");
    } finally { setTxMsg(null); }
  }

  async function runVerification() {
    const VALVE_IDS = ["VAL-A1", "VAL-A2", "VAL-B1", "VAL-B2", "VAL-C1"];
    setVerifying(true);
    setVerifyStage(0);
    setValidators([]);

    // Cycle visual stages while the real TX runs in background
    const timer = setInterval(() => {
      setVerifyStage((s) => {
        const next = Math.min(s + 1, VERIFY_STAGES.length - 1);
        if (next >= 1 && next <= 2) {
          const id = VALVE_IDS[next - 1] ?? VALVE_IDS[Math.floor(Math.random() * VALVE_IDS.length)];
          setValidators((v) => v.includes(id) ? v : [...v, id]);
        }
        return next;
      });
    }, 18000);

    // Stagger a couple fake validators
    setTimeout(() => setValidators(["VAL-A1"]), 8000);
    setTimeout(() => setValidators(["VAL-A1", "VAL-A2"]), 24000);
    setTimeout(() => setValidators(["VAL-A1", "VAL-A2", "VAL-B1"]), 40000);

    try {
      await GL.requestVerification(walletAddress, provider, parseInt(deal.id));
      clearInterval(timer);
      setVerifyStage(VERIFY_STAGES.length - 1);
      await new Promise((r) => setTimeout(r, 800));
      toast("AI verification complete", "success");
      onRefresh();
      onClose();
    } catch (err) {
      clearInterval(timer);
      toast("Verification failed: " + err.message, "error");
    } finally {
      setVerifying(false);
    }
  }

  const inp = { background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "10px 14px", color: c.text, fontSize: 14, outline: "none", flex: 1, fontFamily: "inherit" };

  return (
    <Dialog c={c} onClose={onClose} wide>
      {txMsg && <TxOverlay msg={txMsg} c={c} />}

      {/* Header */}
      <div style={{ padding: "24px 32px", borderBottom: `1px solid ${c.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <Pill c={c} tone={meta.tone}>{meta.label}</Pill>
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: c.textMute }}>Deal #{deal.id}</span>
          <span style={{ flex: 1 }} />
          {deal.price_description && (
            <span style={{ fontFamily: "'Lineca', sans-serif", fontSize: 26, color: c.text, fontVariantNumeric: "tabular-nums" }}>{deal.price_description}</span>
          )}
        </div>
        <Display c={c} size={24} style={{ marginBottom: 10 }}>{dealTitle(deal)}</Display>
        <p style={{ fontSize: 14, color: c.textDim, lineHeight: 1.6, maxWidth: 720, fontStyle: "italic", borderLeft: `2px solid ${c.borderHi}`, paddingLeft: 14 }}>
          "{deal.terms}"
        </p>
        <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 12, color: c.textMute, flexWrap: "wrap" }}>
          {deal.deadline_description && <span><Icon name="clock" size={11} /> {deal.deadline_description}</span>}
          <span>Seller: <span style={{ color: isSeller ? c.accent : c.text, fontFamily: "ui-monospace, monospace" }}>{shortAddr(deal.seller)}{isSeller ? " (you)" : ""}</span></span>
          {deal.buyer && <span>Buyer: <span style={{ color: isBuyer ? c.accent : c.text, fontFamily: "ui-monospace, monospace" }}>{shortAddr(deal.buyer)}{isBuyer ? " (you)" : ""}</span></span>}
        </div>
      </div>

      {/* Pipeline */}
      {isParty && (
        <div style={{ padding: "22px 32px", borderBottom: `1px solid ${c.border}` }}>
          <Pipeline c={c} status={status} />
        </div>
      )}

      <div style={{ padding: "20px 32px 28px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
        {/* Left: Evidence */}
        <div>
          <SectionLabel c={c}>Evidence ({evidence.length})</SectionLabel>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {evidence.length === 0 && !showEvidenceForm && (
              <div style={{ padding: 20, borderRadius: 12, border: `1px dashed ${c.border}`, color: c.textMute, fontSize: 13, textAlign: "center" }}>No evidence submitted yet.</div>
            )}
            {evidence.map((ev, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 13px", background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10 }}>
                <Icon name="doc" size={15} color={c.accent2} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: c.textMute, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>{(ev.type || ev.evidence_type || "other").replace(/_/g, " ")}</div>
                  {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: c.accent, wordBreak: "break-all", display: "block" }}>{ev.url.slice(0, 55)}{ev.url.length > 55 ? "…" : ""}</a>}
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
            isParty && ["funded", "evidence_submitted", "open", "disputed"].includes(status) && walletAddress && (
              <Btn kind="ghost" c={c} icon="upload" style={{ marginTop: 12 }} onClick={() => setShowEvidenceForm(true)}>Attach evidence</Btn>
            )
          )}

          {deal.verification_urls && (
            <div style={{ marginTop: 18 }}>
              <SectionLabel c={c}>Verification URLs</SectionLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {(Array.isArray(deal.verification_urls) ? deal.verification_urls : deal.verification_urls.split(",")).filter(Boolean).map((u, i) => (
                  <a key={i} href={u.trim()} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: c.accent, textDecoration: "none", background: c.surface, padding: "4px 10px", borderRadius: 99, border: `1px solid ${c.border}` }}>
                    <Icon name="link" size={11} />{u.trim().slice(0, 32)}{u.trim().length > 32 ? "…" : ""}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Verification / verdict / actions */}
        <div>
          <SectionLabel c={c}>{verdictDetails ? "Verdict" : verifying ? "AI consensus in progress" : "Actions"}</SectionLabel>

          {/* Verification running */}
          {verifying && <VerifyingState c={c} stage={verifyStage} validators={validators} />}

          {/* Verdict */}
          {!verifying && verdictDetails && <VerdictPanel c={c} verdictDetails={verdictDetails} deal={deal} />}

          {/* Actions (not verifying, no verdict override) */}
          {!verifying && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: verdictDetails ? 16 : 12 }}>

              {/* Disputed banner */}
              {status === "disputed" && isParty && (
                <div style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,181,71,0.35)", background: "rgba(255,181,71,0.06)", marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: c.warn, marginBottom: 6 }}>Validators in disagreement</div>
                  <div style={{ fontSize: 12, color: c.textDim, lineHeight: 1.55, marginBottom: 12 }}>Submit additional evidence, then re-request verification to resolve.</div>
                  <Btn kind="primary" c={c} icon="spark" onClick={runVerification}>Re-request Verification</Btn>
                </div>
              )}

              {/* Multi-sig badge */}
              {deal.min_sources_required && parseInt(deal.min_sources_required) > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, border: `1px solid ${c.accent}33`, background: `${c.accent}08`, fontSize: 12, color: c.textDim }}>
                  <Icon name="shield" size={13} color={c.accent} />
                  Multi-sig: requires evidence from <span style={{ color: c.accent, fontWeight: 700, marginInline: 3 }}>{deal.min_sources_required}</span> independent sources
                </div>
              )}

              {/* Fund form */}
              {status === "open" && !isSeller && walletAddress && (
                <div>
                  <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Fund this deal</div>
                  <div style={{ fontSize: 12, color: c.textDim, marginBottom: 8 }}>Amount in GEN</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={fundAmt} onChange={(e) => setFundAmt(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 1.5" style={inp} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
                    <Btn kind="primary" c={c} disabled={!fundAmt || parseFloat(fundAmt) <= 0} onClick={() => { const wei = BigInt(Math.round(parseFloat(fundAmt || "0") * 1e18)); tx("Funding deal…", () => GL.fundDeal(walletAddress, provider, parseInt(deal.id), wei.toString())); }}>Fund</Btn>
                  </div>
                </div>
              )}

              {/* Counter-terms: seller sees pending proposal */}
              {deal.pending_terms && isSeller && (
                <div style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,181,71,0.35)", background: "rgba(255,181,71,0.06)" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: c.warn, marginBottom: 6 }}>Amendment Proposed</div>
                  <p style={{ fontSize: 12, color: c.textDim, lineHeight: 1.55, fontStyle: "italic", borderLeft: "2px solid rgba(255,181,71,0.5)", paddingLeft: 10, marginBottom: 8 }}>"{deal.pending_terms}"</p>
                  <div style={{ fontSize: 11, color: c.textMute, marginBottom: 10 }}>From: <span style={{ fontFamily: "ui-monospace, monospace" }}>{shortAddr(deal.pending_terms_from)}</span></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn kind="success" c={c} size="sm" icon="check" style={{ flex: 1 }} onClick={() => tx("Accepting counter-terms…", () => GL.acceptCounterTerms(walletAddress, provider, parseInt(deal.id)))}>Accept</Btn>
                    <Btn kind="danger"  c={c} size="sm" icon="x"     style={{ flex: 1 }} onClick={() => tx("Rejecting counter-terms…", () => GL.rejectCounterTerms(walletAddress, provider, parseInt(deal.id)))}>Reject</Btn>
                  </div>
                </div>
              )}

              {/* Counter-terms: proposer awaiting */}
              {deal.pending_terms && !isSeller && walletAddress?.toLowerCase() === deal.pending_terms_from?.toLowerCase() && (
                <div style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${c.accent}33`, background: `${c.accent}08`, fontSize: 12, color: c.textDim }}>
                  <span style={{ color: c.accent, fontWeight: 600 }}>Your counter-terms are pending seller review.</span>
                </div>
              )}

              {/* Counter-terms: propose button */}
              {!deal.pending_terms && !isSeller && ["open", "funded"].includes(status) && walletAddress && !showCounterForm && (
                <Btn kind="ghost" c={c} size="sm" style={{ width: "100%" }} onClick={() => setShowCounterForm(true)}>Propose Counter-terms</Btn>
              )}

              {/* Counter-terms form */}
              {showCounterForm && (
                <div style={{ padding: 14, background: c.surface, border: `1px solid ${c.border}`, borderRadius: 12 }}>
                  <SectionLabel c={c}>Your Counter-terms</SectionLabel>
                  <textarea value={counterTermsInput} onChange={(e) => setCounterTermsInput(e.target.value)} placeholder="Propose modified deal terms…" rows={4} maxLength={2000} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "10px 14px", color: c.text, fontSize: 13, width: "100%", outline: "none", fontFamily: "inherit", resize: "vertical", marginTop: 8 }} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Btn kind="ghost" c={c} size="sm" style={{ flex: 1 }} onClick={() => { setShowCounterForm(false); setCounterTermsInput(""); }}>Cancel</Btn>
                    <Btn kind="primary" c={c} size="sm" style={{ flex: 2 }} disabled={!counterTermsInput.trim()} onClick={() => { if (!counterTermsInput.trim()) return; tx("Proposing counter-terms…", () => GL.proposeCounterTerms(walletAddress, provider, parseInt(deal.id), counterTermsInput.trim())); setShowCounterForm(false); setCounterTermsInput(""); }}>Submit Proposal</Btn>
                  </div>
                </div>
              )}

              {/* Request AI verification */}
              {status === "evidence_submitted" && isSeller && (
                <Btn kind="primary" c={c} icon="spark" onClick={runVerification}>Run AI Verification</Btn>
              )}

              {/* Deadline check */}
              {["funded", "evidence_submitted"].includes(status) && isParty && (
                <Btn kind="ghost" c={c} size="sm" icon="clock" onClick={() => tx("Checking deadline…", () => GL.checkDeadline(walletAddress, provider, parseInt(deal.id)))}>Check Deadline</Btn>
              )}

              {/* Settle */}
              {status === "verified" && isParty && (
                <Btn kind="success" c={c} icon="check" onClick={() => tx("Settling deal…", () => GL.settleDeal(walletAddress, provider, parseInt(deal.id)))}>Settle & Release Funds</Btn>
              )}

              {/* Refund */}
              {status === "rejected" && isBuyer && (
                <Btn kind="danger" c={c} icon="x" onClick={() => tx("Claiming refund…", () => GL.claimRefund(walletAddress, provider, parseInt(deal.id)))}>Claim Refund</Btn>
              )}

              {/* Cancel */}
              {status === "open" && isSeller && (
                <Btn kind="danger" c={c} onClick={() => tx("Cancelling deal…", () => GL.cancelDeal(walletAddress, provider, parseInt(deal.id)))}>Cancel Deal</Btn>
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
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ── Deal card ─────────────────────────────────────────────────
function DealCard({ deal, walletAddress, c, index = 0, onOpen }) {
  const status  = deal.status || "open";
  const meta    = STATUS_META[status] || STATUS_META.open;
  const isAddr  = (a) => a && walletAddress && a.toLowerCase() === walletAddress.toLowerCase();
  const isSeller = isAddr(deal.seller);
  const isBuyer  = isAddr(deal.buyer);
  const title   = dealTitle(deal);

  return (
    <div style={{ animation: `cg-fadeup 600ms ${80 * index}ms ease both` }}>
      <Card c={c} hover onClick={() => onOpen(deal)} style={{ cursor: "pointer", position: "relative", overflow: "hidden" }}>
        {/* Corner accent dot */}
        <div style={{ position: "absolute", top: 14, right: 14, width: 8, height: 8, borderRadius: 99, background: meta.tone === "verifying" ? c.accent2 : (meta.tone === "funded" || meta.tone === "released") ? c.success : c.textMute, boxShadow: meta.tone === "verifying" ? `0 0 10px ${c.accent2}` : "none" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: c.textMute }}>#{deal.id}</span>
          <span style={{ flex: 1 }} />
          <Pill c={c} tone={meta.tone}>{meta.label}</Pill>
          {(isSeller || isBuyer) && (
            <span style={{ fontSize: 10, color: c.accent, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", background: `${c.accent}18`, padding: "3px 7px", borderRadius: 99 }}>
              {isSeller ? "Your deal" : "Buyer"}
            </span>
          )}
        </div>

        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: c.text, letterSpacing: "-0.01em", lineHeight: 1.3 }}>{title}</h3>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: c.textDim, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{deal.terms}</p>

        <div style={{ height: 1, background: c.border, margin: "16px 0 14px" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            {deal.price_description && (
              <>
                <div style={{ fontSize: 10, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}>Amount</div>
                <div style={{ fontFamily: "'Lineca', sans-serif", fontSize: 22, color: c.text, lineHeight: 1, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{deal.price_description}</div>
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

// ── Tweaks panel ──────────────────────────────────────────────
function TweaksPanel({ c, tweaks, setTweak, onClose }) {
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 300, width: 280, background: c.bgElev, border: `1px solid ${c.border}`, borderRadius: 14, boxShadow: c.shadow, animation: "cg-fadeup 280ms ease both" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${c.border}` }}>
        <span style={{ fontFamily: "'Lineca', sans-serif", fontSize: 14, color: c.text }}>Tweaks</span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: "none", border: "none", color: c.textMute, cursor: "pointer" }}><Icon name="x" size={14} /></button>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>Accent lead</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[{ id: "pink", c1: "#E37DF7", c2: "#9B6AF6" }, { id: "purple", c1: "#9B6AF6", c2: "#110FFF" }, { id: "blue", c1: "#110FFF", c2: "#282B5D" }].map((opt) => (
              <button key={opt.id} onClick={() => setTweak("accentLead", opt.id)} style={{ flex: 1, padding: 0, height: 36, borderRadius: 8, border: tweaks.accentLead === opt.id ? `2px solid ${c.text}` : `1px solid ${c.border}`, background: `linear-gradient(135deg, ${opt.c1}, ${opt.c2})`, cursor: "pointer", color: "#fff", fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>
                {opt.id}
              </button>
            ))}
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={tweaks.reduceMotion} onChange={(e) => setTweak("reduceMotion", e.target.checked)} style={{ accentColor: c.accent2 }} />
          <span style={{ fontSize: 13, color: c.textDim }}>Reduce motion</span>
        </label>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════
export default function ClauseGuardApp() {
  const [dark, setDark] = useState(true);
  const [tweaks, setTweaksState] = useState({ accentLead: "pink", reduceMotion: false });

  const cBase = T[dark ? "dark" : "light"];
  const c = useMemo(() => {
    if (tweaks.accentLead === "blue")   return { ...cBase, accent2: cBase.accent3, accent: cBase.accent2 };
    if (tweaks.accentLead === "purple") return { ...cBase, accent2: cBase.accent, accent: cBase.accent3 };
    return cBase;
  }, [cBase, tweaks.accentLead]);

  const setTweak = (k, v) => setTweaksState((p) => ({ ...p, [k]: v }));

  const { open } = useAppKit();
  const { address: walletAddress } = useAppKitAccount();
  const { walletProvider: provider } = useAppKitProvider("eip155");
  const { disconnect } = useDisconnect();
  const walletLoading = false;
  const [showTweaks, setShowTweaks]       = useState(false);

  const [deals, setDeals]             = useState([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealsError, setDealsError]   = useState(null);

  const [tab, setTab]         = useState("all");
  const [search, setSearch]   = useState("");
  const [openDeal, setOpenDeal]   = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const { toasts, add: toast } = useToast();

  // ── Wallet ──────────────────────────────────────────────────
  const connectWallet = useCallback(() => open(), [open]);
  const disconnectWallet = useCallback(() => disconnect(), [disconnect]);

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
    } finally { setDealsLoading(false); }
  }, []);

  useEffect(() => { loadDeals(); }, [loadDeals]);

  // ── Filter ──────────────────────────────────────────────────
  const filteredDeals = deals.filter((d) => {
    const tabMatch = tab === "mine"
      ? walletAddress && (d.seller?.toLowerCase() === walletAddress.toLowerCase() || d.buyer?.toLowerCase() === walletAddress.toLowerCase())
      : tab === "open" ? d.status === "open" : true;
    if (!tabMatch) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return d.terms?.toLowerCase().includes(q) || d.price_description?.toLowerCase().includes(q) || d.seller?.toLowerCase().includes(q) || String(d.id) === q.replace("#", "");
  });

  return (
    <div className={tweaks.reduceMotion ? "cg-rm" : ""} style={{ minHeight: "100vh", background: c.bg, color: c.text }}>
      <GlobalStyles dark={dark} />

      <Header c={c} dark={dark} onToggleTheme={() => setDark((d) => !d)} walletAddress={walletAddress} walletLoading={walletLoading} onConnect={connectWallet} onDisconnect={disconnectWallet} onCreate={() => walletAddress ? setShowCreate(true) : connectWallet()} onRefresh={loadDeals} />

      <Hero c={c} dark={dark} deals={deals} onCreateClick={() => setShowCreate(true)} onConnectClick={connectWallet} walletAddress={walletAddress} />

      <main id="deals" style={{ maxWidth: 1280, margin: "0 auto", padding: "56px 28px 120px" }}>
        {/* Section header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 32, gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600, marginBottom: 10 }}>Escrow deals</div>
            <Display c={c} size={40}>{tab === "mine" ? "My deals" : tab === "open" ? "Open marketplace" : "Active escrow"}</Display>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input type="search" placeholder="Search deals…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 99, padding: "8px 16px", color: c.text, fontSize: 13, outline: "none", width: 200, fontFamily: "inherit", transition: "border-color 200ms" }} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
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
            <ClauseGuardMark size={52} animated={false} />
            <h3 style={{ fontSize: 20, fontWeight: 700, color: c.text, margin: "20px 0 10px" }}>
              {tab === "mine" ? "No deals yet" : tab === "open" ? "No open deals" : "No deals on-chain yet"}
            </h3>
            <p style={{ fontSize: 14, color: c.textMute, marginBottom: 24 }}>
              {tab === "mine" ? "Create your first deal to get started." : "Be the first to create a deal."}
            </p>
            {walletAddress && <Btn kind="primary" c={c} icon="plus" onClick={() => setShowCreate(true)}>Create a deal</Btn>}
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
          <div style={{ textAlign: "center", maxWidth: 680, margin: "0 auto 56px" }}>
            <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>How it works</div>
            <Display c={c} size={48}>Trust without intermediaries.</Display>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
            {[
              { n: "01", t: "Write the clause",  d: "In plain English. No legalese, no smart-contract syntax. Validators read what you wrote — verbatim." },
              { n: "02", t: "Lock funds",         d: "Escrowed on the GenLayer studionet chain. Visible to both parties, untouchable until AI consensus." },
              { n: "03", t: "AI consensus",       d: "Validators crawl the open web, reason over the evidence, and reach a verdict in minutes via Optimistic Democracy." },
            ].map((step) => (
              <Card key={step.n} c={c} hover>
                <div style={{ fontFamily: "'Lineca', sans-serif", fontSize: 42, color: c.accent2, lineHeight: 1, marginBottom: 16, opacity: 0.85 }}>{step.n}</div>
                <h3 style={{ margin: 0, fontSize: 18, color: c.text, fontWeight: 600, letterSpacing: "-0.01em" }}>{step.t}</h3>
                <p style={{ margin: "10px 0 0", fontSize: 14, color: c.textDim, lineHeight: 1.55 }}>{step.d}</p>
              </Card>
            ))}
          </div>
        </section>
      </main>

      {/* Mochi */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ position: "relative", animation: tweaks.reduceMotion ? "none" : "cg-driftA 6s ease-in-out infinite" }}>
          <div aria-hidden style={{ position: "absolute", inset: -20, borderRadius: "50%", background: `radial-gradient(circle, ${c.accent2}55 0%, transparent 65%)`, filter: "blur(24px)", pointerEvents: "none" }} />
          <Mochi size={140} />
          <div style={{ position: "absolute", top: 8, right: -178, width: 158, background: c.bgElev, border: `1px solid ${c.borderHi}`, borderRadius: 14, padding: "10px 14px", fontSize: 12, color: c.textDim, lineHeight: 1.4, boxShadow: c.shadow }}>
            <span style={{ color: c.text, fontWeight: 700 }}>Mochi</span> here — your friendly escrow validator. Trust is autonomous now.
            <div style={{ position: "absolute", left: -7, top: 18, width: 12, height: 12, background: c.bgElev, borderLeft: `1px solid ${c.borderHi}`, borderBottom: `1px solid ${c.borderHi}`, transform: "rotate(45deg)" }} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600 }}>Built on GenLayer · Intelligent Contracts + Optimistic Democracy</div>
      </div>

      <footer style={{ borderTop: `1px solid ${c.border}`, padding: "24px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1280, margin: "0 auto", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: c.textMute, fontSize: 12 }}>
          <ClauseGuardMark size={18} animated={false} />
          <span>ClauseGuard · built on GenLayer studionet ·{" "}
            <a href={`https://explorer-studio.genlayer.com/address/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer" style={{ color: c.accent, fontFamily: "ui-monospace, monospace", textDecoration: "none" }}>
              {process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ? shortAddr(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS) : "not configured"}
            </a>
          </span>
        </div>
        <div style={{ display: "flex", gap: 18, fontSize: 12, color: c.textMute }}>
          <a href={`https://explorer-studio.genlayer.com/address/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>Explorer</a>
          <a href="https://genlayer.com" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>GenLayer</a>
          <button onClick={() => setShowTweaks((p) => !p)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 12, padding: 0 }}>Tweaks</button>
        </div>
      </footer>

      {/* Modals */}
      {showCreate && <CreateDealDialog c={c} walletAddress={walletAddress} provider={provider} toast={toast} onClose={() => setShowCreate(false)} onSuccess={async () => { setShowCreate(false); await loadDeals(); }} />}
      {openDeal   && <DealDetailDialog c={c} deal={openDeal} walletAddress={walletAddress} provider={provider} toast={toast} onClose={() => setOpenDeal(null)} onRefresh={loadDeals} />}

      <ToastStack toasts={toasts} c={c} />

      {showTweaks && <TweaksPanel c={c} tweaks={tweaks} setTweak={setTweak} onClose={() => setShowTweaks(false)} />}
    </div>
  );
}
