"use client";

import { useState, useEffect, useCallback, useRef, useMemo, useId } from "react";
import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { useDisconnect } from "wagmi";
import * as GL from "./lib/genlayer";
import { analyzeProofUrl, PROOF_PRESETS, STRENGTH_META } from "./lib/proof";

// ══════════════════════════════════════════════════════════════
// THE MACHINE NOTARY — design system
//   Paper & ink for human agreement. Phosphor terminal for
//   machine judgment. One committed light "paper" theme.
// ══════════════════════════════════════════════════════════════
const C = {
  // paper world
  bg:        "#F2EDE3",                    // aged cream page
  bgElev:    "#FAF6EB",                    // raised sheet
  surface:   "#ECE5D3",                    // folder / panel paper
  surfaceHi: "#E4DBC4",                    // deep manila
  border:    "rgba(28,26,21,0.28)",        // ink rule
  borderSoft:"rgba(28,26,21,0.14)",        // faint rule
  borderHi:  "#1C1A15",                    // hard ink rule
  text:      "#1C1A15",                    // warm near-black ink
  textDim:   "#4A453B",
  textMute:  "#857D6B",
  // inks
  accent:    "#1F3FA8",                    // ballpoint blue (interactive)
  accent2:   "#C8401F",                    // vermillion seal (stamps, primary)
  accent3:   "#2E5E3A",                    // stamp green
  success:   "#2E5E3A",
  warn:      "#8F5F00",                    // legible amber on paper
  danger:    "#C8401F",
  // machine world
  terminal:  "#0D0F0C",
  termLine:  "rgba(108,240,154,0.22)",
  phosphor:  "#6CF09A",
  phosphorDim:"#49a06a",
  amber:     "#FFB547",
  // shadows: hard offset blocks, no soft glows
  shadow:    "6px 6px 0 rgba(28,26,21,0.14)",
  shadowHard:"4px 4px 0 #1C1A15",
  shadowHardSm:"3px 3px 0 #1C1A15",
  grain:     "rgba(28,26,21,0.04)",
};

const SERIF = "'Zodiak', 'Iowan Old Style', Georgia, serif";
const SANS  = "'Supreme', 'Helvetica Neue', system-ui, sans-serif";
const MONO  = "'Fragment Mono', ui-monospace, 'SFMono-Regular', monospace";

// ── Legal / disclaimer content ────────────────────────────────
const LEGAL = {
  updated: "June 2026",
  jurisdiction: "Delaware, USA",
  intro:
    "ClauseGuard is experimental, non-custodial software for peer-to-peer escrow on the GenLayer network. Before you use it, please read and accept the following.",
  sections: [
    {
      h: "Not legal or financial advice",
      b: "ClauseGuard is software, not a law firm, broker, or financial institution. The verdicts produced by GenLayer's AI validators are automated assessments generated from public evidence. They are not legally binding judgments and do not constitute legal, financial, tax, or investment advice. Nothing here replaces a separately enforceable written agreement or a qualified professional. For anything that matters, consult a lawyer and keep your own contract.",
    },
    {
      h: "No liability for loss of funds",
      b: "You use ClauseGuard entirely at your own risk. To the maximum extent permitted by law, ClauseGuard, its contributors, and GenLayer disclaim all warranties and accept no liability for any loss or damage (including loss of funds, tokens, or data) arising from smart-contract bugs, AI validator error or disagreement, network or chain failures, wallet or key mistakes, mis-written deal terms, third-party services, or unauthorized access. The software is provided “as is” and “as available.”",
    },
    {
      h: "Dispute resolution & governing law",
      b: "Any dispute, claim, or controversy arising out of or relating to ClauseGuard or these terms shall be resolved exclusively by final and binding individual arbitration, and not in court. You and ClauseGuard each waive the right to a jury trial and the right to participate in any class, collective, or representative action. These terms are governed by, and construed in accordance with, the laws of the State of Delaware, USA, without regard to its conflict-of-law rules.",
    },
  ],
};

const STATUS_META = {
  open:               { label: "OPEN",         tone: "open",      pipeStep: 0 },
  funded:             { label: "FUNDED",       tone: "funded",    pipeStep: 1 },
  evidence_submitted: { label: "EXHIBITS IN",  tone: "verifying", pipeStep: 2 },
  verified:           { label: "AI-VERIFIED",  tone: "released",  pipeStep: 3 },
  settled:            { label: "SETTLED",      tone: "released",  pipeStep: 4 },
  rejected:           { label: "REJECTED",     tone: "refunded",  pipeStep: 3 },
  refunded:           { label: "REFUNDED",     tone: "refunded",  pipeStep: 4 },
  disputed:           { label: "CONTESTED",    tone: "disputed",  pipeStep: 3 },
  cancelled:          { label: "VACATED",      tone: "default",   pipeStep: 0 },
};

const EVIDENCE_TYPES = [
  { value: "delivery_proof",  label: "Delivery Proof"    },
  { value: "quality_report",  label: "Quality Report"    },
  { value: "tracking",        label: "Shipping Tracker"  },
  { value: "receipt",         label: "Receipt / Invoice" },
  { value: "other",           label: "Other"             },
];

const PIPELINE_STAGES = ["Filed", "Funded", "Exhibits", "Verdict", "Settled"];

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

const TAPE_ITEMS = [
  "ESCROW WITNESSED BY MACHINES",
  "PLAIN ENGLISH IN → VERDICT OUT",
  "NO MIDDLEMAN OF RECORD",
  "OPTIMISTIC DEMOCRACY",
  "FUNDS LOCKED ON-CHAIN",
  "EVIDENCE CRAWLED FROM THE OPEN WEB",
];

// ── Helpers ───────────────────────────────────────────────────
const EXPLORER = "https://explorer-studio.genlayer.com/address/";
const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

function shortAddr(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function caseNo(id) {
  return "CASE NO. " + String(id ?? 0).padStart(6, "0");
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
function Reveal({ children, delay = 0, y = 18, style }) {
  const [ref, seen] = useInView();
  return (
    <div
      ref={ref}
      style={{
        opacity: seen ? 1 : 0,
        transform: seen ? "translateY(0)" : `translateY(${y}px)`,
        transition: `opacity 650ms cubic-bezier(.2,.7,.2,1) ${delay}ms, transform 650ms cubic-bezier(.2,.7,.2,1) ${delay}ms`,
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

// Typewriter — types text once when scrolled into view (phosphor panels)
function Typewriter({ text, speed = 22, startDelay = 0, style, caret = true }) {
  const [ref, seen] = useInView();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!seen) return;
    let i = 0, timer;
    const begin = setTimeout(() => {
      timer = setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length) clearInterval(timer);
      }, speed);
    }, startDelay);
    return () => { clearTimeout(begin); clearInterval(timer); };
  }, [seen, text, speed, startDelay]);
  const done = n >= text.length;
  return (
    <span ref={ref} style={style}>
      {text.slice(0, n)}
      {caret && !done && <span className="cg-caret">▌</span>}
    </span>
  );
}

// ── Global fonts, keyframes, classes ──────────────────────────
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://api.fontshare.com/v2/css?f[]=zodiak@400,401,700,701,900&f[]=supreme@400,500,700,800&display=swap');
      @import url('https://fonts.googleapis.com/css2?family=Fragment+Mono:ital@0;1&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html { scroll-behavior: smooth; }
      body {
        font-family: ${SANS};
        -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
        background: #F2EDE3;
      }
      @keyframes cg-fadeup   { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      @keyframes cg-fadein   { from { opacity:0; } to { opacity:1; } }
      @keyframes cg-stamp    { 0% { opacity:0; transform:scale(2.4) rotate(-18deg); } 55% { opacity:1; transform:scale(0.92) rotate(-7deg); } 75% { transform:scale(1.06) rotate(-9deg); } 100% { opacity:1; transform:scale(1) rotate(-8deg); } }
      @keyframes cg-stamp-sm { 0% { opacity:0; transform:scale(1.9) rotate(8deg); } 60% { opacity:1; transform:scale(0.95) rotate(-3deg); } 100% { opacity:1; transform:scale(1) rotate(-3deg); } }
      @keyframes cg-caret    { 0%,49% { opacity:1; } 50%,100% { opacity:0; } }
      @keyframes cg-scan     { from { transform:translateY(-100%); } to { transform:translateY(100%); } }
      @keyframes cg-tape     { from { transform:translateX(0); } to { transform:translateX(-50%); } }
      @keyframes cg-rotate   { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
      @keyframes cg-shimmer  { 0% { background-position:-240px 0; } 100% { background-position:240px 0; } }
      @keyframes cg-blink    { 0%,100% { opacity:1; } 50% { opacity:0.25; } }
      @keyframes cg-flicker  { 0%,100% { opacity:1; } 92% { opacity:1; } 93% { opacity:0.6; } 94% { opacity:1; } 97% { opacity:0.8; } 98% { opacity:1; } }
      @keyframes spin        { to { transform:rotate(360deg); } }
      .cg-caret { animation: cg-caret 0.85s step-end infinite; }
      .cg-skeleton {
        background: linear-gradient(90deg, rgba(28,26,21,0.05) 0%, rgba(28,26,21,0.12) 40%, rgba(28,26,21,0.05) 80%);
        background-size: 240px 100%;
        animation: cg-shimmer 1.4s linear infinite;
      }
      .cg-btn { transition: transform 120ms ease, box-shadow 120ms ease, background 160ms ease, color 160ms ease; }
      .cg-btn:hover:not(:disabled) { transform: translate(-1px,-1px); box-shadow: 5px 5px 0 #1C1A15; }
      .cg-btn:active:not(:disabled) { transform: translate(2px,2px); box-shadow: 1px 1px 0 #1C1A15; }
      .cg-btn:disabled { opacity: 0.4; cursor: not-allowed !important; }
      .cg-btn-flat:hover:not(:disabled) { transform: none; box-shadow: none; background: rgba(28,26,21,0.06); }
      .cg-btn-flat:active:not(:disabled) { transform: none; box-shadow: none; }
      .cg-link-underline { position: relative; }
      .cg-link-underline::after { content:""; position:absolute; left:0; right:100%; bottom:-2px; height:2px; background:#1F3FA8; transition:right 240ms ease; }
      .cg-link-underline:hover::after { right:0; }
      .cg-card-hover { transition: transform 200ms cubic-bezier(.2,.8,.2,1), box-shadow 200ms ease; }
      .cg-card-hover:hover { transform: translate(-2px,-2px); box-shadow: 7px 7px 0 #1C1A15 !important; }
      .cg-ruled {
        background-image: repeating-linear-gradient(transparent, transparent 27px, rgba(28,26,21,0.16) 27px, rgba(28,26,21,0.16) 28px);
        background-attachment: local;
        line-height: 28px !important;
      }
      .cg-terminal { position: relative; overflow: hidden; }
      .cg-terminal::before {
        content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 3;
        background: repeating-linear-gradient(180deg, rgba(108,240,154,0.045) 0px, rgba(108,240,154,0.045) 1px, transparent 1px, transparent 3px);
      }
      .cg-terminal::after {
        content: ""; position: absolute; left: 0; right: 0; height: 90px; top: 0; pointer-events: none; z-index: 3;
        background: linear-gradient(180deg, transparent, rgba(108,240,154,0.07), transparent);
        animation: cg-scan 7s linear infinite;
      }
      input, textarea, select { color-scheme: light; font-family: inherit; }
      ::-webkit-scrollbar { width: 9px; height: 9px; }
      ::-webkit-scrollbar-track { background: #E7DFCE; }
      ::-webkit-scrollbar-thumb { background: #1C1A15; border: 2px solid #E7DFCE; }
      *::selection { background: #C8401F; color: #F2EDE3; }
      a { color: inherit; text-decoration: none; }
      .cg-rm * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
      @media (max-width: 900px) {
        .cg-hero-grid { grid-template-columns: 1fr !important; gap: 48px !important; }
        .cg-detail-grid { grid-template-columns: 1fr !important; }
        .cg-hero-display { font-size: 54px !important; }
        .cg-microbar { display: none !important; }
        .cg-nav { display: none !important; }
        .cg-hero-seal { display: none !important; }
        .cg-tribunal-grid { grid-template-columns: 1fr !important; }
        .cg-proc-grid { grid-template-columns: 1fr !important; }
        .cg-stats-row { grid-template-columns: 1fr 1fr !important; }
      }
    `}</style>
  );
}

// Paper grain overlay + rubber-stamp roughen filter (referenced as url(#cg-rough))
function PaperFX() {
  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <filter id="cg-rough">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" result="n" seed="7" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" />
        </filter>
      </svg>
      <div
        aria-hidden
        style={{
          position: "fixed", inset: 0, zIndex: 998, pointerEvents: "none", opacity: 0.5, mixBlendMode: "multiply",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.06'/%3E%3C/svg%3E")`,
        }}
      />
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// BRAND MARKS — seal & stamps
// ══════════════════════════════════════════════════════════════

// ClauseGuard notary seal — serrated ring, rotating ring text, CG monogram
function NotarySeal({ size = 120, color = C.accent2, spin = true, paper = false }) {
  const id = useId();
  const fg = paper ? C.bg : color;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" style={{ display: "block", flexShrink: 0, overflow: "visible" }}>
      {/* serrated outer edge */}
      <g style={spin ? { transformOrigin: "60px 60px", animation: "cg-rotate 40s linear infinite" } : undefined}>
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i / 36) * Math.PI * 2;
          return <circle key={i} cx={(60 + Math.cos(a) * 56).toFixed(2)} cy={(60 + Math.sin(a) * 56).toFixed(2)} r="2.6" fill={fg} />;
        })}
        <circle cx="60" cy="60" r="50" stroke={fg} strokeWidth="2" />
        <circle cx="60" cy="60" r="34" stroke={fg} strokeWidth="1.2" />
        <defs>
          <path id={id} d="M 60,60 m -42,0 a 42,42 0 1,1 84,0 a 42,42 0 1,1 -84,0" />
        </defs>
        <text fontSize="9.2" fontFamily={MONO} fill={fg} letterSpacing="2.6">
          <textPath href={`#${id}`}>CLAUSEGUARD · AUTONOMOUS ESCROW · GENLAYER ·</textPath>
        </text>
      </g>
      {/* static monogram */}
      <text x="60" y="63" textAnchor="middle" fontFamily={SERIF} fontWeight="900" fontSize="30" fill={fg}>C¶</text>
      <text x="60" y="78" textAnchor="middle" fontFamily={MONO} fontSize="6.5" letterSpacing="1.5" fill={fg}>EST. 2026</text>
    </svg>
  );
}

// Small inline seal for header / footer
function SealMark({ size = 34, color = C.accent2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{ display: "block", flexShrink: 0 }}>
      {Array.from({ length: 20 }).map((_, i) => {
        const a = (i / 20) * Math.PI * 2;
        return <circle key={i} cx={(24 + Math.cos(a) * 21).toFixed(2)} cy={(24 + Math.sin(a) * 21).toFixed(2)} r="1.6" fill={color} />;
      })}
      <circle cx="24" cy="24" r="17" stroke={color} strokeWidth="2" />
      <text x="24" y="30" textAnchor="middle" fontFamily={SERIF} fontWeight="900" fontSize="17" fill={color}>C¶</text>
    </svg>
  );
}

// Rubber stamp — rough-edged angled mark. The signature motif.
function Stamp({ children, color = C.accent2, size = 12, rotate = -3, slam = false, style }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: MONO,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        border: `${Math.max(2, size / 5)}px solid ${color}`,
        padding: `${size * 0.35}px ${size * 0.8}px`,
        transform: `rotate(${rotate}deg)`,
        filter: "url(#cg-rough)",
        opacity: 0.92,
        mixBlendMode: "multiply",
        whiteSpace: "nowrap",
        animation: slam ? "cg-stamp 600ms cubic-bezier(.2,.85,.3,1.2) both" : undefined,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// Perforated tear-line divider between sections
function TearLine({ flip = false }) {
  return (
    <div aria-hidden style={{ height: 14, overflow: "hidden", transform: flip ? "scaleY(-1)" : "none" }}>
      <div style={{
        height: 28, marginTop: flip ? -14 : 0,
        backgroundImage: `radial-gradient(circle at 10px 0px, transparent 6px, ${C.bg} 6.5px)`,
        backgroundSize: "20px 28px", backgroundRepeat: "repeat-x",
        filter: "drop-shadow(0 2px 1px rgba(28,26,21,0.12))",
      }} />
    </div>
  );
}

// Double rule — the notarial section divider
const DoubleRule = ({ style }) => (
  <div aria-hidden style={{ borderTop: `3px solid ${C.text}`, borderBottom: `1px solid ${C.text}`, height: 7, ...style }} />
);

// ── Icon set ──────────────────────────────────────────────────
function Icon({ name, size = 18, color = "currentColor" }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.8, strokeLinecap: "square", strokeLinejoin: "miter" };
  switch (name) {
    case "plus":    return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case "shield":  return <svg {...p}><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6l8-3z"/></svg>;
    case "check":   return <svg {...p}><path d="M5 12l4 4 10-10"/></svg>;
    case "x":       return <svg {...p}><path d="M6 6l12 12M18 6l-12 12"/></svg>;
    case "wallet":  return <svg {...p}><rect x="3" y="6" width="18" height="14"/><path d="M3 10h18M16 15h2"/></svg>;
    case "doc":     return <svg {...p}><path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V9l-6-6z"/><path d="M14 3v6h6M9 14h6M9 18h6"/></svg>;
    case "upload":  return <svg {...p}><path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 18v3h16v-3"/></svg>;
    case "spark":   return <svg {...p}><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>;
    case "arrowR":  return <svg {...p}><path d="M5 12h14M13 5l7 7-7 7"/></svg>;
    case "arrowDown": return <svg {...p}><path d="M12 5v14M5 13l7 7 7-7"/></svg>;
    case "globe":   return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>;
    case "refresh": return <svg {...p}><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"/></svg>;
    case "link":    return <svg {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>;
    case "clock":   return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case "pen":     return <svg {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>;
    case "lock":    return <svg {...p}><rect x="4" y="11" width="16" height="10"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>;
    case "scale":   return <svg {...p}><path d="M12 3v18M5 21h14M7 7l-4 7a4 4 0 008 0L7 7zM17 7l-4 7a4 4 0 008 0l-4-7zM3 7h18"/></svg>;
    case "search":  return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>;
    default: return null;
  }
}

// ── Display heading — Zodiak editorial serif ──────────────────
function Display({ children, size = 64, c = C, style, as: Tag = "h1", italic = false, className }) {
  return (
    <Tag
      className={className}
      style={{
        fontFamily: SERIF,
        fontWeight: 900, fontSize: size, lineHeight: 0.98, letterSpacing: "-0.015em",
        fontStyle: italic ? "italic" : "normal",
        margin: 0, color: c.text, ...style,
      }}
    >
      {children}
    </Tag>
  );
}

// ── Primitives ────────────────────────────────────────────────
function Btn({ kind = "primary", size = "md", children, icon, iconRight, c = C, style, ...rest }) {
  const sizes = { sm: { p: "8px 14px", f: 12 }, md: { p: "12px 22px", f: 13.5 }, lg: { p: "16px 30px", f: 15 } };
  const s = sizes[size] || sizes.md;
  const base = {
    fontFamily: SANS, fontWeight: 800, fontSize: s.f, padding: s.p,
    borderRadius: 2, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8,
    letterSpacing: "0.06em", lineHeight: 1, whiteSpace: "nowrap", textTransform: "uppercase", ...style,
  };
  let palette, flat = false;
  if (kind === "primary")       palette = { background: c.accent2, color: c.bg, border: `2px solid ${c.text}`, boxShadow: c.shadowHardSm };
  else if (kind === "ghost")    palette = { background: "transparent", color: c.text, border: `2px solid ${c.text}`, boxShadow: c.shadowHardSm };
  else if (kind === "subtle")   { palette = { background: "transparent", color: c.textDim, border: `1.5px solid ${c.border}` }; flat = true; }
  else if (kind === "danger")   palette = { background: "transparent", color: c.danger, border: `2px solid ${c.danger}`, boxShadow: `3px 3px 0 ${c.danger}` };
  else if (kind === "success")  palette = { background: c.success, color: c.bg, border: `2px solid ${c.text}`, boxShadow: c.shadowHardSm };
  else if (kind === "terminal") palette = { background: "transparent", color: C.phosphor, border: `2px solid ${C.phosphor}`, boxShadow: `3px 3px 0 rgba(108,240,154,0.45)` };
  return (
    <button className={flat ? "cg-btn cg-btn-flat" : "cg-btn"} style={{ ...base, ...palette }} {...rest}>
      {icon && <Icon name={icon} size={s.f + 2} />}
      {children}
      {iconRight && <Icon name={iconRight} size={s.f + 2} />}
    </button>
  );
}

function Card({ children, c = C, style, hover = false, onClick, ...rest }) {
  return (
    <div
      className={hover ? "cg-card-hover" : ""}
      style={{ background: c.bgElev, border: `2px solid ${c.text}`, borderRadius: 2, padding: 24, boxShadow: c.shadowHard, ...style }}
      onClick={onClick}
      {...rest}
    >
      {children}
    </div>
  );
}

// Status pill = small angled stamp
function Pill({ children, c = C, tone = "default", style }) {
  const inks = {
    default:   c.textMute,
    open:      c.accent,
    funded:    c.success,
    verifying: c.warn,
    released:  c.success,
    refunded:  c.danger,
    disputed:  c.warn,
  };
  const ink = inks[tone] || inks.default;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 8px", border: `2px solid ${ink}`, borderRadius: 2,
      color: ink, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
      fontFamily: MONO, transform: "rotate(-2deg)", filter: "url(#cg-rough)", mixBlendMode: "multiply",
      whiteSpace: "nowrap", ...style,
    }}>
      {tone === "verifying" && <span style={{ width: 6, height: 6, background: ink, animation: "cg-blink 1.4s step-end infinite" }} />}
      {children}
    </span>
  );
}

const SectionLabel = ({ c = C, children, style }) => (
  <div style={{ fontSize: 11, color: c.textMute, letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, fontFamily: MONO, ...style }}>{children}</div>
);

// Clause heading — "§ N" margin numeral + title, used atop every section
function ClauseHeading({ n, title, sub, c = C }) {
  return (
    <div style={{ display: "flex", gap: 22, alignItems: "flex-start" }}>
      <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 30, color: c.accent2, lineHeight: 1, marginTop: 6, flexShrink: 0 }}>§{n}</div>
      <div style={{ flex: 1 }}>
        <Display c={c} size={48} as="h2" style={{ maxWidth: 640 }}>{title}</Display>
        {sub && <p style={{ marginTop: 14, fontSize: 15.5, color: c.textDim, lineHeight: 1.65, maxWidth: 520 }}>{sub}</p>}
      </div>
    </div>
  );
}

const Field = ({ c = C, label, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
    <span style={{ fontSize: 10.5, color: c.textMute, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700, fontFamily: MONO }}>{label}</span>
    {children}
  </label>
);

// Deed-style input chrome: underline only, like a fill-in-the-blank contract
const deedInput = {
  background: "transparent",
  border: "none",
  borderBottom: `2px solid ${C.text}`,
  borderRadius: 0,
  padding: "9px 2px",
  color: C.text,
  fontSize: 15,
  fontFamily: SERIF,
  width: "100%",
  outline: "none",
  transition: "border-color 160ms, box-shadow 160ms",
};
const deedFocus = (e) => { e.target.style.borderBottomColor = C.accent; e.target.style.boxShadow = `0 2px 0 ${C.accent}`; };
const deedBlur  = (e) => { e.target.style.borderBottomColor = C.text;  e.target.style.boxShadow = "none"; };

// ── Pipeline — the docket timeline ────────────────────────────
function Pipeline({ c = C, status }) {
  const meta = STATUS_META[status] || STATUS_META.open;
  const currentIndex = meta.pipeStep;
  const isError = ["rejected", "disputed", "cancelled"].includes(status);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, width: "100%" }}>
      {PIPELINE_STAGES.map((label, i) => {
        const done   = i < currentIndex;
        const active = i === currentIndex && !isError;
        const errAt  = isError && i === currentIndex;
        const ink = errAt ? c.danger : done ? c.success : active ? c.accent2 : c.textMute;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: i < PIPELINE_STAGES.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, minWidth: 66 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 2,
                border: `2px solid ${done || active || errAt ? ink : c.border}`,
                background: done ? ink : "transparent",
                color: done ? c.bg : ink,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, fontFamily: MONO,
                transform: `rotate(${active || errAt ? -4 : 0}deg)`,
                animation: active ? "cg-blink 1.8s ease-in-out infinite" : undefined,
              }}>
                {done && !isError ? <Icon name="check" size={14} color={c.bg} /> : errAt ? <Icon name="x" size={13} color={ink} /> : (i + 1)}
              </div>
              <span style={{ fontSize: 9.5, color: ink, fontWeight: active ? 700 : 500, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap", fontFamily: MONO }}>{label}</span>
            </div>
            {i < PIPELINE_STAGES.length - 1 && (
              <div style={{ flex: 1, height: 0, marginBottom: 22, marginInline: 4, borderTop: `2px ${done ? "solid" : "dashed"} ${done ? c.success : c.border}` }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Terminal panel — the machine world ────────────────────────
function TerminalPanel({ title = "TRIBUNAL FEED", children, style }) {
  return (
    <div className="cg-terminal" style={{ background: C.terminal, border: `2px solid ${C.text}`, borderRadius: 2, boxShadow: C.shadowHard, animation: "cg-flicker 9s linear infinite", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: `1px solid ${C.termLine}`, position: "relative", zIndex: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: C.phosphor, animation: "cg-blink 2s step-end infinite" }} />
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.2em", color: C.phosphor }}>{title}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: MONO, fontSize: 10, color: C.phosphorDim }}>GENLAYER//STUDIONET</span>
      </div>
      <div style={{ padding: "16px 18px", position: "relative", zIndex: 4 }}>{children}</div>
    </div>
  );
}

// ── Dialog shell — a paper sheet served to the user ───────────
function Dialog({ c = C, onClose, children, wide = false, dismissable = true }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && dismissable) onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose, dismissable]);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(28,26,21,0.55)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "4vh 20px", animation: "cg-fadein 200ms ease both" }} onClick={dismissable ? onClose : undefined}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "100%", maxWidth: wide ? 880 : 620, maxHeight: "92vh", overflowY: "auto", background: c.bgElev, border: `2px solid ${c.text}`, borderRadius: 2, boxShadow: `10px 10px 0 rgba(28,26,21,0.35)`, animation: "cg-fadeup 280ms ease both" }}>
        {dismissable && (
          <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, zIndex: 5, width: 32, height: 32, borderRadius: 2, background: c.bgElev, color: c.text, border: `2px solid ${c.text}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: c.shadowHardSm }} className="cg-btn">
            <Icon name="x" size={14} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

// ── Toast — receipt chits ─────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, kind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, msg, kind }].slice(-3));
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);
  return { toasts, add };
}

function ToastStack({ toasts, c = C }) {
  return (
    <div style={{ position: "fixed", top: 86, right: 24, zIndex: 400, display: "flex", flexDirection: "column", gap: 10, width: 320 }}>
      {toasts.map((t) => {
        const ink = t.kind === "error" ? c.danger : t.kind === "success" ? c.success : c.accent;
        return (
          <div key={t.id} style={{
            position: "relative", padding: "12px 16px 12px 22px",
            background: c.bgElev, border: `2px solid ${c.text}`, borderLeft: "none", borderRadius: 2,
            boxShadow: c.shadowHardSm, animation: "cg-fadeup 240ms ease both",
            display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            {/* perforated left edge */}
            <div aria-hidden style={{ position: "absolute", left: 0, top: -2, bottom: -2, width: 10, backgroundImage: `radial-gradient(circle at 0 7px, ${"rgba(28,26,21,0.55)"} 2.5px, transparent 3px)`, backgroundSize: "10px 14px", backgroundRepeat: "repeat-y", borderLeft: `2px dashed ${c.text}` }} />
            <span style={{ marginTop: 1, flexShrink: 0, color: ink }}>
              <Icon name={t.kind === "error" ? "x" : t.kind === "success" ? "check" : "spark"} size={14} color={ink} />
            </span>
            <div style={{ flex: 1, fontSize: 12, color: c.textDim, lineHeight: 1.5, fontFamily: MONO }}>{t.msg}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── TX overlay — terminal takeover while a tx is in flight ────
function TxOverlay({ msg, c = C }) {
  return (
    <div className="cg-terminal" style={{ position: "fixed", inset: 0, background: "rgba(13,15,12,0.96)", zIndex: 500, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
      <div style={{ fontFamily: MONO, fontSize: 13, color: C.phosphorDim, letterSpacing: "0.2em" }}>GENLAYER CONSENSUS LAYER</div>
      <div style={{ fontFamily: MONO, fontSize: 20, color: C.phosphor, display: "flex", alignItems: "center", gap: 6 }}>
        <span>&gt; {msg}</span><span className="cg-caret">▌</span>
      </div>
      <div style={{ width: 220, height: 8, border: `1px solid ${C.phosphorDim}`, position: "relative", overflow: "hidden" }}>
        <div className="cg-skeleton" style={{ position: "absolute", inset: 1, background: `linear-gradient(90deg, transparent, ${C.phosphor}, transparent)`, backgroundSize: "240px 100%" }} />
      </div>
      <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.phosphorDim }}>validators deliberating — do not close this sheet</div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────
function SkeletonCard({ c = C }) {
  return (
    <Card c={c} style={{ pointerEvents: "none", boxShadow: c.shadow, borderColor: c.border }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div className="cg-skeleton" style={{ height: 14, width: 90 }} />
        <div style={{ flex: 1 }} />
        <div className="cg-skeleton" style={{ height: 20, width: 70 }} />
      </div>
      <div className="cg-skeleton" style={{ height: 20, width: "85%", marginBottom: 8 }} />
      <div className="cg-skeleton" style={{ height: 13, width: "100%", marginBottom: 6 }} />
      <div className="cg-skeleton" style={{ height: 13, width: "70%" }} />
      <div style={{ borderTop: `1px solid ${c.border}`, margin: "18px 0 14px" }} />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div className="cg-skeleton" style={{ height: 24, width: 100 }} />
        <div className="cg-skeleton" style={{ height: 14, width: 80 }} />
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════
// LEGAL — affidavit gate + full Terms dialog
// ══════════════════════════════════════════════════════════════
function AcceptanceGate({ c = C, onAccept, onReadFull }) {
  const [checked, setChecked] = useState(false);
  return (
    <Dialog c={c} onClose={() => {}} dismissable={false}>
      <div style={{ padding: "34px 38px 6px" }}>
        <SectionLabel c={c}>FORM CG-0 · AFFIDAVIT OF UNDERSTANDING</SectionLabel>
        <Display c={c} size={34} as="h2" style={{ marginTop: 12 }}>Before you begin.</Display>
        <DoubleRule style={{ margin: "18px 0 16px" }} />
        <p style={{ color: c.textDim, fontSize: 14, lineHeight: 1.65 }}>{LEGAL.intro}</p>
      </div>
      <div style={{ padding: "16px 38px", display: "flex", flexDirection: "column", gap: 14 }}>
        {LEGAL.sections.map((s, i) => (
          <div key={s.h} style={{ display: "flex", gap: 14, alignItems: "flex-start", borderTop: i ? `1px solid ${c.borderSoft}` : "none", paddingTop: i ? 14 : 0 }}>
            <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 18, color: c.accent2, flexShrink: 0, lineHeight: 1.2 }}>{["I.", "II.", "III."][i]}</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13.5, color: c.text, marginBottom: 3, letterSpacing: "0.02em" }}>{s.h}</div>
              <div style={{ fontSize: 12.5, color: c.textMute, lineHeight: 1.6 }}>{s.b.length > 200 ? s.b.slice(0, 196) + "…" : s.b}</div>
            </div>
          </div>
        ))}
        <button onClick={onReadFull} className="cg-link-underline" style={{ alignSelf: "flex-start", background: "none", border: "none", color: c.accent, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: MONO, letterSpacing: "0.04em" }}>
          READ THE FULL TERMS &amp; DISCLAIMER →
        </button>
      </div>
      <div style={{ padding: "20px 38px 32px", borderTop: `2px solid ${c.text}`, marginTop: 10 }}>
        <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer", marginBottom: 18 }}>
          <span style={{ position: "relative", flexShrink: 0, marginTop: 1 }}>
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ appearance: "none", WebkitAppearance: "none", width: 22, height: 22, border: `2px solid ${c.text}`, borderRadius: 2, background: c.bgElev, cursor: "pointer", display: "block" }} />
            {checked && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: c.accent2, fontFamily: SERIF, fontStyle: "italic", fontWeight: 700, fontSize: 16, pointerEvents: "none" }}>✗</span>}
          </span>
          <span style={{ fontSize: 13, color: c.textDim, lineHeight: 1.55 }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.16em", color: c.textMute, display: "block", marginBottom: 3 }}>INITIAL HERE ✗</span>
            I have read and agree to the Terms &amp; Disclaimer. I understand ClauseGuard provides no legal or financial advice, accepts no liability for loss of funds, and that disputes are resolved by binding arbitration.
          </span>
        </label>
        <Btn kind="primary" size="lg" c={c} iconRight="arrowR" disabled={!checked} onClick={onAccept} style={{ width: "100%", justifyContent: "center" }}>
          I understand &amp; agree
        </Btn>
      </div>
    </Dialog>
  );
}

function TermsDialog({ c = C, onClose }) {
  return (
    <Dialog c={c} onClose={onClose} wide>
      <div style={{ padding: "32px 38px 18px" }}>
        <SectionLabel c={c}>EXHIBIT T · TERMS OF USE</SectionLabel>
        <Display c={c} size={34} as="h2" style={{ marginTop: 12 }}>Terms &amp; Disclaimer</Display>
        <div style={{ marginTop: 10, fontSize: 12, color: c.textMute, fontFamily: MONO }}>LAST UPDATED {LEGAL.updated.toUpperCase()} · GOVERNING LAW: {LEGAL.jurisdiction}</div>
        <DoubleRule style={{ marginTop: 16 }} />
      </div>
      <div style={{ padding: "10px 38px 34px", display: "flex", flexDirection: "column", gap: 22 }}>
        <p style={{ fontSize: 14, color: c.textDim, lineHeight: 1.7 }}>{LEGAL.intro}</p>
        {LEGAL.sections.map((s, i) => (
          <div key={s.h}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
              <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 22, color: c.accent2 }}>{["I.", "II.", "III."][i]}</span>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: c.text, fontFamily: SERIF }}>{s.h}</h3>
            </div>
            <p style={{ fontSize: 13.5, color: c.textDim, lineHeight: 1.75, paddingLeft: 34 }}>{s.b}</p>
          </div>
        ))}
        <div style={{ fontSize: 12, color: c.textMute, lineHeight: 1.65, borderTop: `1px solid ${c.border}`, paddingTop: 18, fontFamily: MONO }}>
          ClauseGuard runs on the GenLayer studionet network and is provided for evaluation. By connecting a wallet or interacting with any deal you reaffirm your acceptance of these terms.
        </div>
        <Btn kind="primary" c={c} onClick={onClose} style={{ alignSelf: "flex-end" }}>Close</Btn>
      </div>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════
// LAYOUT — Header (letterhead)
// ══════════════════════════════════════════════════════════════
function Header({ c = C, walletAddress, walletLoading, onConnect, onDisconnect, onCreate, onRefresh }) {
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 100, background: c.bg }}>
      {/* micro filing strip */}
      <div className="cg-microbar" style={{ borderBottom: `1px solid ${c.border}`, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.18em", color: c.textMute, display: "flex", justifyContent: "space-between", padding: "5px 28px", textTransform: "uppercase" }}>
        <span>FORM CG-1 · ESCROW REGISTRY</span>
        <span>NETWORK: GENLAYER STUDIONET · STATUS: <span style={{ color: c.success }}>LIVE ●</span></span>
      </div>
      <div style={{ maxWidth: 1320, margin: "0 auto", padding: "12px 28px", display: "flex", alignItems: "center", gap: 18 }}>
        <a href="#top" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <SealMark size={36} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 21, letterSpacing: "-0.01em", color: c.text }}>ClauseGuard</span>
            <span style={{ fontSize: 8.5, color: c.textMute, letterSpacing: "0.26em", textTransform: "uppercase", marginTop: 3, fontFamily: MONO }}>The Machine Notary</span>
          </div>
        </a>

        <nav className="cg-nav" style={{ display: "flex", gap: 4, marginLeft: 26 }}>
          {[["#docket", "§1 Docket"], ["#procedure", "§2 Procedure"], ["#tribunal", "§3 Tribunal"]].map(([href, label]) => (
            <a key={href} href={href} className="cg-link-underline" style={{ padding: "8px 10px", fontSize: 13, fontWeight: 700, color: c.textDim, fontFamily: MONO, letterSpacing: "0.02em" }}>{label}</a>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <button className="cg-btn cg-btn-flat" onClick={onRefresh} style={{ background: "transparent", border: `1.5px solid ${c.border}`, borderRadius: 2, width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", color: c.textDim, cursor: "pointer" }} title="Refresh the docket">
          <Icon name="refresh" size={15} />
        </button>

        {walletAddress ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 2, background: c.bgElev, border: `2px solid ${c.text}` }}>
              <span style={{ width: 8, height: 8, background: c.success, flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, fontWeight: 700, color: c.text, fontFamily: MONO }}>{shortAddr(walletAddress)}</span>
            </div>
            <button className="cg-btn cg-btn-flat" onClick={onDisconnect} style={{ background: "transparent", border: `1.5px solid ${c.border}`, borderRadius: 2, padding: "8px 12px", color: c.danger, fontSize: 11, cursor: "pointer", fontFamily: MONO, letterSpacing: "0.08em" }}>DISCONNECT</button>
          </div>
        ) : (
          <Btn kind="ghost" size="sm" c={c} icon="wallet" onClick={onConnect} disabled={walletLoading}>
            {walletLoading ? "Connecting…" : "Connect wallet"}
          </Btn>
        )}

        <Btn kind="primary" size="sm" c={c} icon="plus" onClick={onCreate} disabled={!walletAddress}>New deal</Btn>
      </div>
      <DoubleRule />
    </header>
  );
}

// ── Case-file visual (hero, right column) ─────────────────────
function CaseFileVis({ c = C, deal }) {
  const title   = deal ? dealTitle(deal) : "Vintage Leica M6, Hong Kong → Berlin, working condition on arrival";
  const amount  = deal ? deal.price_description : "2,400 GEN";
  const status  = deal ? deal.status : "evidence_submitted";
  const meta    = STATUS_META[status] || STATUS_META.open;
  const id      = deal?.id ?? "000412";

  return (
    <div style={{ position: "relative", maxWidth: 470, marginLeft: "auto" }}>
      {/* folder behind */}
      <div aria-hidden style={{ position: "absolute", inset: "-10px -12px -14px 14px", background: c.surfaceHi, border: `2px solid ${c.text}`, borderRadius: 2, transform: "rotate(1.6deg)" }} />
      {/* the sheet */}
      <div style={{ position: "relative", background: c.bgElev, border: `2px solid ${c.text}`, borderRadius: 2, boxShadow: "8px 8px 0 rgba(28,26,21,0.22)" }}>
        {/* paperclip */}
        <svg aria-hidden width="26" height="58" viewBox="0 0 26 58" style={{ position: "absolute", top: -14, left: 26, zIndex: 6 }}>
          <path d="M7 14 v30 a6 6 0 0 0 12 0 V10 a9 9 0 0 0 -18 0 v36" fill="none" stroke="#857D6B" strokeWidth="3.4" strokeLinecap="round" />
        </svg>
        <div style={{ padding: "18px 22px 14px", borderBottom: `2px solid ${c.text}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em", color: c.textDim, marginLeft: 42 }}>{caseNo(id)}</span>
          <span style={{ flex: 1 }} />
          <Stamp color={meta.tone === "refunded" ? c.danger : meta.tone === "released" || meta.tone === "funded" ? c.success : meta.tone === "open" ? c.accent : c.warn} size={11} rotate={4}>{meta.label}</Stamp>
        </div>
        <div style={{ padding: "20px 22px 22px" }}>
          <SectionLabel c={c}>The operative clause</SectionLabel>
          <p style={{ margin: "12px 0 0", fontFamily: SERIF, fontStyle: "italic", fontSize: 18, color: c.text, lineHeight: 1.45 }}>
            “{title}”
          </p>
          <div style={{ borderTop: `1px solid ${c.border}`, margin: "18px 0 14px" }} />
          {/* machine strip — the tribunal reads it */}
          <div className="cg-terminal" style={{ background: C.terminal, border: `2px solid ${c.text}`, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ position: "relative", zIndex: 4, fontFamily: MONO, fontSize: 11.5, color: C.phosphor, lineHeight: 1.8 }}>
              <Typewriter text="> 5 validators retained" speed={26} /><br />
              <span style={{ color: C.phosphorDim }}>VAL-A1 AGREE · VAL-A2 AGREE · VAL-B1 AGREE · VAL-B2 AGREE · VAL-C1 …</span><br />
              <span>CONSENSUS [████░] 4/5</span>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <SectionLabel c={c}>In escrow</SectionLabel>
              <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 28, color: c.text, lineHeight: 1, marginTop: 7 }}>{amount}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <SectionLabel c={c}>Held by</SectionLabel>
              <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 700, fontSize: 19, color: c.accent, lineHeight: 1, marginTop: 8 }}>the chain itself</div>
            </div>
          </div>
        </div>
      </div>
      {/* slammed stamp overlapping the sheet */}
      <div style={{ position: "absolute", right: -18, bottom: -22, zIndex: 7 }}>
        <Stamp color={c.accent2} size={17} rotate={-8} slam>AI-Arbitrated</Stamp>
      </div>
    </div>
  );
}

// ── Hero — the title page of the deed ─────────────────────────
function Hero({ c = C, deals, onCreateClick, onConnectClick, walletAddress }) {
  const liveStats = [
    { label: "Cases filed",  val: deals.length },
    { label: "Open now",     val: deals.filter((d) => d.status === "open").length },
    { label: "Settled",      val: deals.filter((d) => d.status === "settled").length },
    { label: "Validator agreement", val: "99.4%" },
  ];
  const featuredDeal = deals.find((d) => ["evidence_submitted", "verified", "funded"].includes(d.status)) || deals[deals.length - 1] || null;

  return (
    <section id="top" style={{ position: "relative", overflow: "hidden", borderBottom: `2px solid ${c.text}` }}>
      {/* ruled-paper field + red margin line */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: `repeating-linear-gradient(transparent, transparent 47px, ${"rgba(28,26,21,0.07)"} 47px, ${"rgba(28,26,21,0.07)"} 48px)` }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 86, width: 2, background: "rgba(200,64,31,0.3)" }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 92, width: 1, background: "rgba(200,64,31,0.18)" }} />
        {/* enormous ghost section sign */}
        <div style={{ position: "absolute", right: -60, top: -90, fontFamily: SERIF, fontWeight: 900, fontSize: 540, color: "rgba(28,26,21,0.045)", lineHeight: 1, userSelect: "none" }}>§</div>
      </div>

      <div className="cg-hero-grid" style={{ position: "relative", maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.18fr 1fr", gap: 64, alignItems: "center", padding: "78px 28px 84px" }}>
        <div style={{ animation: "cg-fadeup 650ms ease both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28, fontFamily: MONO, fontSize: 11, letterSpacing: "0.22em", color: c.textDim, textTransform: "uppercase" }}>
            <span style={{ borderBottom: `2px solid ${c.accent2}`, paddingBottom: 3 }}>Deed of escrow</span>
            <span style={{ color: c.textMute }}>·</span>
            <span style={{ color: c.textMute }}>Recorded on GenLayer</span>
          </div>

          <Display c={c} size={92} className="cg-hero-display" style={{ maxWidth: 720 }}>
            Escrow,{" "}
            <em style={{ fontStyle: "italic", color: c.accent2, fontWeight: 700 }}>witnessed</em>
            {" "}by machines.
          </Display>

          <p style={{ maxWidth: 520, marginTop: 28, fontSize: 17.5, lineHeight: 1.65, color: c.textDim }}>
            <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 52, float: "left", lineHeight: 0.8, marginRight: 10, marginTop: 6, color: c.text }}>W</span>
            rite your deal in plain English. Lock the funds on-chain. A tribunal of AI validators reads the evidence, agrees on the truth, and releases or refunds the money on its own. No middleman ever holds a cent.
          </p>

          <div style={{ display: "flex", gap: 14, marginTop: 36, flexWrap: "wrap", alignItems: "center" }}>
            {walletAddress ? (
              <Btn kind="primary" size="lg" c={c} iconRight="arrowR" onClick={onCreateClick}>Start a deal</Btn>
            ) : (
              <Btn kind="primary" size="lg" c={c} icon="wallet" onClick={onConnectClick}>Connect wallet to start</Btn>
            )}
            <Btn kind="ghost" size="lg" c={c} iconRight="arrowDown" onClick={() => document.getElementById("procedure")?.scrollIntoView({ behavior: "smooth" })}>
              Read the procedure
            </Btn>
          </div>

          {/* ledger stats table */}
          <div className="cg-stats-row" style={{ display: "grid", gridTemplateColumns: "repeat(4, auto)", gap: "0 44px", marginTop: 54, borderTop: `2px solid ${c.text}`, paddingTop: 18, width: "fit-content" }}>
            {liveStats.map((s, i) => (
              <Reveal key={s.label} delay={120 + i * 90}>
                <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 30, color: c.text, lineHeight: 1 }}>
                  <CountUp value={s.val} />
                </div>
                <div style={{ fontSize: 10, color: c.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginTop: 8, fontWeight: 700, fontFamily: MONO }}>{s.label}</div>
              </Reveal>
            ))}
          </div>
        </div>

        <div style={{ animation: "cg-fadeup 650ms 160ms ease both", position: "relative" }}>
          {/* rotating seal floating above the file */}
          <div className="cg-hero-seal" style={{ position: "absolute", bottom: -54, left: -64, zIndex: 8, opacity: 0.96 }}>
            <NotarySeal size={116} spin />
          </div>
          <CaseFileVis c={c} deal={featuredDeal} />
        </div>
      </div>
    </section>
  );
}

// ── Ledger tape ticker ────────────────────────────────────────
function LedgerTape({ c = C }) {
  const items = [...TAPE_ITEMS, ...TAPE_ITEMS];
  return (
    <div style={{ overflow: "hidden", borderBottom: `2px solid ${c.text}`, background: c.text, padding: "11px 0" }}>
      <div style={{ display: "flex", width: "max-content", animation: "cg-tape 30s linear infinite" }}>
        {items.map((w, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 26, paddingInline: 26, fontSize: 12.5, fontWeight: 700, letterSpacing: "0.18em", color: c.bg, whiteSpace: "nowrap", fontFamily: MONO }}>
            {w}
            <span style={{ color: c.accent2, fontSize: 14 }}>✶</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Procedure (§2 — how it works) ─────────────────────────────
function Procedure({ c = C }) {
  const steps = [
    { n: "I.",   t: "Draft the clause", d: "In plain English. No legalese, no smart-contract syntax. The validators read exactly what you wrote, word for word — so say what you mean." },
    { n: "II.",  t: "Deposit the funds", d: "Escrowed on the GenLayer chain. Visible to both parties, untouchable by either, until the tribunal of machines hands down its ruling." },
    { n: "III.", t: "The tribunal rules", d: "Validators crawl the open web, reason over the evidence, and converge on a verdict in minutes via Optimistic Democracy. Funds move on consensus." },
  ];
  return (
    <section id="procedure" style={{ maxWidth: 1320, margin: "0 auto", padding: "96px 28px 72px" }}>
      <Reveal>
        <ClauseHeading n={2} c={c} title={<>Trust, without the middleman.</>} sub="Three steps from handshake to settlement. The hard part — deciding who is right — is handled by a transparent network of AI arbiters, not a company." />
      </Reveal>
      <div className="cg-proc-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, marginTop: 52, borderTop: `2px solid ${c.text}`, borderBottom: `2px solid ${c.text}` }}>
        {steps.map((step, i) => (
          <Reveal key={step.n} delay={i * 110} style={{ height: "100%" }}>
            <div style={{ padding: "30px 28px 36px", borderLeft: i ? `1px solid ${c.border}` : "none", height: "100%", position: "relative" }}>
              <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 88, lineHeight: 1, color: i === 2 ? c.accent2 : c.text }}>{step.n}</div>
              <h3 style={{ margin: "18px 0 0", fontSize: 24, color: c.text, fontWeight: 900, fontFamily: SERIF }}>{step.t}</h3>
              <p style={{ margin: "12px 0 0", fontSize: 14.5, color: c.textDim, lineHeight: 1.65 }}>{step.d}</p>
              {i === 2 && (
                <div style={{ marginTop: 16 }}>
                  <Stamp color={c.success} size={10.5} rotate={-3}>Verdict · Final on consensus</Stamp>
                </div>
              )}
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── Tribunal (§3 — trust model, terminal world) ───────────────
function Tribunal({ c = C }) {
  const points = [
    { t: "A diverse bench, not one judge", d: "Many independent AI validators each reach their own conclusion. No single model, company, or person decides your outcome." },
    { t: "Evidence from the open web", d: "Validators crawl the verification URLs and public sources you provide, then reason over what they actually find." },
    { t: "Optimistic Democracy", d: "Validators converge on a verdict. Disagreement triggers re-review and appeal. Settlement only happens on consensus." },
  ];
  const roll = [
    ["VAL-A1", "AGREE  ", true], ["VAL-A2", "AGREE  ", true], ["VAL-B1", "AGREE  ", true],
    ["VAL-B2", "AGREE  ", true], ["VAL-C1", "REVIEW…", false],
  ];
  return (
    <section id="tribunal" style={{ maxWidth: 1320, margin: "0 auto", padding: "24px 28px 96px" }}>
      <Reveal>
        <ClauseHeading n={3} c={c} title={<>Nobody holds the gavel. <em style={{ fontStyle: "italic", color: c.accent2 }}>Everybody checks the work.</em></>} />
      </Reveal>
      <Reveal delay={120}>
        <div className="cg-tribunal-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 0, marginTop: 48, border: `2px solid ${c.text}`, boxShadow: C.shadowHard }}>
          {/* machine side */}
          <div className="cg-terminal" style={{ background: C.terminal, padding: "26px 28px 30px", minHeight: 320 }}>
            <div style={{ position: "relative", zIndex: 4, fontFamily: MONO, fontSize: 13, lineHeight: 2.0 }}>
              <div style={{ color: C.phosphorDim, fontSize: 11, letterSpacing: "0.2em", marginBottom: 14 }}>┌─ TRIBUNAL ROLL-CALL ─────────────┐</div>
              <div style={{ color: C.phosphor }}>
                <Typewriter text="> docket called. 5 validators seated." speed={20} />
              </div>
              {roll.map(([id, st, ok], i) => (
                <div key={id} style={{ display: "flex", gap: 14, color: ok ? C.phosphor : C.amber }}>
                  <span style={{ color: C.phosphorDim }}>{String(i + 1).padStart(2, "0")}</span>
                  <span>{id}</span>
                  <span style={{ flex: 1, borderBottom: `1px dotted ${C.termLine}`, transform: "translateY(-7px)" }} />
                  <span>{st}{!ok && <span className="cg-caret">▌</span>}</span>
                </div>
              ))}
              <div style={{ marginTop: 14, color: C.phosphor }}>CONSENSUS [████░] 4 OF 5 — THRESHOLD MET</div>
              <div style={{ color: C.phosphorDim, fontSize: 11, letterSpacing: "0.2em", marginTop: 14 }}>└──────────────────────────────────┘</div>
            </div>
          </div>
          {/* paper side */}
          <div style={{ background: c.bgElev, padding: "26px 30px 30px", borderLeft: `2px solid ${c.text}` }}>
            {points.map((p, i) => (
              <div key={p.t} style={{ display: "flex", gap: 16, padding: "18px 0", borderTop: i ? `1px solid ${c.border}` : "none" }}>
                <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 21, color: c.accent2, flexShrink: 0, lineHeight: 1.2 }}>{["I.", "II.", "III."][i]}</div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 900, color: c.text, marginBottom: 5, fontFamily: SERIF }}>{p.t}</div>
                  <div style={{ fontSize: 14, color: c.textDim, lineHeight: 1.6 }}>{p.d}</div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8, paddingTop: 16, borderTop: `1px solid ${c.border}`, display: "flex", alignItems: "center", gap: 12 }}>
              <SealMark size={30} color={c.accent3} />
              <span style={{ fontSize: 11.5, color: c.textMute, fontFamily: MONO, letterSpacing: "0.1em" }}>SO ENTERED — BY ORDER OF THE NETWORK</span>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════
// DEAL FLOWS (functionality preserved)
// ══════════════════════════════════════════════════════════════
function VerifyingState({ c = C, stage, validators }) {
  return (
    <TerminalPanel title="VERIFICATION IN SESSION" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: MONO, fontSize: 12.5 }}>
        {VERIFY_STAGES.map((s, i) => {
          const done   = i < stage;
          const active = i === stage;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, color: done ? C.phosphorDim : active ? C.phosphor : "rgba(108,240,154,0.3)" }}>
              <span>{done ? "[✓]" : active ? "[~]" : "[ ]"}</span>
              <span>{s.toLowerCase()}</span>
              {active && <span className="cg-caret">▌</span>}
            </div>
          );
        })}
      </div>
      {validators.length > 0 && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.termLine}`, paddingTop: 12 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.2em", color: C.phosphorDim, marginBottom: 8 }}>VALIDATORS REPORTING</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {validators.map((v) => (
              <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 10px", border: `1px solid ${C.termLine}`, fontFamily: MONO, fontSize: 11, color: C.phosphor, animation: "cg-fadeup 300ms ease both" }}>
                <span style={{ width: 6, height: 6, background: C.phosphor, animation: "cg-blink 1.4s step-end infinite" }} />
                {v}
              </span>
            ))}
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}

function VerdictPanel({ c = C, verdictDetails }) {
  const isRelease = verdictDetails?.conditions_met === true;
  const pct = confidencePct(verdictDetails?.confidence);
  const bars = Math.round(pct / 10);
  const ink = isRelease ? C.phosphor : "#FF8A6B";
  return (
    <div style={{ marginTop: 14, animation: "cg-fadeup 450ms ease both" }}>
      <TerminalPanel title="VERDICT — ENTERED ON-CHAIN">
        <div style={{ fontFamily: MONO, fontSize: 12, color: C.phosphorDim, lineHeight: 1.9 }}>
          <div>&gt; deliberation complete.</div>
          <div style={{ color: ink }}>&gt; CONFIDENCE [{"█".repeat(bars)}{"░".repeat(10 - bars)}] {pct}%</div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", padding: "18px 0 10px" }}>
          <Stamp color={isRelease ? "#5BE38F" : "#FF6B4A"} size={19} rotate={-6} slam style={{ mixBlendMode: "normal", opacity: 1 }}>
            {isRelease ? "Release funds" : "Refund buyer"}
          </Stamp>
        </div>
        {verdictDetails?.reasoning && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: C.phosphorDim, lineHeight: 1.7, fontFamily: MONO, borderTop: `1px solid ${C.termLine}`, paddingTop: 12 }}>
            OPINION OF THE TRIBUNAL — {verdictDetails.reasoning}
          </p>
        )}
        {verdictDetails?.unmet_conditions?.length > 0 && (
          <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 11.5, lineHeight: 1.7 }}>
            <div style={{ color: C.amber, marginBottom: 4 }}>UNMET CONDITIONS:</div>
            {verdictDetails.unmet_conditions.map((u, i) => (
              <div key={i} style={{ color: C.phosphorDim }}>· {u}</div>
            ))}
          </div>
        )}
      </TerminalPanel>
    </div>
  );
}

// Appeal / dispute panel — shown when validators fail to reach consensus.
// While attempts remain, parties can add evidence and re-verify; once the
// on-chain attempt cap is hit, the deal falls back to binding arbitration.
function AppealPanel({ c = C, verdictDetails, attempts, attemptsLeft, appealsExhausted, onAddEvidence, onReVerify, onShowTerms }) {
  const pct = confidencePct(verdictDetails?.confidence);
  const termsLink = { background: "none", border: "none", padding: 0, color: c.accent, fontWeight: 700, cursor: "pointer", fontSize: "inherit", textDecoration: "underline" };

  if (appealsExhausted) {
    return (
      <div style={{ marginTop: 14, padding: "18px 20px", border: `2px solid ${c.danger}`, background: "rgba(200,64,31,0.06)", animation: "cg-fadeup 450ms ease both", position: "relative" }}>
        <div style={{ position: "absolute", top: -14, right: 12 }}>
          <Stamp color={c.danger} size={11} rotate={5}>Appeals exhausted</Stamp>
        </div>
        <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 19, color: c.text, marginBottom: 8 }}>No further hearings.</div>
        <p style={{ margin: 0, fontSize: 13, color: c.textDim, lineHeight: 1.6 }}>
          All {MAX_VERIFICATION_ATTEMPTS} verification attempts were used without validator consensus. The contract will not re-verify this deal again. Funds stay locked until the dispute is resolved off-chain.
        </p>
        {verdictDetails?.reasoning && (
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: c.textMute, lineHeight: 1.6, fontStyle: "italic", fontFamily: SERIF, borderLeft: `3px solid ${c.danger}`, paddingLeft: 12 }}>
            Last opinion: {verdictDetails.reasoning}
          </p>
        )}
        <div style={{ marginTop: 14, fontSize: 12.5, color: c.textDim, lineHeight: 1.6 }}>
          Per the{" "}
          <button onClick={onShowTerms} style={termsLink}>Terms &amp; Disclaimer</button>, unresolved disputes are settled by final and binding individual arbitration.
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, padding: "16px 18px", border: `2px dashed ${c.warn}`, background: "rgba(143,95,0,0.05)", animation: "cg-fadeup 450ms ease both" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <Stamp color={c.warn} size={11} rotate={-2}>Contested · no consensus</Stamp>
        <span style={{ fontSize: 11, color: c.textMute, fontFamily: MONO }}>ATTEMPT {attempts} OF {MAX_VERIFICATION_ATTEMPTS}</span>
      </div>
      <div style={{ fontSize: 12.5, color: c.textDim, lineHeight: 1.6, marginBottom: 10 }}>
        The tribunal could not agree on a verdict{typeof pct === "number" ? ` (low confidence · ${pct}%)` : ""}. Enter stronger exhibits, then re-request verification to break the tie.
      </div>
      {verdictDetails?.reasoning && (
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: c.textMute, lineHeight: 1.6, fontStyle: "italic", fontFamily: SERIF, borderLeft: `3px solid ${c.warn}`, paddingLeft: 12 }}>{verdictDetails.reasoning}</p>
      )}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {Array.from({ length: MAX_VERIFICATION_ATTEMPTS }).map((_, i) => (
          <span key={i} style={{ flex: 1, height: 6, background: i < attempts ? c.warn : "transparent", border: `1.5px solid ${i < attempts ? c.warn : c.border}` }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn kind="ghost" c={c} size="sm" icon="upload" style={{ flex: 1 }} onClick={onAddEvidence}>Add evidence</Btn>
        <Btn kind="primary" c={c} size="sm" icon="spark" style={{ flex: 1 }} onClick={onReVerify}>Re-request verification</Btn>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: c.textMute, fontFamily: MONO }}>
        {attemptsLeft} {attemptsLeft === 1 ? "ATTEMPT" : "ATTEMPTS"} REMAINING BEFORE APPEALS ARE EXHAUSTED.
      </div>
    </div>
  );
}

// Evidence-strength meter — reflects how credibly a validator can read a link
function StrengthMeter({ c = C, analysis }) {
  if (!analysis || analysis.state === "empty") {
    return <div style={{ fontSize: 11.5, color: c.textMute, fontStyle: "italic", fontFamily: SERIF }}>Paste a public link to your proof. Validators read the page text, so links beat screenshots.</div>;
  }
  if (analysis.state === "invalid") {
    return <div style={{ fontSize: 12, color: c.danger, display: "flex", alignItems: "center", gap: 6, fontFamily: MONO }}><Icon name="x" size={13} color={c.danger} />{analysis.reason}</div>;
  }
  const colorFor = { strong: c.success, medium: c.warn, weak: c.danger };
  const col = colorFor[analysis.strength];
  const segs = STRENGTH_META[analysis.strength]?.segments || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", border: `2px solid ${col}`, background: "rgba(28,26,21,0.02)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 22, height: 7, background: i < segs ? col : "transparent", border: `1.5px solid ${i < segs ? col : c.border}` }} />
          ))}
        </div>
        <Stamp color={col} size={9.5} rotate={-2}>{STRENGTH_META[analysis.strength]?.label}</Stamp>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: c.textMute, fontFamily: MONO }}>{analysis.category}</span>
      </div>
      <div style={{ fontSize: 11.5, color: c.textDim, lineHeight: 1.5 }}>{analysis.why}</div>
    </div>
  );
}

function EvidenceForm({ deal, walletAddress, provider, c = C, onSuccess, onCancel, toast }) {
  const [evType, setEvType]     = useState("delivery_proof");
  const [evUrl, setEvUrl]       = useState("");
  const [evDesc, setEvDesc]     = useState("");
  const [submitting, setSubmitting] = useState(false);

  const analysis = useMemo(() => analyzeProofUrl(evUrl), [evUrl]);
  const presets = PROOF_PRESETS[evType] || [];

  async function handleSubmit() {
    if (analysis.state !== "ok") { toast(analysis.reason || "Add a valid https:// proof link", "error"); return; }
    if (!evDesc.trim()) { toast("Add a short description", "error"); return; }
    try {
      setSubmitting(true);
      await GL.submitEvidence(walletAddress, provider, parseInt(deal.id), evType, evUrl.trim(), evDesc.trim());
      toast("Exhibit entered on-chain", "success");
      onSuccess();
    } catch (err) {
      toast(err.message || "Submit failed", "error");
    } finally { setSubmitting(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Field c={c} label="Exhibit type">
        <select value={evType} onChange={(e) => setEvType(e.target.value)} style={{ ...deedInput, fontFamily: SANS, fontSize: 14, appearance: "none", cursor: "pointer" }}>
          {EVIDENCE_TYPES.map((et) => <option key={et.value} value={et.value}>{et.label}</option>)}
        </select>
      </Field>

      {presets.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10.5, color: c.textMute, fontFamily: MONO, letterSpacing: "0.1em" }}>BEST SOURCES:</span>
          {presets.map((p) => (
            <span key={p} style={{ fontSize: 11, fontWeight: 700, color: c.accent, border: `1.5px solid ${c.accent}`, padding: "2px 8px", fontFamily: MONO }}>{p}</span>
          ))}
        </div>
      )}

      <Field c={c} label="Proof link (https://)">
        <input value={evUrl} onChange={(e) => setEvUrl(e.target.value)} placeholder="https://www.fedex.com/track?... or an explorer / order link" maxLength={500} style={{ ...deedInput, fontFamily: MONO, fontSize: 13 }} onFocus={deedFocus} onBlur={deedBlur} />
      </Field>

      <StrengthMeter c={c} analysis={analysis} />

      <Field c={c} label="Description">
        <textarea value={evDesc} onChange={(e) => setEvDesc(e.target.value)} placeholder="What does this link show, and how does it satisfy the terms?" rows={3} maxLength={500} className="cg-ruled" style={{ ...deedInput, resize: "vertical", fontSize: 14.5 }} onFocus={deedFocus} onBlur={deedBlur} />
      </Field>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn kind="subtle" c={c} onClick={onCancel} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
        <Btn kind="primary" c={c} onClick={handleSubmit} disabled={submitting || analysis.state !== "ok"} style={{ flex: 2, justifyContent: "center" }}>{submitting ? "Submitting…" : "Enter exhibit on-chain"}</Btn>
      </div>
    </div>
  );
}

function CreateDealDialog({ c = C, walletAddress, provider, onClose, onSuccess, toast }) {
  const [terms, setTerms]       = useState("");
  const [price, setPrice]       = useState("");
  const [deadline, setDeadline] = useState("");
  const [urls, setUrls]         = useState("");
  const [minSources, setMinSources] = useState(1);
  const [collateral, setCollateral] = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleCreate() {
    if (!terms.trim())    { toast("Deal terms are required", "error"); return; }
    if (!price.trim())    { toast("Price description is required", "error"); return; }
    if (!deadline.trim()) { toast("Deadline is required", "error"); return; }
    try {
      setLoading(true);
      const urlArray = urls.split(",").map((u) => u.trim()).filter(Boolean);
      await GL.createDeal(walletAddress, provider, { terms: terms.trim(), priceDescription: price.trim(), deadlineDescription: deadline.trim(), verificationUrls: urlArray, minSourcesRequired: minSources, collateralWei: genToWei(collateral) });
      toast("Deal recorded on-chain", "success");
      onSuccess();
    } catch (err) {
      toast(err.message || "Create failed", "error");
    } finally { setLoading(false); }
  }

  const EXAMPLE = "Release funds when buyer receives the item in working condition. Tracking number must be visible to validators within 48h of payment.";

  return (
    <Dialog c={c} onClose={onClose}>
      <div style={{ padding: "30px 34px 4px" }}>
        <SectionLabel c={c}>FORM CG-2 · DEED OF ESCROW</SectionLabel>
        <Display c={c} size={32} as="h2" style={{ marginTop: 12 }}>Draft a new deal.</Display>
        <p style={{ margin: "12px 0 0", color: c.textDim, fontSize: 14, maxWidth: 520, lineHeight: 1.6 }}>Write your terms in plain English. The validators will read them exactly as written.</p>
        <DoubleRule style={{ marginTop: 18 }} />
      </div>

      <div style={{ padding: "20px 34px", display: "flex", flexDirection: "column", gap: 20 }}>
        <Field c={c} label={<>The operative clause <span style={{ color: c.danger }}>*</span></>}>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={EXAMPLE} rows={5} maxLength={2000} className="cg-ruled" style={{ ...deedInput, resize: "vertical", fontSize: 15.5, fontStyle: terms ? "normal" : "italic" }} onFocus={deedFocus} onBlur={deedBlur} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: c.textMute, fontFamily: MONO }}>
            <span>{terms.length} CHARS · READ VERBATIM BY VALIDATORS</span>
            <button onClick={() => setTerms(EXAMPLE)} style={{ background: "none", border: "none", color: c.accent, cursor: "pointer", fontSize: 10.5, padding: 0, fontWeight: 700, fontFamily: MONO }}>USE EXAMPLE</button>
          </div>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <Field c={c} label={<>Consideration (price) <span style={{ color: c.danger }}>*</span></>}>
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 1.5 GEN" maxLength={200} style={{ ...deedInput, fontFamily: MONO, fontSize: 14 }} onFocus={deedFocus} onBlur={deedBlur} />
          </Field>
          <Field c={c} label={<>Deadline <span style={{ color: c.danger }}>*</span></>}>
            <input value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="e.g. May 15, 2026" maxLength={200} style={{ ...deedInput, fontFamily: MONO, fontSize: 14 }} onFocus={deedFocus} onBlur={deedBlur} />
          </Field>
        </div>

        <Field c={c} label="Verification URLs (comma-separated · validators crawl these)">
          <input value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://track.dhl.com/123, https://yoursite.com/order/456" maxLength={2048} style={{ ...deedInput, fontFamily: MONO, fontSize: 13 }} onFocus={deedFocus} onBlur={deedBlur} />
        </Field>

        <div>
          <div style={{ fontSize: 10.5, color: c.textMute, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700, marginBottom: 8, fontFamily: MONO }}>
            Min. verification sources <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(require {minSources} independent source{minSources > 1 ? "s" : ""})</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {[1, 2, 3].map((n) => (
              <button key={n} onClick={() => setMinSources(n)} style={{ flex: 1, padding: "10px 0", border: `2px solid ${minSources === n ? c.accent : c.border}`, borderRadius: 2, background: minSources === n ? c.accent : "transparent", color: minSources === n ? c.bg : c.textDim, fontWeight: 700, fontSize: 15, cursor: "pointer", transition: "all 140ms", fontFamily: MONO, boxShadow: minSources === n ? c.shadowHardSm : "none" }}>
                {n}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 7, fontSize: 11, color: c.textMute, fontFamily: MONO }}>
            {minSources === 1 ? "STANDARD: ANY EVIDENCE THAT SATISFIES THE TERMS" : `MULTI-SIG: AI MUST CONFIRM FROM ≥${minSources} DISTINCT SOURCES`}
          </div>
        </div>

        {/* Good-faith collateral */}
        <div style={{ padding: "16px 18px", border: `2px dashed ${c.text}`, background: c.surface, position: "relative" }}>
          <div style={{ position: "absolute", top: -12, left: 14, background: c.surface, padding: "0 8px", fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", color: c.textDim, fontWeight: 700 }}>RIDER A — SURETY BOND (OPTIONAL)</div>
          <p style={{ fontSize: 12.5, color: c.textDim, lineHeight: 1.6, marginBottom: 12, marginTop: 4 }}>
            Post a bond and the buyer must match it. Both bonds return when the deal settles. If you fail to deliver (conditions unmet or deadline passed), your bond goes to the buyer. Skin in the game for both sides.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input value={collateral} onChange={(e) => setCollateral(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" style={{ ...deedInput, width: 120, fontFamily: MONO, fontSize: 15 }} onFocus={deedFocus} onBlur={deedBlur} />
            <span style={{ fontSize: 13, color: c.textDim, fontWeight: 700, fontFamily: MONO }}>GEN BOND EACH</span>
          </div>
          {parseFloat(collateral) > 0 && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: c.accent2, fontFamily: MONO }}>
              YOU LOCK {collateral} GEN NOW. BUYER LOCKS {collateral} GEN ON TOP OF THE PRICE.
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "18px 34px 30px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `2px solid ${c.text}`, gap: 12 }}>
        <span style={{ fontSize: 10.5, color: c.textMute, fontFamily: MONO, letterSpacing: "0.06em" }}>{parseFloat(collateral) > 0 ? `BONDED DEAL · YOU LOCK ${collateral} GEN ON CREATION` : "VISIBLE TO BUYERS IMMEDIATELY ON FILING"}</span>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn kind="subtle" c={c} onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" c={c} onClick={handleCreate} disabled={loading || !terms || !price || !deadline}>
            {loading ? "Recording on-chain…" : "Execute & file deal"}
          </Btn>
        </div>
      </div>
    </Dialog>
  );
}

function DealDetailDialog({ c = C, deal, walletAddress, provider, onClose, onRefresh, toast, onShowTerms }) {
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

  const stampInk = meta.tone === "refunded" ? c.danger : (meta.tone === "released" || meta.tone === "funded") ? c.success : meta.tone === "open" ? c.accent : c.warn;
  const EXHIBIT_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

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

  return (
    <Dialog c={c} onClose={onClose} wide>
      {txMsg && <TxOverlay msg={txMsg} c={c} />}

      <div style={{ padding: "26px 34px 20px", borderBottom: `2px solid ${c.text}`, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.14em", color: c.textDim }}>{caseNo(deal.id)}</span>
          <Stamp color={stampInk} size={10.5} rotate={3}>{meta.label}</Stamp>
          <span style={{ flex: 1 }} />
          {deal.price_description && (
            <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 24, color: c.text, marginRight: 36 }}>{deal.price_description}</span>
          )}
        </div>
        <Display c={c} size={26} as="h2" style={{ marginBottom: 12, maxWidth: 680 }}>{dealTitle(deal)}</Display>
        <p style={{ fontSize: 15, color: c.textDim, lineHeight: 1.6, maxWidth: 720, fontStyle: "italic", fontFamily: SERIF, borderLeft: `3px solid ${c.accent2}`, paddingLeft: 14 }}>
          “{deal.terms}”
        </p>
        <div style={{ display: "flex", gap: 18, marginTop: 14, fontSize: 11.5, color: c.textMute, flexWrap: "wrap", fontFamily: MONO }}>
          {deal.deadline_description && <span><Icon name="clock" size={11} /> {deal.deadline_description}</span>}
          <span>SELLER: <span style={{ color: isSeller ? c.accent : c.text }}>{shortAddr(deal.seller)}{isSeller ? " (YOU)" : ""}</span></span>
          {deal.buyer && <span>BUYER: <span style={{ color: isBuyer ? c.accent : c.text }}>{shortAddr(deal.buyer)}{isBuyer ? " (YOU)" : ""}</span></span>}
        </div>
      </div>

      {isParty && (
        <div style={{ padding: "20px 34px", borderBottom: `1px solid ${c.border}` }}>
          <Pipeline c={c} status={status} />
        </div>
      )}

      <div className="cg-detail-grid" style={{ padding: "22px 34px 30px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30 }}>
        <div>
          {/* Auto on-chain payment proof — the chain is the receipt */}
          {isFunded && (
            <div style={{ marginBottom: 18, padding: "14px 16px", border: `2px solid ${c.success}`, background: "rgba(46,94,58,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Icon name="lock" size={18} color={c.success} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 900, color: c.text, fontFamily: SERIF }}>Payment locked on-chain</div>
                  <div style={{ fontSize: 11, color: c.textDim, fontFamily: MONO }}>NO RECEIPT NEEDED. THE LEDGER IS THE PROOF.</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 19, color: c.text, lineHeight: 1 }}>{fmtGen(deal.funded_amount)}</div>
                  <div style={{ fontSize: 9.5, color: c.textMute, letterSpacing: "0.12em", fontFamily: MONO }}>GEN ESCROW</div>
                </div>
              </div>
              {CONTRACT && (
                <a href={`${EXPLORER}${CONTRACT}`} target="_blank" rel="noreferrer" className="cg-link-underline" style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 10, fontSize: 11, color: c.accent, fontFamily: MONO, letterSpacing: "0.04em" }}>
                  <Icon name="link" size={11} />VIEW ON GENLAYER EXPLORER
                </a>
              )}
            </div>
          )}

          {/* Collateral / good-faith bond status */}
          {bond && (
            <div style={{ marginBottom: 18, padding: "14px 16px", border: `2px dashed ${c.text}`, background: c.surface, position: "relative" }}>
              <div style={{ position: "absolute", top: -11, left: 12, background: c.surface, padding: "0 8px", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.16em", color: c.textDim, fontWeight: 700 }}>RIDER A — SURETY BOND</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, marginTop: 4 }}>
                <Icon name="shield" size={15} color={c.accent2} />
                <span style={{ fontSize: 13, fontWeight: 800, color: c.text }}>{fmtGen(deal.collateral_amount)} GEN each</span>
              </div>
              {settlement ? (
                <div style={{ fontSize: 12, color: c.textDim, lineHeight: 1.55 }}>
                  {(settlement.seller_collateral === "split_buyer_protocol" || settlement.seller_collateral === "slashed_to_buyer")
                    ? `Seller did not deliver, so their bond was split: ${fmtGen(settlement.seller_collateral_to_buyer || deal.collateral_amount)} GEN to the buyer, the rest retained by the protocol.`
                    : "Both bonds were returned to their owners."}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: c.textDim, lineHeight: 1.55 }}>
                  {isFunded ? "Both parties are bonded. Bonds return in full on settlement. If the deal is rejected or expires, the seller's bond is split 50/50: half to the buyer, half retained by the protocol." : "Seller has posted their bond. The buyer matches it when funding."}
                </div>
              )}
            </div>
          )}

          <SectionLabel c={c}>Exhibits entered ({evidence.length})</SectionLabel>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {evidence.length === 0 && !showEvidenceForm && (
              <div style={{ padding: 20, border: `2px dashed ${c.border}`, color: c.textMute, fontSize: 13, textAlign: "center", fontStyle: "italic", fontFamily: SERIF }}>No exhibits entered into the record yet.</div>
            )}
            {evidence.map((ev, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", background: c.bg, border: `1.5px solid ${c.text}` }}>
                <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 15, color: c.accent2, flexShrink: 0, lineHeight: 1.3 }}>{EXHIBIT_LETTERS[i] || i + 1}.</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: c.textMute, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 3, fontFamily: MONO }}>EXHIBIT {EXHIBIT_LETTERS[i] || i + 1} · {(ev.type || ev.evidence_type || "other").replace(/_/g, " ")}</div>
                  {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: c.accent, wordBreak: "break-all", display: "block", fontFamily: MONO }}>{ev.url.slice(0, 55)}{ev.url.length > 55 ? "…" : ""}</a>}
                  {ev.description && <div style={{ marginTop: 3, fontSize: 12, color: c.textDim }}>{ev.description}</div>}
                </div>
              </div>
            ))}
          </div>

          {showEvidenceForm ? (
            <div style={{ marginTop: 12, padding: 18, background: c.surface, border: `2px solid ${c.text}` }}>
              <EvidenceForm deal={deal} walletAddress={walletAddress} provider={provider} c={c} toast={toast} onSuccess={async () => { setShowEvidenceForm(false); onRefresh(); }} onCancel={() => setShowEvidenceForm(false)} />
            </div>
          ) : (
            isParty && ["funded", "evidence_submitted", "open", "disputed"].includes(status) && walletAddress && (
              <Btn kind="ghost" size="sm" c={c} icon="upload" style={{ marginTop: 12 }} onClick={() => setShowEvidenceForm(true)}>Enter an exhibit</Btn>
            )
          )}

          {deal.verification_urls && (
            <div style={{ marginTop: 18 }}>
              <SectionLabel c={c}>Verification URLs</SectionLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {(Array.isArray(deal.verification_urls) ? deal.verification_urls : deal.verification_urls.split(",")).filter(Boolean).map((u, i) => (
                  <a key={i} href={u.trim()} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: c.accent, background: c.bgElev, padding: "4px 10px", border: `1.5px solid ${c.border}`, fontFamily: MONO }}>
                    <Icon name="link" size={11} />{u.trim().slice(0, 32)}{u.trim().length > 32 ? "…" : ""}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <SectionLabel c={c}>{status === "disputed" ? "Appeal" : verdictDetails ? "Verdict" : verifying ? "Tribunal in session" : "Actions"}</SectionLabel>

          {verifying && <VerifyingState c={c} stage={verifyStage} validators={validators} />}
          {!verifying && verdictDetails && status !== "disputed" && <VerdictPanel c={c} verdictDetails={verdictDetails} />}

          {!verifying && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: verdictDetails ? 16 : 12 }}>

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
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", border: `1.5px solid ${c.accent}`, fontSize: 11.5, color: c.textDim, fontFamily: MONO }}>
                  <Icon name="shield" size={13} color={c.accent} />
                  MULTI-SIG: EVIDENCE FROM <span style={{ color: c.accent, fontWeight: 700 }}>{deal.min_sources_required}</span> INDEPENDENT SOURCES
                </div>
              )}

              {status === "open" && !isSeller && walletAddress && (
                <div style={{ padding: "16px 18px", border: `2px solid ${c.text}`, background: c.bgElev, boxShadow: c.shadowHardSm }}>
                  <div style={{ fontSize: 10.5, color: c.textMute, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700, marginBottom: 8, fontFamily: MONO }}>Fund this deal</div>
                  <div style={{ fontSize: 12, color: c.textDim, marginBottom: 10 }}>{bond ? "Escrow price in GEN" : "Amount in GEN"}</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                    <input value={fundAmt} onChange={(e) => setFundAmt(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 1.5" style={{ ...deedInput, fontFamily: MONO, fontSize: 15, flex: 1 }} onFocus={deedFocus} onBlur={deedBlur} />
                    <Btn kind="primary" c={c} disabled={!fundAmt || parseFloat(fundAmt) <= 0} onClick={() => {
                      const priceWei = BigInt(genToWei(fundAmt));
                      const total = priceWei + BigInt(deal.collateral_amount || "0");
                      tx("Funding deal…", () => GL.fundDeal(walletAddress, provider, parseInt(deal.id), total.toString()));
                    }}>{bond ? "Fund + bond" : "Fund"}</Btn>
                  </div>
                  {bond && (
                    <div style={{ marginTop: 10, fontSize: 11.5, color: c.textDim, lineHeight: 1.6, padding: "8px 10px", border: `1.5px dashed ${c.border}` }}>
                      You&rsquo;ll lock <strong style={{ color: c.text }}>{fundAmt || "0"} GEN</strong> price + <strong style={{ color: c.text }}>{fmtGen(deal.collateral_amount)} GEN</strong> bond ={" "}
                      <strong style={{ color: c.accent2 }}>{(parseFloat(fundAmt || "0") + parseFloat(fmtGen(deal.collateral_amount))).toString()} GEN</strong> total.
                    </div>
                  )}
                </div>
              )}

              {deal.pending_terms && isSeller && (
                <div style={{ padding: "14px 16px", border: `2px dashed ${c.warn}`, background: "rgba(143,95,0,0.05)" }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: c.warn, marginBottom: 6, fontFamily: MONO, letterSpacing: "0.08em" }}>AMENDMENT PROPOSED</div>
                  <p style={{ fontSize: 13, color: c.textDim, lineHeight: 1.55, fontStyle: "italic", fontFamily: SERIF, borderLeft: `3px solid ${c.warn}`, paddingLeft: 10, marginBottom: 8 }}>“{deal.pending_terms}”</p>
                  <div style={{ fontSize: 10.5, color: c.textMute, marginBottom: 10, fontFamily: MONO }}>FROM: {shortAddr(deal.pending_terms_from)}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn kind="success" c={c} size="sm" icon="check" style={{ flex: 1, justifyContent: "center" }} onClick={() => tx("Accepting counter-terms…", () => GL.acceptCounterTerms(walletAddress, provider, parseInt(deal.id)))}>Accept</Btn>
                    <Btn kind="danger"  c={c} size="sm" icon="x"     style={{ flex: 1, justifyContent: "center" }} onClick={() => tx("Rejecting counter-terms…", () => GL.rejectCounterTerms(walletAddress, provider, parseInt(deal.id)))}>Reject</Btn>
                  </div>
                </div>
              )}

              {deal.pending_terms && !isSeller && walletAddress?.toLowerCase() === deal.pending_terms_from?.toLowerCase() && (
                <div style={{ padding: "12px 14px", border: `1.5px solid ${c.accent}`, fontSize: 12, color: c.textDim }}>
                  <span style={{ color: c.accent, fontWeight: 700 }}>Your counter-terms are pending seller review.</span>
                </div>
              )}

              {!deal.pending_terms && !isSeller && ["open", "funded"].includes(status) && walletAddress && !showCounterForm && (
                <Btn kind="subtle" c={c} size="sm" style={{ width: "100%", justifyContent: "center" }} onClick={() => setShowCounterForm(true)}>Propose counter-terms</Btn>
              )}

              {showCounterForm && (
                <div style={{ padding: 16, background: c.surface, border: `2px solid ${c.text}` }}>
                  <SectionLabel c={c}>Your counter-terms</SectionLabel>
                  <textarea value={counterTermsInput} onChange={(e) => setCounterTermsInput(e.target.value)} placeholder="Propose modified deal terms…" rows={4} maxLength={2000} className="cg-ruled" style={{ ...deedInput, resize: "vertical", marginTop: 10, fontSize: 14 }} onFocus={deedFocus} onBlur={deedBlur} />
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <Btn kind="subtle" c={c} size="sm" style={{ flex: 1, justifyContent: "center" }} onClick={() => { setShowCounterForm(false); setCounterTermsInput(""); }}>Cancel</Btn>
                    <Btn kind="primary" c={c} size="sm" style={{ flex: 2, justifyContent: "center" }} disabled={!counterTermsInput.trim()} onClick={() => { if (!counterTermsInput.trim()) return; tx("Proposing counter-terms…", () => GL.proposeCounterTerms(walletAddress, provider, parseInt(deal.id), counterTermsInput.trim())); setShowCounterForm(false); setCounterTermsInput(""); }}>Submit proposal</Btn>
                  </div>
                </div>
              )}

              {status === "evidence_submitted" && isSeller && (
                <Btn kind="primary" c={c} icon="spark" style={{ justifyContent: "center" }} onClick={runVerification}>Summon the tribunal</Btn>
              )}

              {["funded", "evidence_submitted"].includes(status) && isParty && (
                <Btn kind="subtle" c={c} size="sm" icon="clock" style={{ justifyContent: "center" }} onClick={() => tx("Checking deadline…", () => GL.checkDeadline(walletAddress, provider, parseInt(deal.id)))}>Check deadline</Btn>
              )}

              {status === "verified" && isParty && (
                <Btn kind="success" c={c} icon="check" style={{ justifyContent: "center" }} onClick={() => tx("Settling deal…", () => GL.settleDeal(walletAddress, provider, parseInt(deal.id)))}>Settle &amp; release funds</Btn>
              )}

              {status === "rejected" && isBuyer && (
                <Btn kind="danger" c={c} icon="x" style={{ justifyContent: "center" }} onClick={() => tx("Claiming refund…", () => GL.claimRefund(walletAddress, provider, parseInt(deal.id)))}>Claim refund</Btn>
              )}

              {status === "open" && isSeller && (
                <Btn kind="danger" c={c} style={{ justifyContent: "center" }} onClick={() => tx("Cancelling deal…", () => GL.cancelDeal(walletAddress, provider, parseInt(deal.id)))}>Vacate (cancel) deal</Btn>
              )}

              {!walletAddress && (
                <div style={{ fontSize: 13, color: c.textMute, fontStyle: "italic", fontFamily: SERIF }}>Connect a wallet to take actions on this deal.</div>
              )}
              {walletAddress && !isParty && status === "open" && (
                <div style={{ fontSize: 13, color: c.textMute }}>Fund this deal above to become the buyer of record.</div>
              )}
              {walletAddress && !isParty && status !== "open" && (
                <div style={{ fontSize: 13, color: c.textMute, fontStyle: "italic", fontFamily: SERIF }}>You are not a party to this deal.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ── Deal card — a manila case file ────────────────────────────
function DealCard({ deal, walletAddress, c = C, onOpen }) {
  const status  = deal.status || "open";
  const meta    = STATUS_META[status] || STATUS_META.open;
  const isAddr  = (a) => a && walletAddress && a.toLowerCase() === walletAddress.toLowerCase();
  const isSeller = isAddr(deal.seller);
  const isBuyer  = isAddr(deal.buyer);
  const title   = dealTitle(deal);
  const stampInk = meta.tone === "refunded" ? c.danger : (meta.tone === "released" || meta.tone === "funded") ? c.success : meta.tone === "open" ? c.accent : c.warn;

  return (
    <div className="cg-card-hover" onClick={() => onOpen(deal)} style={{ cursor: "pointer", position: "relative", height: "100%", paddingTop: 14 }}>
      {/* folder tab */}
      <div style={{ position: "absolute", top: 0, left: 18, padding: "4px 14px 6px", background: c.surfaceHi, border: `2px solid ${c.text}`, borderBottom: "none", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.16em", color: c.textDim, fontWeight: 700, zIndex: 2 }}>
        {caseNo(deal.id)}
      </div>
      <div style={{ background: c.bgElev, border: `2px solid ${c.text}`, borderRadius: 2, boxShadow: c.shadowHard, padding: "22px 22px 20px", height: "100%", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
        {/* ghost watermark seal on settled/verified */}
        {(status === "settled" || status === "verified") && (
          <div aria-hidden style={{ position: "absolute", right: -28, bottom: -30, opacity: 0.1 }}>
            <SealMark size={140} color={c.success} />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Stamp color={stampInk} size={9.5} rotate={-2}>{meta.label}</Stamp>
          {hasCollateral(deal) && (
            <span title="Good-faith bond" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, color: c.accent2, fontWeight: 700, letterSpacing: "0.1em", border: `1.5px solid ${c.accent2}`, padding: "2px 7px", fontFamily: MONO }}>
              <Icon name="shield" size={10} color={c.accent2} />BONDED
            </span>
          )}
          <span style={{ flex: 1 }} />
          {(isSeller || isBuyer) && (
            <span style={{ fontSize: 9, color: c.bg, fontWeight: 700, letterSpacing: "0.12em", background: c.accent, padding: "3px 8px", fontFamily: MONO }}>
              {isSeller ? "YOUR FILING" : "BUYER"}
            </span>
          )}
        </div>

        <h3 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: c.text, lineHeight: 1.25, fontFamily: SERIF }}>{title}</h3>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: c.textDim, lineHeight: 1.55, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontStyle: "italic", fontFamily: SERIF }}>“{deal.terms}”</p>

        <div style={{ flex: 1 }} />
        <div style={{ borderTop: `1px solid ${c.border}`, margin: "16px 0 12px" }} />

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            {deal.price_description && (
              <>
                <div style={{ fontSize: 9, color: c.textMute, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700, fontFamily: MONO }}>Consideration</div>
                <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: c.text, lineHeight: 1, marginTop: 5 }}>{deal.price_description}</div>
              </>
            )}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: c.textMute, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700, fontFamily: MONO }}>Seller of record</div>
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: c.textDim, marginTop: 5 }}>{shortAddr(deal.seller)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Segmented control — file-folder tabs ──────────────────────
function SegmentedControl({ c = C, options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", border: `2px solid ${c.text}`, borderRadius: 2, overflow: "hidden", background: c.bgElev }}>
      {options.map(([key, label], i) => (
        <button key={key} onClick={() => onChange(key)} style={{ padding: "8px 18px", background: value === key ? c.text : "transparent", color: value === key ? c.bg : c.textDim, border: "none", borderLeft: i ? `1.5px solid ${c.border}` : "none", cursor: "pointer", fontSize: 11.5, fontWeight: 700, transition: "all 160ms", fontFamily: MONO, letterSpacing: "0.1em", textTransform: "uppercase" }}>
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
  const [reduceMotion, setReduceMotion] = useState(false);
  const c = C;

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
      <GlobalStyles />
      <PaperFX />

      <Header c={c} walletAddress={walletAddress} walletLoading={walletLoading} onConnect={connectWallet} onDisconnect={disconnectWallet} onCreate={() => walletAddress ? setShowCreate(true) : connectWallet()} onRefresh={loadDeals} />

      <Hero c={c} deals={deals} onCreateClick={() => setShowCreate(true)} onConnectClick={connectWallet} walletAddress={walletAddress} />

      <LedgerTape c={c} />

      {/* §1 The Docket */}
      <main id="docket" style={{ maxWidth: 1320, margin: "0 auto", padding: "92px 28px 90px" }}>
        <Reveal>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 40, gap: 20, flexWrap: "wrap" }}>
            <ClauseHeading n={1} c={c} title={tab === "mine" ? "Your filings." : tab === "open" ? "Open for funding." : "The docket."} />
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <span style={{ position: "absolute", left: 10, color: c.textMute, pointerEvents: "none" }}><Icon name="search" size={14} /></span>
                <input type="search" placeholder="SEARCH THE RECORD…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ background: c.bgElev, border: `2px solid ${c.text}`, borderRadius: 2, padding: "9px 14px 9px 32px", color: c.text, fontSize: 11.5, outline: "none", width: 220, fontFamily: MONO, letterSpacing: "0.04em" }} />
              </div>
              <SegmentedControl c={c} options={[["all", "All"], ["open", "Open"], ["mine", "Mine"]]} value={tab} onChange={setTab} />
            </div>
          </div>
        </Reveal>

        {dealsLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 22 }}>
            {[0, 1, 2].map((i) => <SkeletonCard key={i} c={c} />)}
          </div>
        )}

        {dealsError && !dealsLoading && (
          <div style={{ border: `2px solid ${c.danger}`, background: "rgba(200,64,31,0.05)", padding: "24px 28px", marginBottom: 20, position: "relative" }}>
            <div style={{ position: "absolute", top: -14, left: 18 }}><Stamp color={c.danger} size={11} rotate={-3}>Filing error</Stamp></div>
            <div style={{ fontWeight: 900, color: c.danger, marginBottom: 6, fontFamily: SERIF, fontSize: 18, marginTop: 6 }}>The record could not be retrieved.</div>
            <div style={{ fontSize: 13, color: c.textDim, fontFamily: MONO }}>{dealsError}</div>
            <Btn kind="danger" c={c} style={{ marginTop: 16 }} onClick={loadDeals}>Retry</Btn>
          </div>
        )}

        {!dealsLoading && !dealsError && filteredDeals.length === 0 && (
          <div style={{ textAlign: "center", padding: "76px 24px", background: c.bgElev, border: `2px dashed ${c.text}` }}>
            <div style={{ display: "flex", justifyContent: "center" }}><NotarySeal size={92} spin={false} color={c.textMute} /></div>
            <h3 style={{ fontSize: 24, fontWeight: 900, color: c.text, margin: "22px 0 10px", fontFamily: SERIF }}>
              {tab === "mine" ? "No filings under your seal." : tab === "open" ? "No open cases." : "The docket is empty."}
            </h3>
            <p style={{ fontSize: 14, color: c.textMute, marginBottom: 26, fontStyle: "italic", fontFamily: SERIF }}>
              {tab === "mine" ? "Draft your first deal to get started." : "Be the first to write a clause."}
            </p>
            {walletAddress && <Btn kind="primary" c={c} icon="plus" onClick={() => setShowCreate(true)}>Draft a deal</Btn>}
          </div>
        )}

        {!dealsLoading && !dealsError && filteredDeals.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 22 }}>
            {filteredDeals.slice().reverse().map((deal, i) => (
              <Reveal key={deal.id} delay={Math.min(i, 6) * 70} style={{ height: "100%" }}>
                <DealCard deal={deal} walletAddress={walletAddress} c={c} onOpen={setOpenDeal} />
              </Reveal>
            ))}
          </div>
        )}
      </main>

      <Procedure c={c} />
      <Tribunal c={c} />

      {/* Footer — the signature block */}
      <footer style={{ borderTop: `2px solid ${c.text}`, background: c.bgElev }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "44px 28px 36px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 36 }}>
            <div style={{ maxWidth: 440 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <SealMark size={30} />
                <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 18, color: c.text }}>ClauseGuard</span>
              </div>
              {/* signature lines */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 26, color: c.accent, transform: "rotate(-2deg)", marginBottom: 2 }}>The Network</div>
                <div style={{ borderTop: `1.5px solid ${c.text}`, paddingTop: 5, fontSize: 9.5, color: c.textMute, fontFamily: MONO, letterSpacing: "0.18em" }}>EXECUTED &amp; WITNESSED — GENLAYER VALIDATORS</div>
              </div>
              <p style={{ fontSize: 12, color: c.textMute, lineHeight: 1.65 }}>
                Experimental, non-custodial P2P escrow on GenLayer studionet. ClauseGuard is not a law firm and provides no legal or financial advice. AI verdicts are not legally binding. Use at your own risk. See the{" "}
                <button onClick={() => setShowTerms(true)} className="cg-link-underline" style={{ background: "none", border: "none", color: c.accent, fontSize: 12, padding: 0, cursor: "pointer", fontWeight: 700 }}>Terms &amp; Disclaimer</button>.
              </p>
            </div>
            <div style={{ display: "flex", gap: 64, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <SectionLabel c={c} style={{ marginBottom: 4 }}>Index</SectionLabel>
                <a href="#docket" className="cg-link-underline" style={{ fontSize: 13, color: c.textDim, fontFamily: MONO }}>§1 The Docket</a>
                <a href="#procedure" className="cg-link-underline" style={{ fontSize: 13, color: c.textDim, fontFamily: MONO }}>§2 Procedure</a>
                <a href="#tribunal" className="cg-link-underline" style={{ fontSize: 13, color: c.textDim, fontFamily: MONO }}>§3 The Tribunal</a>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <SectionLabel c={c} style={{ marginBottom: 4 }}>Of record</SectionLabel>
                <a href={`${EXPLORER}${CONTRACT}`} target="_blank" rel="noreferrer" className="cg-link-underline" style={{ fontSize: 13, color: c.textDim, fontFamily: MONO }}>{CONTRACT ? shortAddr(CONTRACT) : "Contract"}</a>
                <a href="https://genlayer.com" target="_blank" rel="noreferrer" className="cg-link-underline" style={{ fontSize: 13, color: c.textDim, fontFamily: MONO }}>GenLayer</a>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <SectionLabel c={c} style={{ marginBottom: 4 }}>Legal</SectionLabel>
                <button onClick={() => setShowTerms(true)} className="cg-link-underline" style={{ fontSize: 13, color: c.textDim, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontFamily: MONO }}>Terms &amp; Disclaimer</button>
              </div>
            </div>
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${c.border}` }}>
          <div style={{ maxWidth: 1320, margin: "0 auto", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, fontSize: 10, color: c.textMute, fontFamily: MONO, letterSpacing: "0.12em" }}>
            <span>© {new Date().getFullYear()} CLAUSEGUARD · RECORDED ON GENLAYER</span>
            <span>STUDIONET · TESTNET · FORM CG-1 REV. 06/2026</span>
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
