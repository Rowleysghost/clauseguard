"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { useDisconnect } from "wagmi";
import * as GL from "./lib/genlayer";
import { analyzeProofUrl, PROOF_PRESETS, STRENGTH_META } from "./lib/proof";

// ══════════════════════════════════════════════════════════════
// THEME — strict GenLayer brand palette
//   Pink #E37DF7 · Purple #9B6AF6 · Blue #110FFF · Navy #282B5D
// ══════════════════════════════════════════════════════════════
const T = {
  dark: {
    bg:        "#050510",
    bgElev:    "#0b0b1e",
    surface:   "#101030",
    surfaceHi: "#181846",
    border:    "rgba(155,106,246,0.16)",
    borderHi:  "rgba(227,125,247,0.5)",
    text:      "#ffffff",
    textDim:   "#b3b3d4",
    textMute:  "#6d6e96",
    accent:    "#9B6AF6",   // purple
    accent2:   "#E37DF7",   // pink
    accent3:   "#110FFF",   // blue
    navy:      "#282B5D",
    success:   "#5BE3A4",
    warn:      "#FFB547",
    danger:    "#FF6B8A",
    shadow:    "0 24px 60px -28px rgba(17,15,255,0.55), 0 8px 24px -12px rgba(0,0,0,0.7)",
    grain:     "rgba(255,255,255,0.04)",
  },
  light: {
    bg:        "#f4f3fb",
    bgElev:    "#ffffff",
    surface:   "#ffffff",
    surfaceHi: "#f7f6ff",
    border:    "rgba(40,43,93,0.12)",
    borderHi:  "rgba(155,106,246,0.55)",
    text:      "#16163a",
    textDim:   "#4a4c72",
    textMute:  "#8385ab",
    accent:    "#7B4AE6",
    accent2:   "#C657E0",
    accent3:   "#110FFF",
    navy:      "#282B5D",
    success:   "#1AA86F",
    warn:      "#C97A0F",
    danger:    "#D84662",
    shadow:    "0 18px 44px -22px rgba(40,43,93,0.3), 0 6px 16px -8px rgba(40,43,93,0.14)",
    grain:     "rgba(40,43,93,0.05)",
  },
};

// ── Legal / disclaimer content ────────────────────────────────
// NOTE: replace [JURISDICTION] with your actual governing-law jurisdiction.
const LEGAL = {
  updated: "June 2026",
  jurisdiction: "[JURISDICTION — e.g. Delaware, USA]",
  intro:
    "ClauseGuard is experimental, non-custodial software for peer-to-peer escrow on the GenLayer network. Before you use it, please read and accept the following.",
  sections: [
    {
      h: "Not legal or financial advice",
      b: "ClauseGuard is software, not a law firm, broker, or financial institution. The verdicts produced by GenLayer's AI validators are automated assessments generated from public evidence — they are not legally binding judgments and do not constitute legal, financial, tax, or investment advice. Nothing here replaces a separately enforceable written agreement or a qualified professional. For anything that matters, consult a lawyer and keep your own contract.",
    },
    {
      h: "No liability for loss of funds",
      b: "You use ClauseGuard entirely at your own risk. To the maximum extent permitted by law, ClauseGuard, its contributors, and GenLayer disclaim all warranties and accept no liability for any loss or damage — including loss of funds, tokens, or data — arising from smart-contract bugs, AI validator error or disagreement, network or chain failures, wallet or key mistakes, mis-written deal terms, third-party services, or unauthorized access. The software is provided “as is” and “as available.”",
    },
    {
      h: "Dispute resolution & governing law",
      b: "Any dispute, claim, or controversy arising out of or relating to ClauseGuard or these terms shall be resolved exclusively by final and binding individual arbitration, and not in court. You and ClauseGuard each waive the right to a jury trial and the right to participate in any class, collective, or representative action. These terms are governed by, and construed in accordance with, the laws of [JURISDICTION], without regard to its conflict-of-law rules.",
    },
  ],
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

// Mirrors MAX_VERIFICATION_ATTEMPTS in contracts/clauseguard.py — a disputed
// deal can be re-verified up to this many times before on-chain appeals are
// exhausted and parties must resolve off-chain via binding arbitration.
const MAX_VERIFICATION_ATTEMPTS = 3;

const VERIFY_STAGES = [
  "Crawling web evidence",
  "Distributing to validators",
  "LLM consensus reasoning",
  "Sealing verdict on-chain",
];

const MARQUEE_WORDS = ["Autonomous", "Trustless", "On-chain", "AI-verified", "Plain English", "No middlemen"];

// ── Helpers ───────────────────────────────────────────────────
const EXPLORER = "https://explorer-studio.genlayer.com/address/";
const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

function shortAddr(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

// wei (string) → GEN display (trimmed)
function fmtGen(wei) {
  let g = 0;
  try { g = Number(BigInt(wei || "0")) / 1e18; } catch { g = 0; }
  if (!g) return "0";
  return (Math.round(g * 1e6) / 1e6).toString();
}
// GEN (string/number) → wei (string)
function genToWei(gen) {
  const n = parseFloat(gen || "0");
  if (!n || n <= 0) return "0";
  return BigInt(Math.round(n * 1e18)).toString();
}
function hasCollateral(deal) {
  try { return BigInt(deal?.collateral_amount || "0") > 0n; } catch { return false; }
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

// IntersectionObserver-based reveal hook
function useInView(opts = { threshold: 0.18, once: true }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          setSeen(true);
          if (opts.once) io.unobserve(e.target);
        } else if (!opts.once) {
          setSeen(false);
        }
      });
    }, { threshold: opts.threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [opts.threshold, opts.once]);
  return [ref, seen];
}

// Scroll-reveal wrapper
function Reveal({ children, delay = 0, y = 20, style }) {
  const [ref, seen] = useInView();
  return (
    <div
      ref={ref}
      style={{
        opacity: seen ? 1 : 0,
        transform: seen ? "translateY(0)" : `translateY(${y}px)`,
        transition: `opacity 700ms cubic-bezier(.2,.7,.2,1) ${delay}ms, transform 700ms cubic-bezier(.2,.7,.2,1) ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Count-up animated number
function CountUp({ value, dur = 1400, style }) {
  const [ref, seen] = useInView();
  const [disp, setDisp] = useState(0);
  const raw = String(value);
  const target = parseFloat(raw.replace(/[^0-9.]/g, "")) || 0;
  const suffix = raw.replace(/[0-9.,\s]/g, "");
  const decimals = raw.includes(".") ? 1 : 0;

  useEffect(() => {
    if (!seen) return;
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisp(target * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seen, target, dur]);

  return (
    <span ref={ref} style={style}>
      {disp.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

// ── Global keyframes + fonts ──────────────────────────────────
function GlobalStyles({ dark }) {
  return (
    <style>{`
      @import url('https://api.fontshare.com/v2/css?f[]=switzer@300,400,500,600,700,800&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html { scroll-behavior: smooth; }
      body { font-family: 'Switzer', system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
      @keyframes cg-fadeup   { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
      @keyframes cg-fadein   { from { opacity:0; } to { opacity:1; } }
      @keyframes cg-shimmer  { 0%{background-position:-240px 0;} 100%{background-position:240px 0;} }
      @keyframes cg-pulse    { 0%,100%{box-shadow:0 0 0 0 rgba(227,125,247,0.55),0 0 22px 4px rgba(227,125,247,0.35);} 50%{box-shadow:0 0 0 8px rgba(227,125,247,0),0 0 28px 8px rgba(155,106,246,0.55);} }
      @keyframes cg-driftA   { 0%{transform:translate(0,0)scale(1);} 50%{transform:translate(7%,-5%)scale(1.18);} 100%{transform:translate(0,0)scale(1);} }
      @keyframes cg-driftB   { 0%{transform:translate(0,0)scale(1);} 50%{transform:translate(-9%,7%)scale(1.12);} 100%{transform:translate(0,0)scale(1);} }
      @keyframes cg-driftC   { 0%{transform:translate(0,0)scale(1);} 50%{transform:translate(6%,9%)scale(1.22);} 100%{transform:translate(0,0)scale(1);} }
      @keyframes cg-orbit    { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
      @keyframes cg-spin     { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
      @keyframes cg-sweep    { 0%{transform:translateX(-100%);} 100%{transform:translateX(100%);} }
      @keyframes cg-marquee  { from{transform:translateX(0);} to{transform:translateX(-50%);} }
      @keyframes cg-gradient { 0%{background-position:0% 50%;} 50%{background-position:100% 50%;} 100%{background-position:0% 50%;} }
      @keyframes cg-wave     { from{transform:translateX(0);} to{transform:translateX(-260px);} }
      @keyframes cg-bob      { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-9px);} }
      @keyframes spin        { to{transform:rotate(360deg);} }
      .cg-grad-text {
        background: linear-gradient(115deg, #E37DF7 0%, #9B6AF6 45%, #110FFF 100%);
        background-size: 220% 220%;
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent; color: transparent;
        animation: cg-gradient 9s ease infinite;
      }
      .cg-skeleton {
        background: linear-gradient(90deg, rgba(155,106,246,0.06) 0%, rgba(227,125,247,0.18) 40%, rgba(155,106,246,0.06) 80%);
        background-size: 240px 100%;
        animation: cg-shimmer 1.4s linear infinite;
      }
      .cg-card-hover { transition: transform 280ms cubic-bezier(.2,.8,.2,1), box-shadow 280ms ease, border-color 280ms ease; }
      .cg-card-hover:hover { transform: translateY(-4px); }
      .cg-btn { transition: transform 160ms ease, box-shadow 220ms ease, filter 220ms ease, background 220ms ease, color 220ms ease; }
      .cg-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
      .cg-btn:active:not(:disabled) { transform: translateY(0); }
      .cg-btn:disabled { opacity: 0.45; cursor: not-allowed !important; }
      .cg-link-underline { position: relative; }
      .cg-link-underline::after { content:""; position:absolute; left:0; right:100%; bottom:-2px; height:1.5px; background:linear-gradient(90deg,#E37DF7,#110FFF); transition:right 280ms ease; }
      .cg-link-underline:hover::after { right:0; }
      input, textarea, select { color-scheme: ${dark ? "dark" : "light"}; font-family: inherit; }
      ::-webkit-scrollbar { width: 7px; height: 7px; }
      ::-webkit-scrollbar-thumb { background: rgba(155,106,246,0.32); border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(227,125,247,0.5); }
      *::selection { background: rgba(227,125,247,0.4); color: #fff; }
      a { color: inherit; text-decoration: none; }
      .cg-rm * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
      @media (max-width: 900px) {
        .cg-hero-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
        .cg-detail-grid { grid-template-columns: 1fr !important; }
        .cg-hero-display { font-size: 58px !important; }
      }
    `}</style>
  );
}

// ══════════════════════════════════════════════════════════════
// BRAND MARKS & TEXTURES
// ══════════════════════════════════════════════════════════════

// ClauseGuard mark — interlocking chevrons forming a shield/clasp
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

// GenLayer "Strong Mark" nod — the triangle (hands holding/giving = trust).
// Used subtly as a brand accent, per "ClauseGuard in GenLayer's system".
function StrongMark({ size = 28, color = "#9B6AF6", stroke = 2.4 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{ display: "block" }}>
      <path d="M24 6 L43 40 L5 40 Z" stroke={color} strokeWidth={stroke} strokeLinejoin="round" fill="none" />
      <path d="M24 18 L33 34 L15 34 Z" stroke={color} strokeWidth={stroke * 0.8} strokeLinejoin="round" fill="none" opacity="0.55" />
    </svg>
  );
}

// Animated "Data Waves" texture (brand texture: flow of data)
function DataWaves({ c, opacity = 0.5, height = 220 }) {
  const wave = (d, color, dur, op) => (
    <g style={{ animation: `cg-wave ${dur}s linear infinite` }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" opacity={op} />
      <path d={d} transform="translate(1440 0)" fill="none" stroke={color} strokeWidth="1.4" opacity={op} />
    </g>
  );
  // 1440 = two tiles of 720; wave shifts by 260px per loop for organic drift
  const path = (yBase, amp) =>
    `M0 ${yBase} C 180 ${yBase - amp}, 360 ${yBase + amp}, 540 ${yBase} S 900 ${yBase - amp}, 1080 ${yBase} S 1440 ${yBase + amp}, 1440 ${yBase}`;
  return (
    <svg width="100%" height={height} viewBox="0 0 1440 240" preserveAspectRatio="none" style={{ display: "block", opacity }} aria-hidden>
      {wave(path(120, 46), c.accent2, 22, 0.5)}
      {wave(path(140, 60), c.accent, 30, 0.4)}
      {wave(path(160, 36), c.accent3, 26, 0.45)}
    </svg>
  );
}

// ── Mochi mascot — friendly escrow validator ──────────────────
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
    case "arrowDown": return <svg {...p}><path d="M12 5v14M5 13l7 7 7-7"/></svg>;
    case "sun":     return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>;
    case "moon":    return <svg {...p}><path d="M21 13a8 8 0 11-9-9 6 6 0 009 9z"/></svg>;
    case "globe":   return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>;
    case "refresh": return <svg {...p}><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"/></svg>;
    case "link":    return <svg {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>;
    case "clock":   return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case "pen":     return <svg {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>;
    case "lock":    return <svg {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>;
    case "scale":   return <svg {...p}><path d="M12 3v18M5 21h14M7 7l-4 7a4 4 0 008 0L7 7zM17 7l-4 7a4 4 0 008 0l-4-7zM3 7h18"/></svg>;
    case "search":  return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>;
    default: return null;
  }
}

// ── Display heading (Switzer heavy — Lineca if locally licensed) ─
function Display({ children, size = 64, c, style, as: Tag = "h1", grad = false }) {
  return (
    <Tag
      className={grad ? "cg-grad-text" : undefined}
      style={{
        fontFamily: "'Lineca', 'Switzer', system-ui, sans-serif",
        fontWeight: 700, fontSize: size, lineHeight: 1.02, letterSpacing: "-0.03em",
        margin: 0, color: grad ? undefined : c.text, ...style,
      }}
    >
      {children}
    </Tag>
  );
}

// ── Primitives ────────────────────────────────────────────────
function Btn({ kind = "primary", size = "md", children, icon, iconRight, c, style, ...rest }) {
  const sizes = { sm: { p: "7px 14px", f: 12 }, md: { p: "11px 20px", f: 14 }, lg: { p: "15px 30px", f: 15 } };
  const s = sizes[size] || sizes.md;
  const base = { fontFamily: "inherit", fontWeight: 600, fontSize: s.f, padding: s.p, borderRadius: 999, border: "1px solid transparent", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, letterSpacing: "-0.01em", lineHeight: 1, whiteSpace: "nowrap", ...style };
  let palette;
  if (kind === "primary")  palette = { background: `linear-gradient(120deg, ${c.accent2} 0%, ${c.accent} 52%, ${c.accent3} 120%)`, color: "#fff", boxShadow: `0 8px 22px -8px ${c.accent}, inset 0 1px 0 rgba(255,255,255,0.22)` };
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
      style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 20, padding: 24, boxShadow: c.shadow, ...style }}
      onClick={onClick}
      onMouseEnter={hover ? (e) => { e.currentTarget.style.borderColor = c.borderHi; e.currentTarget.style.boxShadow = `0 28px 60px -24px ${c.accent}aa, 0 10px 28px -12px rgba(0,0,0,0.55)`; } : undefined}
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

const SectionLabel = ({ c, children, style }) => (
  <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600, ...style }}>{children}</div>
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

// ── Validator ring ────────────────────────────────────────────
function ValidatorRing({ c, active = true, mark = 36 }) {
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
        <ClauseGuardMark size={mark} />
      </div>
    </div>
  );
}

// ── Featured deal visual ──────────────────────────────────────
function FeaturedDealVis({ c, dark, deal }) {
  const title   = deal ? dealTitle(deal) : "Vintage Leica M6 — Hong Kong → Berlin";
  const amount  = deal ? deal.price_description : "2,400 GEN";
  const status  = deal ? deal.status : "evidence_submitted";
  const meta    = STATUS_META[status] || STATUS_META.open;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", inset: -1, borderRadius: 26, background: `linear-gradient(135deg, ${c.accent2}, ${c.accent}, ${c.accent3})`, opacity: 0.5, filter: "blur(22px)" }} />
      <Card c={c} style={{ position: "relative", padding: 0, overflow: "hidden", borderRadius: 24, background: dark ? "#0a0a22" : c.surface }}>
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
        <div style={{ padding: 24 }}>
          <SectionLabel c={c}>Clause</SectionLabel>
          <p style={{ margin: "10px 0 0", fontSize: 15, color: c.text, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            <span style={{ color: c.accent2 }}>&ldquo;</span>{title}<span style={{ color: c.accent2 }}>&rdquo;</span>
          </p>
          <div style={{ height: 1, background: c.border, margin: "20px 0" }} />
          <ValidatorRing c={c} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, alignItems: "flex-end" }}>
            <div>
              <SectionLabel c={c}>In escrow</SectionLabel>
              <div style={{ fontFamily: "'Lineca', sans-serif", fontWeight: 700, fontSize: 32, color: c.text, lineHeight: 1, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{amount}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <SectionLabel c={c}>Consensus</SectionLabel>
              <div style={{ fontFamily: "'Lineca', sans-serif", fontWeight: 700, fontSize: 32, color: c.accent2, lineHeight: 1, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                4<span style={{ fontSize: 16, color: c.textDim }}>/5</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Dialog shell ──────────────────────────────────────────────
function Dialog({ c, onClose, children, wide = false, dismissable = true }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && dismissable) onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose, dismissable]);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(5,5,16,0.78)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "4vh 20px", animation: "cg-fadein 220ms ease both" }} onClick={dismissable ? onClose : undefined}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "100%", maxWidth: wide ? 880 : 600, maxHeight: "92vh", overflowY: "auto", background: c.bgElev, border: `1px solid ${c.border}`, borderRadius: 24, boxShadow: "0 40px 90px -20px rgba(0,0,0,0.75)", animation: "cg-fadeup 320ms ease both" }}>
        {dismissable && (
          <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, zIndex: 2, width: 32, height: 32, borderRadius: 99, background: "transparent", color: c.textDim, border: `1px solid ${c.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="x" size={14} />
          </button>
        )}
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
    <div style={{ position: "fixed", top: 80, right: 24, zIndex: 400, display: "flex", flexDirection: "column", gap: 10, width: 310 }}>
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

// ── TX overlay ────────────────────────────────────────────────
function TxOverlay({ msg, c }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,5,16,0.88)", zIndex: 500, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, backdropFilter: "blur(6px)" }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", border: `4px solid ${c.border}`, borderTopColor: c.accent2, animation: "spin 0.9s linear infinite" }} />
      <div style={{ color: c.text, fontSize: 16, fontWeight: 500 }}>{msg}</div>
      <div style={{ color: c.textMute, fontSize: 13 }}>Waiting for GenLayer consensus…</div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────
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

// ══════════════════════════════════════════════════════════════
// LEGAL — acceptance gate + full Terms dialog
// ══════════════════════════════════════════════════════════════
function AcceptanceGate({ c, onAccept, onReadFull }) {
  const [checked, setChecked] = useState(false);
  return (
    <Dialog c={c} onClose={() => {}} dismissable={false}>
      <div style={{ padding: "34px 36px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, ${c.accent2}22, ${c.accent3}18)`, border: `1px solid ${c.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="scale" size={22} color={c.accent2} />
          </div>
          <Display c={c} size={26} as="h2">Before you begin</Display>
        </div>
        <p style={{ color: c.textDim, fontSize: 14, lineHeight: 1.6 }}>{LEGAL.intro}</p>
      </div>
      <div style={{ padding: "16px 36px", display: "flex", flexDirection: "column", gap: 14 }}>
        {LEGAL.sections.map((s) => (
          <div key={s.h} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ marginTop: 3, color: c.accent, flexShrink: 0 }}><StrongMark size={18} color={c.accent} /></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: c.text, marginBottom: 3 }}>{s.h}</div>
              <div style={{ fontSize: 12.5, color: c.textMute, lineHeight: 1.55 }}>{s.b.length > 200 ? s.b.slice(0, 196) + "…" : s.b}</div>
            </div>
          </div>
        ))}
        <button onClick={onReadFull} className="cg-link-underline" style={{ alignSelf: "flex-start", background: "none", border: "none", color: c.accent2, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
          Read the full Terms & Disclaimer
        </button>
      </div>
      <div style={{ padding: "18px 36px 30px", borderTop: `1px solid ${c.border}`, marginTop: 8 }}>
        <label style={{ display: "flex", gap: 11, alignItems: "flex-start", cursor: "pointer", marginBottom: 16 }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 2, accentColor: c.accent2, width: 17, height: 17, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: c.textDim, lineHeight: 1.5 }}>
            I have read and agree to the Terms & Disclaimer. I understand ClauseGuard provides no legal or financial advice, accepts no liability for loss of funds, and that disputes are resolved by binding arbitration.
          </span>
        </label>
        <Btn kind="primary" size="lg" c={c} iconRight="arrowR" disabled={!checked} onClick={onAccept} style={{ width: "100%", justifyContent: "center" }}>
          I understand &amp; agree
        </Btn>
      </div>
    </Dialog>
  );
}

function TermsDialog({ c, onClose }) {
  return (
    <Dialog c={c} onClose={onClose} wide>
      <div style={{ padding: "30px 36px 18px", borderBottom: `1px solid ${c.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Icon name="scale" size={22} color={c.accent2} />
          <Display c={c} size={26} as="h2">Terms &amp; Disclaimer</Display>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: c.textMute }}>Last updated {LEGAL.updated} · Governing law: {LEGAL.jurisdiction}</div>
      </div>
      <div style={{ padding: "24px 36px 32px", display: "flex", flexDirection: "column", gap: 22 }}>
        <p style={{ fontSize: 14, color: c.textDim, lineHeight: 1.65 }}>{LEGAL.intro}</p>
        {LEGAL.sections.map((s, i) => (
          <div key={s.h}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: c.accent }}>{String(i + 1).padStart(2, "0")}</span>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: c.text }}>{s.h}</h3>
            </div>
            <p style={{ fontSize: 13.5, color: c.textDim, lineHeight: 1.7 }}>{s.b}</p>
          </div>
        ))}
        <div style={{ fontSize: 12, color: c.textMute, lineHeight: 1.6, borderTop: `1px solid ${c.border}`, paddingTop: 18 }}>
          ClauseGuard runs on the GenLayer studionet network and is provided for evaluation. By connecting a wallet or interacting with any deal you reaffirm your acceptance of these terms.
        </div>
        <Btn kind="primary" c={c} onClick={onClose} style={{ alignSelf: "flex-end" }}>Close</Btn>
      </div>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════
// LAYOUT — Header
// ══════════════════════════════════════════════════════════════
function Header({ c, dark, onToggleTheme, walletAddress, walletLoading, onConnect, onDisconnect, onCreate, onRefresh }) {
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 100, backdropFilter: "saturate(150%) blur(20px)", WebkitBackdropFilter: "saturate(150%) blur(20px)", background: dark ? "rgba(5,5,16,0.7)" : "rgba(244,243,251,0.82)", borderBottom: `1px solid ${c.border}` }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "13px 28px", display: "flex", alignItems: "center", gap: 16 }}>
        <a href="#top" style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <ClauseGuardMark size={32} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={{ fontFamily: "'Lineca', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: "-0.02em", color: c.text }}>clauseguard</span>
            <span style={{ fontSize: 9.5, color: c.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginTop: 3 }}>Built on GenLayer</span>
          </div>
        </a>

        <nav style={{ display: "flex", gap: 6, marginLeft: 26 }}>
          {[["#deals", "Deals"], ["#how", "How it works"], ["#trust", "Trust"]].map(([href, label]) => (
            <a key={href} href={href} className="cg-link-underline" style={{ padding: "8px 12px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: c.textDim }}>{label}</a>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <button className="cg-btn" onClick={onRefresh} style={{ background: "transparent", border: `1px solid ${c.border}`, borderRadius: 99, width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", color: c.textDim, cursor: "pointer" }} title="Refresh deals">
          <Icon name="refresh" size={15} />
        </button>
        <button className="cg-btn" onClick={onToggleTheme} style={{ background: "transparent", border: `1px solid ${c.border}`, borderRadius: 99, width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", color: c.textDim, cursor: "pointer" }} title="Toggle theme">
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

// ── Hero ──────────────────────────────────────────────────────
function Hero({ c, dark, deals, onCreateClick, onConnectClick, walletAddress }) {
  const liveStats = [
    { label: "Total deals",  val: deals.length },
    { label: "Open now",     val: deals.filter((d) => d.status === "open").length },
    { label: "Settled",      val: deals.filter((d) => d.status === "settled").length },
    { label: "Validator agreement", val: "99.4%" },
  ];
  const featuredDeal = deals.find((d) => ["evidence_submitted", "verified", "funded"].includes(d.status)) || deals[deals.length - 1] || null;

  return (
    <section id="top" style={{ position: "relative", overflow: "hidden", padding: "84px 28px 0", borderBottom: `1px solid ${c.border}` }}>
      {/* Animated GenLayer gradient mesh + grain + dot grid */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-22%", left: "-10%", width: 700, height: 700, borderRadius: "50%", background: `radial-gradient(circle at 30% 30%, ${c.accent2}cc 0%, ${c.accent2}00 60%)`, filter: "blur(44px)", animation: "cg-driftA 16s ease-in-out infinite", opacity: dark ? 0.55 : 0.3 }} />
        <div style={{ position: "absolute", top: "6%", right: "-12%", width: 780, height: 780, borderRadius: "50%", background: `radial-gradient(circle at 60% 40%, ${c.accent}dd 0%, ${c.accent}00 65%)`, filter: "blur(52px)", animation: "cg-driftB 20s ease-in-out infinite", opacity: dark ? 0.55 : 0.32 }} />
        <div style={{ position: "absolute", bottom: "-34%", left: "18%", width: 860, height: 860, borderRadius: "50%", background: `radial-gradient(circle at 50% 50%, ${c.accent3}aa 0%, ${c.accent3}00 60%)`, filter: "blur(60px)", animation: "cg-driftC 24s ease-in-out infinite", opacity: dark ? 0.5 : 0.2 }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(${dark ? "rgba(255,255,255,0.05)" : "rgba(40,43,93,0.09)"} 1px, transparent 1px)`, backgroundSize: "24px 24px", maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)", WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)" }} />
      </div>

      <div className="cg-hero-grid" style={{ position: "relative", maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1.22fr 1fr", gap: 56, alignItems: "center", paddingBottom: 64 }}>
        <div style={{ animation: "cg-fadeup 700ms ease both" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 13px 5px 8px", borderRadius: 99, background: dark ? "rgba(255,255,255,0.05)" : "rgba(40,43,93,0.05)", border: `1px solid ${c.border}`, marginBottom: 26 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: c.success, boxShadow: `0 0 8px ${c.success}` }} />
            <span style={{ fontSize: 11, color: c.textDim, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>Live on GenLayer studionet</span>
          </div>

          <Display c={c} size={88} className="cg-hero-display" style={{ maxWidth: 760 }}>
            Escrow that{" "}
            <span className="cg-grad-text">reads English.</span>
          </Display>

          <p style={{ maxWidth: 530, marginTop: 24, fontSize: 18, lineHeight: 1.6, color: c.textDim }}>
            Write your deal in plain words. Lock the funds on-chain. A network of AI validators reads the evidence, agrees on the truth, and releases &mdash; or refunds &mdash; on its own. No middleman holding your money.
          </p>

          <div style={{ display: "flex", gap: 12, marginTop: 34, flexWrap: "wrap" }}>
            {walletAddress ? (
              <Btn kind="primary" size="lg" c={c} iconRight="arrowR" onClick={onCreateClick}>Start a deal</Btn>
            ) : (
              <Btn kind="primary" size="lg" c={c} icon="wallet" onClick={onConnectClick}>Connect wallet to start</Btn>
            )}
            <Btn kind="ghost" size="lg" c={c} icon="arrowDown" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>
              See how it works
            </Btn>
          </div>

          <div style={{ display: "flex", gap: 40, marginTop: 54, flexWrap: "wrap" }}>
            {liveStats.map((s, i) => (
              <Reveal key={s.label} delay={120 + i * 90}>
                <div style={{ fontFamily: "'Lineca', sans-serif", fontWeight: 700, fontSize: 34, color: c.text, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                  <CountUp value={s.val} />
                </div>
                <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", marginTop: 7, fontWeight: 600 }}>{s.label}</div>
              </Reveal>
            ))}
          </div>
        </div>

        <div style={{ animation: "cg-fadeup 700ms 180ms ease both" }}>
          <FeaturedDealVis c={c} dark={dark} deal={featuredDeal} />
        </div>
      </div>

      {/* Data-wave texture at the base of the hero */}
      <div style={{ position: "relative", marginInline: -28, marginBottom: -1 }}>
        <DataWaves c={c} opacity={dark ? 0.6 : 0.4} height={150} />
      </div>
    </section>
  );
}

// ── Marquee band ──────────────────────────────────────────────
function Marquee({ c, dark }) {
  const items = [...MARQUEE_WORDS, ...MARQUEE_WORDS];
  return (
    <div style={{ overflow: "hidden", borderBottom: `1px solid ${c.border}`, background: dark ? "rgba(255,255,255,0.015)" : "rgba(40,43,93,0.02)", padding: "16px 0" }}>
      <div style={{ display: "flex", width: "max-content", gap: 0, animation: "cg-marquee 28s linear infinite" }}>
        {items.map((w, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 30, paddingInline: 30, fontSize: 15, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: c.textMute, whiteSpace: "nowrap" }}>
            {w}
            <StrongMark size={14} color={c.accent} stroke={2.8} />
          </span>
        ))}
      </div>
    </div>
  );
}

// ── How it works ──────────────────────────────────────────────
function HowItWorks({ c }) {
  const steps = [
    { n: "01", icon: "pen",    t: "Write the clause", d: "In plain English. No legalese, no smart-contract syntax. The validators read exactly what you wrote — word for word." },
    { n: "02", icon: "lock",   t: "Lock the funds",   d: "Escrowed on the GenLayer studionet chain. Visible to both parties, untouchable by either, until AI consensus decides." },
    { n: "03", icon: "spark",  t: "AI reaches a verdict", d: "Validators crawl the open web, reason over the evidence, and agree on an outcome in minutes via Optimistic Democracy." },
  ];
  return (
    <section id="how" style={{ maxWidth: 1280, margin: "0 auto", padding: "100px 28px 40px" }}>
      <Reveal>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap", marginBottom: 48 }}>
          <div>
            <SectionLabel c={c} style={{ marginBottom: 14 }}>001 / How it works</SectionLabel>
            <Display c={c} size={52} as="h2" style={{ maxWidth: 560 }}>Trust without the middleman.</Display>
          </div>
          <p style={{ maxWidth: 360, fontSize: 15, color: c.textDim, lineHeight: 1.65 }}>
            Three steps from handshake to settlement. The hard part &mdash; deciding who&rsquo;s right &mdash; is handled by a transparent network of AI arbiters, not a company.
          </p>
        </div>
      </Reveal>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
        {steps.map((step, i) => (
          <Reveal key={step.n} delay={i * 120}>
            <Card c={c} hover style={{ height: "100%", position: "relative", overflow: "hidden" }}>
              <div aria-hidden style={{ position: "absolute", top: -20, right: -10, fontFamily: "'Lineca', sans-serif", fontWeight: 800, fontSize: 130, color: c.accent2, opacity: 0.07, lineHeight: 1 }}>{step.n}</div>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: `linear-gradient(135deg, ${c.accent2}26, ${c.accent3}1a)`, border: `1px solid ${c.border}`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
                <Icon name={step.icon} size={22} color={c.accent2} />
              </div>
              <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.16em", fontWeight: 600, marginBottom: 8 }}>STEP {step.n}</div>
              <h3 style={{ margin: 0, fontSize: 20, color: c.text, fontWeight: 700, letterSpacing: "-0.02em" }}>{step.t}</h3>
              <p style={{ margin: "10px 0 0", fontSize: 14.5, color: c.textDim, lineHeight: 1.6 }}>{step.d}</p>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── Trust band (validator consensus explainer) ────────────────
function TrustBand({ c, dark }) {
  const points = [
    { t: "A diverse network, not one judge", d: "Many independent AI validators each reach their own conclusion. No single model, company, or person decides your outcome." },
    { t: "Evidence from the open web", d: "Validators crawl the verification URLs and public sources you provide, then reason over what they find." },
    { t: "Optimistic Democracy", d: "Validators converge on a verdict. Disagreement triggers re-review and appeal — settlement only happens on consensus." },
  ];
  return (
    <section id="trust" style={{ position: "relative", overflow: "hidden", borderTop: `1px solid ${c.border}`, borderBottom: `1px solid ${c.border}`, background: dark ? "rgba(155,106,246,0.03)" : "rgba(155,106,246,0.04)" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.5 }}>
        <div style={{ position: "absolute", bottom: -120, left: "50%", transform: "translateX(-50%)", width: 1100, height: 360, background: `radial-gradient(ellipse at center, ${c.accent}22 0%, transparent 70%)`, filter: "blur(30px)" }} />
      </div>
      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto", padding: "96px 28px", display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 64, alignItems: "center" }} className="cg-hero-grid">
        <Reveal>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            <div style={{ transform: "scale(1.4)", margin: "20px 0" }}>
              <ValidatorRing c={c} mark={40} />
            </div>
            <div style={{ fontSize: 12, color: c.textMute, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600 }}>5 validators · 4 in agreement</div>
          </div>
        </Reveal>
        <div>
          <Reveal>
            <SectionLabel c={c} style={{ marginBottom: 14 }}>002 / Why you can trust it</SectionLabel>
            <Display c={c} size={46} as="h2" style={{ maxWidth: 520, marginBottom: 32 }}>
              Nobody holds the gavel. <span className="cg-grad-text">Everybody checks the work.</span>
            </Display>
          </Reveal>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {points.map((p, i) => (
              <Reveal key={p.t} delay={i * 110}>
                <div style={{ display: "flex", gap: 16, padding: "16px 0", borderTop: `1px solid ${c.border}` }}>
                  <div style={{ flexShrink: 0, marginTop: 2 }}><StrongMark size={22} color={c.accent2} /></div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: c.text, marginBottom: 5 }}>{p.t}</div>
                    <div style={{ fontSize: 14, color: c.textDim, lineHeight: 1.6 }}>{p.d}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════
// DEAL FLOWS (functionality preserved)
// ══════════════════════════════════════════════════════════════
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

function VerdictPanel({ c, verdictDetails }) {
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
            <div style={{ fontFamily: "'Lineca', sans-serif", fontWeight: 700, fontSize: 22, color: c.text, lineHeight: 1 }}>
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

// Appeal / dispute panel — shown when validators fail to reach consensus.
// While attempts remain, parties can add evidence and re-verify; once the
// on-chain attempt cap is hit, the deal falls back to binding arbitration.
function AppealPanel({ c, verdictDetails, attempts, attemptsLeft, appealsExhausted, onAddEvidence, onReVerify, onShowTerms }) {
  const pct = confidencePct(verdictDetails?.confidence);
  const termsLink = { background: "none", border: "none", padding: 0, color: c.accent, fontWeight: 600, cursor: "pointer", fontSize: "inherit", textDecoration: "underline" };

  if (appealsExhausted) {
    return (
      <div style={{ marginTop: 14, padding: "18px 18px 16px", borderRadius: 14, border: `1px solid ${c.danger}55`, background: "linear-gradient(135deg, rgba(255,107,138,0.10), rgba(255,107,138,0.02))", animation: "cg-fadeup 500ms ease both" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 99, background: c.danger, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="x" size={15} color="#fff" />
          </div>
          <span style={{ fontFamily: "'Lineca', sans-serif", fontWeight: 700, fontSize: 18, color: c.text }}>On-chain appeals exhausted</span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: c.textDim, lineHeight: 1.55 }}>
          All {MAX_VERIFICATION_ATTEMPTS} verification attempts were used without validator consensus. The contract will not re-verify this deal again — funds stay locked until the dispute is resolved off-chain.
        </p>
        {verdictDetails?.reasoning && (
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: c.textMute, lineHeight: 1.55, fontStyle: "italic", borderLeft: `2px solid ${c.danger}55`, paddingLeft: 10 }}>
            Last verdict: {verdictDetails.reasoning}
          </p>
        )}
        <div style={{ marginTop: 14, fontSize: 12.5, color: c.textDim, lineHeight: 1.55 }}>
          Per the{" "}
          <button onClick={onShowTerms} style={termsLink}>Terms &amp; Disclaimer</button>, unresolved disputes are settled by final and binding individual arbitration.
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, padding: 16, borderRadius: 14, border: "1px solid rgba(255,181,71,0.40)", background: "rgba(255,181,71,0.07)", animation: "cg-fadeup 500ms ease both" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="spark" size={15} color={c.warn} />
          <span style={{ fontWeight: 700, fontSize: 14, color: c.warn }}>Contested — no consensus</span>
        </div>
        <span style={{ fontSize: 11, color: c.textMute, fontVariantNumeric: "tabular-nums" }}>Attempt {attempts} of {MAX_VERIFICATION_ATTEMPTS}</span>
      </div>
      <div style={{ fontSize: 12, color: c.textDim, lineHeight: 1.55, marginBottom: 10 }}>
        Validators could not agree on a verdict{typeof pct === "number" ? ` (low confidence · ${pct}%)` : ""}. Add stronger evidence, then re-request verification to break the tie.
      </div>
      {verdictDetails?.reasoning && (
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: c.textMute, lineHeight: 1.55, fontStyle: "italic", borderLeft: "2px solid rgba(255,181,71,0.5)", paddingLeft: 10 }}>{verdictDetails.reasoning}</p>
      )}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {Array.from({ length: MAX_VERIFICATION_ATTEMPTS }).map((_, i) => (
          <span key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: i < attempts ? c.warn : c.border }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="ghost" c={c} size="sm" icon="upload" style={{ flex: 1 }} onClick={onAddEvidence}>Add evidence</Btn>
        <Btn kind="primary" c={c} size="sm" icon="spark" style={{ flex: 1 }} onClick={onReVerify}>Re-request verification</Btn>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: c.textMute }}>
        {attemptsLeft} {attemptsLeft === 1 ? "attempt" : "attempts"} remaining before appeals are exhausted.
      </div>
    </div>
  );
}

// Evidence-strength meter — reflects how credibly a validator can read a link
function StrengthMeter({ c, analysis }) {
  if (!analysis || analysis.state === "empty") {
    return <div style={{ fontSize: 11.5, color: c.textMute }}>Paste a public link to your proof — validators read the page text, so links beat screenshots.</div>;
  }
  if (analysis.state === "invalid") {
    return <div style={{ fontSize: 12, color: c.danger, display: "flex", alignItems: "center", gap: 6 }}><Icon name="x" size={13} color={c.danger} />{analysis.reason}</div>;
  }
  const colorFor = { strong: c.success, medium: c.warn, weak: c.danger };
  const col = colorFor[analysis.strength];
  const segs = STRENGTH_META[analysis.strength]?.segments || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 12px", borderRadius: 10, border: `1px solid ${col}44`, background: `${col}0d` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 22, height: 5, borderRadius: 3, background: i < segs ? col : c.border }} />
          ))}
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{STRENGTH_META[analysis.strength]?.label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: c.textMute, fontFamily: "ui-monospace, monospace" }}>{analysis.category}</span>
      </div>
      <div style={{ fontSize: 11.5, color: c.textDim, lineHeight: 1.45 }}>{analysis.why}</div>
    </div>
  );
}

function EvidenceForm({ deal, walletAddress, provider, c, onSuccess, onCancel, toast }) {
  const [evType, setEvType]     = useState("delivery_proof");
  const [evUrl, setEvUrl]       = useState("");
  const [evDesc, setEvDesc]     = useState("");
  const [submitting, setSubmitting] = useState(false);

  const analysis = useMemo(() => analyzeProofUrl(evUrl), [evUrl]);
  const presets = PROOF_PRESETS[evType] || [];

  const inp = { background: c.bgElev, border: `1px solid ${c.border}`, borderRadius: 10, padding: "11px 14px", color: c.text, fontSize: 14, width: "100%", outline: "none", transition: "border-color 200ms" };

  async function handleSubmit() {
    if (analysis.state !== "ok") { toast(analysis.reason || "Add a valid https:// proof link", "error"); return; }
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

      {presets.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: c.textMute }}>Best sources:</span>
          {presets.map((p) => (
            <span key={p} style={{ fontSize: 11, fontWeight: 600, color: c.accent, background: `${c.accent}14`, border: `1px solid ${c.accent}33`, padding: "3px 9px", borderRadius: 99 }}>{p}</span>
          ))}
        </div>
      )}

      <Field c={c} label="Proof Link (https://)">
        <input value={evUrl} onChange={(e) => setEvUrl(e.target.value)} placeholder="https://www.fedex.com/track?... or an explorer / order link" maxLength={500} style={inp} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
      </Field>

      <StrengthMeter c={c} analysis={analysis} />

      <Field c={c} label="Description">
        <textarea value={evDesc} onChange={(e) => setEvDesc(e.target.value)} placeholder="What does this link show, and how does it satisfy the terms?" rows={3} maxLength={500} style={{ ...inp, resize: "vertical" }} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
      </Field>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn kind="ghost" c={c} onClick={onCancel} style={{ flex: 1 }}>Cancel</Btn>
        <Btn kind="primary" c={c} onClick={handleSubmit} disabled={submitting || analysis.state !== "ok"} style={{ flex: 2 }}>{submitting ? "Submitting…" : "Submit On-Chain"}</Btn>
      </div>
    </div>
  );
}

function CreateDealDialog({ c, walletAddress, provider, onClose, onSuccess, toast }) {
  const [terms, setTerms]       = useState("");
  const [price, setPrice]       = useState("");
  const [deadline, setDeadline] = useState("");
  const [urls, setUrls]         = useState("");
  const [minSources, setMinSources] = useState(1);
  const [collateral, setCollateral] = useState("");
  const [loading, setLoading]   = useState(false);

  const inp = { background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "11px 14px", color: c.text, fontSize: 14, width: "100%", outline: "none", transition: "border-color 200ms", fontFamily: "inherit" };

  async function handleCreate() {
    if (!terms.trim())    { toast("Deal terms are required", "error"); return; }
    if (!price.trim())    { toast("Price description is required", "error"); return; }
    if (!deadline.trim()) { toast("Deadline is required", "error"); return; }
    try {
      setLoading(true);
      const urlArray = urls.split(",").map((u) => u.trim()).filter(Boolean);
      await GL.createDeal(walletAddress, provider, { terms: terms.trim(), priceDescription: price.trim(), deadlineDescription: deadline.trim(), verificationUrls: urlArray, minSourcesRequired: minSources, collateralWei: genToWei(collateral) });
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
          <Display c={c} size={28} as="h2">New escrow deal</Display>
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

        {/* Good-faith collateral */}
        <div style={{ padding: 16, borderRadius: 12, border: `1px solid ${c.border}`, background: c.surface }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Icon name="shield" size={15} color={c.accent2} />
            <span style={{ fontSize: 13, fontWeight: 700, color: c.text }}>Good-faith collateral</span>
            <span style={{ fontSize: 11, color: c.textMute }}>optional</span>
          </div>
          <p style={{ fontSize: 12, color: c.textDim, lineHeight: 1.5, marginBottom: 10 }}>
            Post a bond and the buyer must match it. Both bonds return when the deal settles. If you fail to deliver — conditions unmet or deadline passed — your bond goes to the buyer. Skin in the game for both sides.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input value={collateral} onChange={(e) => setCollateral(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" style={{ ...inp, width: 130 }} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
            <span style={{ fontSize: 13, color: c.textDim, fontWeight: 600 }}>GEN bond each</span>
          </div>
          {parseFloat(collateral) > 0 && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: c.accent2 }}>
              You&rsquo;ll lock {collateral} GEN now. Buyer locks {collateral} GEN on top of the price.
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "18px 32px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${c.border}`, gap: 12 }}>
        <span style={{ fontSize: 12, color: c.textMute }}>{parseFloat(collateral) > 0 ? `Bonded deal · you lock ${collateral} GEN on creation` : "Deal visible to buyers immediately after creation"}</span>
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

function DealDetailDialog({ c, deal, walletAddress, provider, onClose, onRefresh, toast, onShowTerms }) {
  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const [showCounterForm, setShowCounterForm]   = useState(false);
  const [counterTermsInput, setCounterTermsInput] = useState("");
  const [fundAmt, setFundAmt] = useState("");
  const [txMsg, setTxMsg]     = useState(null);
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

  let settlement = null;
  try { settlement = deal.settlement ? JSON.parse(deal.settlement) : null; } catch {}

  let fundedWei = 0n;
  try { fundedWei = BigInt(deal.funded_amount || "0"); } catch {}
  const isFunded = fundedWei > 0n;
  const bond = hasCollateral(deal);

  const attempts = parseInt(deal.verification_attempts || "0") || 0;
  const attemptsLeft = Math.max(0, MAX_VERIFICATION_ATTEMPTS - attempts);
  const appealsExhausted = attempts >= MAX_VERIFICATION_ATTEMPTS;

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

      <div style={{ padding: "24px 32px", borderBottom: `1px solid ${c.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <Pill c={c} tone={meta.tone}>{meta.label}</Pill>
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: c.textMute }}>Deal #{deal.id}</span>
          <span style={{ flex: 1 }} />
          {deal.price_description && (
            <span style={{ fontFamily: "'Lineca', sans-serif", fontWeight: 700, fontSize: 26, color: c.text, fontVariantNumeric: "tabular-nums" }}>{deal.price_description}</span>
          )}
        </div>
        <Display c={c} size={24} as="h2" style={{ marginBottom: 10 }}>{dealTitle(deal)}</Display>
        <p style={{ fontSize: 14, color: c.textDim, lineHeight: 1.6, maxWidth: 720, fontStyle: "italic", borderLeft: `2px solid ${c.borderHi}`, paddingLeft: 14 }}>
          &ldquo;{deal.terms}&rdquo;
        </p>
        <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 12, color: c.textMute, flexWrap: "wrap" }}>
          {deal.deadline_description && <span><Icon name="clock" size={11} /> {deal.deadline_description}</span>}
          <span>Seller: <span style={{ color: isSeller ? c.accent : c.text, fontFamily: "ui-monospace, monospace" }}>{shortAddr(deal.seller)}{isSeller ? " (you)" : ""}</span></span>
          {deal.buyer && <span>Buyer: <span style={{ color: isBuyer ? c.accent : c.text, fontFamily: "ui-monospace, monospace" }}>{shortAddr(deal.buyer)}{isBuyer ? " (you)" : ""}</span></span>}
        </div>
      </div>

      {isParty && (
        <div style={{ padding: "22px 32px", borderBottom: `1px solid ${c.border}` }}>
          <Pipeline c={c} status={status} />
        </div>
      )}

      <div className="cg-detail-grid" style={{ padding: "20px 32px 28px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
        <div>
          {/* Auto on-chain payment proof — the chain is the receipt */}
          {isFunded && (
            <div style={{ marginBottom: 18, padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(91,227,164,0.4)", background: "linear-gradient(135deg, rgba(91,227,164,0.1), rgba(91,227,164,0.02))" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 99, background: c.success, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 0 14px ${c.success}77` }}>
                  <Icon name="lock" size={15} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: c.text }}>Payment locked on-chain</div>
                  <div style={{ fontSize: 11.5, color: c.textDim }}>No receipt needed — the ledger is the proof.</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "'Lineca', sans-serif", fontWeight: 700, fontSize: 20, color: c.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{fmtGen(deal.funded_amount)}</div>
                  <div style={{ fontSize: 10, color: c.textMute, letterSpacing: "0.08em" }}>GEN ESCROW</div>
                </div>
              </div>
              {CONTRACT && (
                <a href={`${EXPLORER}${CONTRACT}`} target="_blank" rel="noreferrer" className="cg-link-underline" style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 10, fontSize: 11.5, color: c.accent }}>
                  <Icon name="link" size={11} />View on GenLayer explorer
                </a>
              )}
            </div>
          )}

          {/* Collateral / good-faith bond status */}
          {bond && (
            <div style={{ marginBottom: 18, padding: "14px 16px", borderRadius: 12, border: `1px solid ${c.accent}40`, background: `${c.accent}0c` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Icon name="shield" size={15} color={c.accent2} />
                <span style={{ fontSize: 13, fontWeight: 700, color: c.text }}>Good-faith bond · {fmtGen(deal.collateral_amount)} GEN each</span>
              </div>
              {settlement ? (
                <div style={{ fontSize: 12, color: c.textDim, lineHeight: 1.5 }}>
                  {(settlement.seller_collateral === "split_buyer_protocol" || settlement.seller_collateral === "slashed_to_buyer")
                    ? `Seller did not deliver — their bond was split: ${fmtGen(settlement.seller_collateral_to_buyer || deal.collateral_amount)} GEN to the buyer, the rest retained by the protocol.`
                    : "Both bonds were returned to their owners."}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: c.textDim, lineHeight: 1.5 }}>
                  {isFunded ? "Both parties are bonded. Bonds return in full on settlement. If the deal is rejected or expires, the seller's bond is split 50/50 — half to the buyer, half retained by the protocol." : "Seller has posted their bond. The buyer matches it when funding."}
                </div>
              )}
            </div>
          )}

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
                  <a key={i} href={u.trim()} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: c.accent, background: c.surface, padding: "4px 10px", borderRadius: 99, border: `1px solid ${c.border}` }}>
                    <Icon name="link" size={11} />{u.trim().slice(0, 32)}{u.trim().length > 32 ? "…" : ""}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <SectionLabel c={c}>{status === "disputed" ? "Appeal" : verdictDetails ? "Verdict" : verifying ? "AI consensus in progress" : "Actions"}</SectionLabel>

          {verifying && <VerifyingState c={c} stage={verifyStage} validators={validators} />}
          {!verifying && verdictDetails && status !== "disputed" && <VerdictPanel c={c} verdictDetails={verdictDetails} />}

          {!verifying && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: verdictDetails ? 16 : 12 }}>

              {status === "disputed" && isParty && (
                <AppealPanel
                  c={c}
                  verdictDetails={verdictDetails}
                  attempts={attempts}
                  attemptsLeft={attemptsLeft}
                  appealsExhausted={appealsExhausted}
                  onAddEvidence={() => setShowEvidenceForm(true)}
                  onReVerify={runVerification}
                  onShowTerms={() => { onShowTerms?.(); }}
                />
              )}

              {deal.min_sources_required && parseInt(deal.min_sources_required) > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, border: `1px solid ${c.accent}33`, background: `${c.accent}08`, fontSize: 12, color: c.textDim }}>
                  <Icon name="shield" size={13} color={c.accent} />
                  Multi-sig: requires evidence from <span style={{ color: c.accent, fontWeight: 700, marginInline: 3 }}>{deal.min_sources_required}</span> independent sources
                </div>
              )}

              {status === "open" && !isSeller && walletAddress && (
                <div>
                  <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Fund this deal</div>
                  <div style={{ fontSize: 12, color: c.textDim, marginBottom: 8 }}>{bond ? "Escrow price in GEN" : "Amount in GEN"}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={fundAmt} onChange={(e) => setFundAmt(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 1.5" style={inp} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
                    <Btn kind="primary" c={c} disabled={!fundAmt || parseFloat(fundAmt) <= 0} onClick={() => {
                      const priceWei = BigInt(genToWei(fundAmt));
                      const total = priceWei + BigInt(deal.collateral_amount || "0");
                      tx("Funding deal…", () => GL.fundDeal(walletAddress, provider, parseInt(deal.id), total.toString()));
                    }}>{bond ? "Fund + bond" : "Fund"}</Btn>
                  </div>
                  {bond && (
                    <div style={{ marginTop: 8, fontSize: 11.5, color: c.textDim, lineHeight: 1.5, padding: "8px 10px", borderRadius: 8, background: `${c.accent}0c`, border: `1px solid ${c.accent}26` }}>
                      You&rsquo;ll lock <strong style={{ color: c.text }}>{fundAmt || "0"} GEN</strong> price + <strong style={{ color: c.text }}>{fmtGen(deal.collateral_amount)} GEN</strong> bond ={" "}
                      <strong style={{ color: c.accent2 }}>{(parseFloat(fundAmt || "0") + parseFloat(fmtGen(deal.collateral_amount))).toString()} GEN</strong> total.
                    </div>
                  )}
                </div>
              )}

              {deal.pending_terms && isSeller && (
                <div style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,181,71,0.35)", background: "rgba(255,181,71,0.06)" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: c.warn, marginBottom: 6 }}>Amendment Proposed</div>
                  <p style={{ fontSize: 12, color: c.textDim, lineHeight: 1.55, fontStyle: "italic", borderLeft: "2px solid rgba(255,181,71,0.5)", paddingLeft: 10, marginBottom: 8 }}>&ldquo;{deal.pending_terms}&rdquo;</p>
                  <div style={{ fontSize: 11, color: c.textMute, marginBottom: 10 }}>From: <span style={{ fontFamily: "ui-monospace, monospace" }}>{shortAddr(deal.pending_terms_from)}</span></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn kind="success" c={c} size="sm" icon="check" style={{ flex: 1 }} onClick={() => tx("Accepting counter-terms…", () => GL.acceptCounterTerms(walletAddress, provider, parseInt(deal.id)))}>Accept</Btn>
                    <Btn kind="danger"  c={c} size="sm" icon="x"     style={{ flex: 1 }} onClick={() => tx("Rejecting counter-terms…", () => GL.rejectCounterTerms(walletAddress, provider, parseInt(deal.id)))}>Reject</Btn>
                  </div>
                </div>
              )}

              {deal.pending_terms && !isSeller && walletAddress?.toLowerCase() === deal.pending_terms_from?.toLowerCase() && (
                <div style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${c.accent}33`, background: `${c.accent}08`, fontSize: 12, color: c.textDim }}>
                  <span style={{ color: c.accent, fontWeight: 600 }}>Your counter-terms are pending seller review.</span>
                </div>
              )}

              {!deal.pending_terms && !isSeller && ["open", "funded"].includes(status) && walletAddress && !showCounterForm && (
                <Btn kind="ghost" c={c} size="sm" style={{ width: "100%" }} onClick={() => setShowCounterForm(true)}>Propose Counter-terms</Btn>
              )}

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

              {status === "evidence_submitted" && isSeller && (
                <Btn kind="primary" c={c} icon="spark" onClick={runVerification}>Run AI Verification</Btn>
              )}

              {["funded", "evidence_submitted"].includes(status) && isParty && (
                <Btn kind="ghost" c={c} size="sm" icon="clock" onClick={() => tx("Checking deadline…", () => GL.checkDeadline(walletAddress, provider, parseInt(deal.id)))}>Check Deadline</Btn>
              )}

              {status === "verified" && isParty && (
                <Btn kind="success" c={c} icon="check" onClick={() => tx("Settling deal…", () => GL.settleDeal(walletAddress, provider, parseInt(deal.id)))}>Settle &amp; Release Funds</Btn>
              )}

              {status === "rejected" && isBuyer && (
                <Btn kind="danger" c={c} icon="x" onClick={() => tx("Claiming refund…", () => GL.claimRefund(walletAddress, provider, parseInt(deal.id)))}>Claim Refund</Btn>
              )}

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

function DealCard({ deal, walletAddress, c, onOpen }) {
  const status  = deal.status || "open";
  const meta    = STATUS_META[status] || STATUS_META.open;
  const isAddr  = (a) => a && walletAddress && a.toLowerCase() === walletAddress.toLowerCase();
  const isSeller = isAddr(deal.seller);
  const isBuyer  = isAddr(deal.buyer);
  const title   = dealTitle(deal);

  return (
    <Card c={c} hover onClick={() => onOpen(deal)} style={{ cursor: "pointer", position: "relative", overflow: "hidden", height: "100%" }}>
      <div style={{ position: "absolute", top: 14, right: 14, width: 8, height: 8, borderRadius: 99, background: meta.tone === "verifying" ? c.accent2 : (meta.tone === "funded" || meta.tone === "released") ? c.success : c.textMute, boxShadow: meta.tone === "verifying" ? `0 0 10px ${c.accent2}` : "none" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: c.textMute }}>#{deal.id}</span>
        <span style={{ flex: 1 }} />
        {hasCollateral(deal) && (
          <span title="Good-faith bond" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: c.accent2, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", background: `${c.accent2}15`, padding: "3px 7px", borderRadius: 99 }}>
            <Icon name="shield" size={10} color={c.accent2} />Bonded
          </span>
        )}
        <Pill c={c} tone={meta.tone}>{meta.label}</Pill>
        {(isSeller || isBuyer) && (
          <span style={{ fontSize: 10, color: c.accent, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", background: `${c.accent}18`, padding: "3px 7px", borderRadius: 99 }}>
            {isSeller ? "Your deal" : "Buyer"}
          </span>
        )}
      </div>

      <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: c.text, letterSpacing: "-0.01em", lineHeight: 1.3 }}>{title}</h3>
      <p style={{ margin: "8px 0 0", fontSize: 13, color: c.textDim, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{deal.terms}</p>

      <div style={{ height: 1, background: c.border, margin: "16px 0 14px" }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          {deal.price_description && (
            <>
              <div style={{ fontSize: 10, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}>Amount</div>
              <div style={{ fontFamily: "'Lineca', sans-serif", fontWeight: 700, fontSize: 22, color: c.text, lineHeight: 1, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{deal.price_description}</div>
            </>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: c.textMute, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}>Seller</div>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: c.textDim, marginTop: 4 }}>{shortAddr(deal.seller)}</div>
        </div>
      </div>
    </Card>
  );
}

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
  const [reduceMotion, setReduceMotion] = useState(false);

  const c = T[dark ? "dark" : "light"];

  const { open } = useAppKit();
  const { address: walletAddress } = useAppKitAccount();
  const { walletProvider: provider } = useAppKitProvider("eip155");
  const { disconnect } = useDisconnect();
  const walletLoading = false;

  const [accepted, setAccepted] = useState(true); // assume accepted until we read storage (avoids SSR flash)
  const [showTerms, setShowTerms] = useState(false);

  const [deals, setDeals]             = useState([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealsError, setDealsError]   = useState(null);

  const [tab, setTab]         = useState("all");
  const [search, setSearch]   = useState("");
  const [openDeal, setOpenDeal]   = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const { toasts, add: toast } = useToast();

  // ── First-visit acceptance gate ─────────────────────────────
  useEffect(() => {
    try {
      const ok = localStorage.getItem("cg_terms_accepted_v1");
      if (!ok) setAccepted(false);
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setReduceMotion(true);
    } catch {}
  }, []);
  const acceptTerms = useCallback(() => {
    try { localStorage.setItem("cg_terms_accepted_v1", new Date().toISOString()); } catch {}
    setAccepted(true);
  }, []);

  const connectWallet = useCallback(() => open(), [open]);
  const disconnectWallet = useCallback(() => disconnect(), [disconnect]);

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
  }, [toast]);

  useEffect(() => { loadDeals(); }, [loadDeals]);

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
    <div className={reduceMotion ? "cg-rm" : ""} style={{ minHeight: "100vh", background: c.bg, color: c.text }}>
      <GlobalStyles dark={dark} />

      <Header c={c} dark={dark} onToggleTheme={() => setDark((d) => !d)} walletAddress={walletAddress} walletLoading={walletLoading} onConnect={connectWallet} onDisconnect={disconnectWallet} onCreate={() => walletAddress ? setShowCreate(true) : connectWallet()} onRefresh={loadDeals} />

      <Hero c={c} dark={dark} deals={deals} onCreateClick={() => setShowCreate(true)} onConnectClick={connectWallet} walletAddress={walletAddress} />

      <Marquee c={c} dark={dark} />

      <HowItWorks c={c} />

      <TrustBand c={c} dark={dark} />

      <main id="deals" style={{ maxWidth: 1280, margin: "0 auto", padding: "100px 28px 120px" }}>
        <Reveal>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 36, gap: 16, flexWrap: "wrap" }}>
            <div>
              <SectionLabel c={c} style={{ marginBottom: 12 }}>003 / Marketplace</SectionLabel>
              <Display c={c} size={44} as="h2">{tab === "mine" ? "My deals" : tab === "open" ? "Open marketplace" : "Active escrow"}</Display>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <span style={{ position: "absolute", left: 14, color: c.textMute, pointerEvents: "none" }}><Icon name="search" size={14} /></span>
                <input type="search" placeholder="Search deals…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 99, padding: "8px 16px 8px 36px", color: c.text, fontSize: 13, outline: "none", width: 210, fontFamily: "inherit", transition: "border-color 200ms" }} onFocus={(e) => (e.target.style.borderColor = c.borderHi)} onBlur={(e) => (e.target.style.borderColor = c.border)} />
              </div>
              <SegmentedControl c={c} options={[["all", "All"], ["open", "Open"], ["mine", "Mine"]]} value={tab} onChange={setTab} />
            </div>
          </div>
        </Reveal>

        {dealsLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 18 }}>
            {[0, 1, 2].map((i) => <SkeletonCard key={i} c={c} />)}
          </div>
        )}

        {dealsError && !dealsLoading && (
          <div style={{ background: `${c.danger}18`, border: `1px solid ${c.danger}44`, borderRadius: 14, padding: "24px 28px", marginBottom: 20 }}>
            <div style={{ fontWeight: 700, color: c.danger, marginBottom: 6 }}>Failed to load deals</div>
            <div style={{ fontSize: 13, color: c.textDim }}>{dealsError}</div>
            <Btn kind="danger" c={c} style={{ marginTop: 14 }} onClick={loadDeals}>Retry</Btn>
          </div>
        )}

        {!dealsLoading && !dealsError && filteredDeals.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 24px", background: c.surface, borderRadius: 20, border: `1px solid ${c.border}` }}>
            <ClauseGuardMark size={52} animated={false} />
            <h3 style={{ fontSize: 20, fontWeight: 700, color: c.text, margin: "20px 0 10px" }}>
              {tab === "mine" ? "No deals yet" : tab === "open" ? "No open deals" : "No deals on-chain yet"}
            </h3>
            <p style={{ fontSize: 14, color: c.textMute, marginBottom: 24 }}>
              {tab === "mine" ? "Create your first deal to get started." : "Be the first to write a clause."}
            </p>
            {walletAddress && <Btn kind="primary" c={c} icon="plus" onClick={() => setShowCreate(true)}>Create a deal</Btn>}
          </div>
        )}

        {!dealsLoading && !dealsError && filteredDeals.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 18 }}>
            {filteredDeals.slice().reverse().map((deal, i) => (
              <Reveal key={deal.id} delay={Math.min(i, 6) * 70}>
                <DealCard deal={deal} walletAddress={walletAddress} c={c} onOpen={setOpenDeal} />
              </Reveal>
            ))}
          </div>
        )}
      </main>

      {/* Mochi mascot moment */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px 40px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div style={{ position: "relative", animation: reduceMotion ? "none" : "cg-bob 5s ease-in-out infinite" }}>
          <div aria-hidden style={{ position: "absolute", inset: -24, borderRadius: "50%", background: `radial-gradient(circle, ${c.accent2}55 0%, transparent 65%)`, filter: "blur(26px)", pointerEvents: "none" }} />
          <Mochi size={140} />
          <div style={{ position: "absolute", top: 8, right: -186, width: 168, background: c.bgElev, border: `1px solid ${c.borderHi}`, borderRadius: 14, padding: "11px 15px", fontSize: 12, color: c.textDim, lineHeight: 1.45, boxShadow: c.shadow }}>
            <span style={{ color: c.text, fontWeight: 700 }}>Mochi</span> here — your friendly escrow validator. I read the evidence so you don&rsquo;t have to argue.
            <div style={{ position: "absolute", left: -7, top: 18, width: 12, height: 12, background: c.bgElev, borderLeft: `1px solid ${c.borderHi}`, borderBottom: `1px solid ${c.borderHi}`, transform: "rotate(45deg)" }} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600, textAlign: "center" }}>Built on GenLayer · Intelligent Contracts + Optimistic Democracy</div>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${c.border}`, marginTop: 20 }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 28px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
          <div style={{ maxWidth: 420 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <ClauseGuardMark size={22} animated={false} />
              <span style={{ fontFamily: "'Lineca', sans-serif", fontWeight: 700, fontSize: 15, color: c.text }}>clauseguard</span>
            </div>
            <p style={{ fontSize: 12.5, color: c.textMute, lineHeight: 1.6 }}>
              Experimental, non-custodial P2P escrow on GenLayer studionet. ClauseGuard is not a law firm and provides no legal or financial advice. AI verdicts are not legally binding. Use at your own risk — see the{" "}
              <button onClick={() => setShowTerms(true)} className="cg-link-underline" style={{ background: "none", border: "none", color: c.accent, fontSize: 12.5, padding: 0, cursor: "pointer", fontWeight: 600 }}>Terms &amp; Disclaimer</button>.
            </p>
          </div>
          <div style={{ display: "flex", gap: 56, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <SectionLabel c={c} style={{ marginBottom: 4 }}>Product</SectionLabel>
              <a href="#deals" className="cg-link-underline" style={{ fontSize: 13, color: c.textDim }}>Deals</a>
              <a href="#how" className="cg-link-underline" style={{ fontSize: 13, color: c.textDim }}>How it works</a>
              <a href="#trust" className="cg-link-underline" style={{ fontSize: 13, color: c.textDim }}>Trust model</a>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <SectionLabel c={c} style={{ marginBottom: 4 }}>On-chain</SectionLabel>
              <a href={`https://explorer-studio.genlayer.com/address/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer" className="cg-link-underline" style={{ fontSize: 13, color: c.textDim, fontFamily: "ui-monospace, monospace" }}>{process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ? shortAddr(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS) : "Contract"}</a>
              <a href="https://genlayer.com" target="_blank" rel="noreferrer" className="cg-link-underline" style={{ fontSize: 13, color: c.textDim }}>GenLayer</a>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <SectionLabel c={c} style={{ marginBottom: 4 }}>Legal</SectionLabel>
              <button onClick={() => setShowTerms(true)} className="cg-link-underline" style={{ fontSize: 13, color: c.textDim, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>Terms &amp; Disclaimer</button>
            </div>
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${c.border}` }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, fontSize: 11.5, color: c.textMute }}>
            <span>© {new Date().getFullYear()} ClauseGuard · Built on GenLayer</span>
            <span>studionet · testnet</span>
          </div>
        </div>
      </footer>

      {/* Modals */}
      {!accepted && <AcceptanceGate c={c} onAccept={acceptTerms} onReadFull={() => setShowTerms(true)} />}
      {showTerms && <TermsDialog c={c} onClose={() => setShowTerms(false)} />}
      {showCreate && <CreateDealDialog c={c} walletAddress={walletAddress} provider={provider} toast={toast} onClose={() => setShowCreate(false)} onSuccess={async () => { setShowCreate(false); await loadDeals(); }} />}
      {openDeal   && <DealDetailDialog c={c} deal={openDeal} walletAddress={walletAddress} provider={provider} toast={toast} onClose={() => setOpenDeal(null)} onRefresh={loadDeals} onShowTerms={() => { setOpenDeal(null); setShowTerms(true); }} />}

      <ToastStack toasts={toasts} c={c} />
    </div>
  );
}
