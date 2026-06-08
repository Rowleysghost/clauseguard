"use client";

// ── Proof-link analysis ───────────────────────────────────────
// GenLayer validators verify evidence by reading the TEXT of a URL
// (gl.nondet.web.render(url, mode="text")) — they cannot see images.
// So the most credible evidence is an authoritative, text-readable,
// hard-to-forge link. These presets rank sources by exactly that.

const SOURCES = [
  {
    strength: "strong", category: "On-chain payment",
    why: "Cryptographically verifiable on a public ledger, so it's effectively impossible to forge.",
    patterns: [/etherscan\.io/, /explorer[.-].*genlayer/, /genlayer.*explorer/, /blockscout/, /arbiscan\.io/, /polygonscan\.com/, /basescan\.org/, /solscan\.io/, /bscscan\.com/, /optimistic\.etherscan/],
  },
  {
    strength: "strong", category: "Carrier tracking",
    why: "Authoritative third-party logistics record, independent of both parties.",
    patterns: [/dhl\./, /fedex\.com/, /ups\.com/, /usps\.com/, /royalmail\.com/, /aftership\.com/, /17track\./, /tnt\.com/, /aramex\./, /canadapost/],
  },
  {
    strength: "strong", category: "Marketplace order",
    why: "Independent marketplace order record tied to a real account.",
    patterns: [/ebay\./, /amazon\./, /etsy\.com/, /myshopify\.com/, /aliexpress\./, /walmart\.com/, /mercari\.com/, /vinted\./],
  },
  {
    strength: "medium", category: "Payment receipt",
    why: "Hosted receipt from a recognised processor, credible but account-controlled.",
    patterns: [/stripe\.com/, /paypal\./, /squareup\.com/, /wise\.com/, /revolut\./, /receipt/, /invoice/],
  },
  {
    strength: "medium", category: "Digital deliverable",
    why: "Public, timestamped deliverable a validator can read directly.",
    patterns: [/github\.com/, /gitlab\.com/, /figma\.com/, /drive\.google\./, /docs\.google\./, /dropbox\.com/, /notion\.so/, /vercel\.app/, /netlify\.app/],
  },
];

// Suggested source categories per evidence type (for the guided picker)
export const PROOF_PRESETS = {
  delivery_proof: ["Carrier tracking", "Marketplace order"],
  tracking:       ["Carrier tracking"],
  receipt:        ["On-chain payment", "Payment receipt"],
  quality_report: ["Digital deliverable", "Marketplace order"],
  other:          ["On-chain payment", "Digital deliverable"],
};

export const STRENGTH_META = {
  strong: { label: "Strong proof", segments: 3 },
  medium: { label: "Medium proof", segments: 2 },
  weak:   { label: "Weak proof",   segments: 1 },
};

export function analyzeProofUrl(raw) {
  const url = (raw || "").trim();
  if (!url) return { state: "empty" };
  let host = "";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return { state: "invalid", reason: "Link must start with https://" };
    host = u.hostname.replace(/^www\./, "");
  } catch {
    return { state: "invalid", reason: "That doesn’t look like a valid URL" };
  }
  for (const s of SOURCES) {
    if (s.patterns.some((p) => p.test(url))) {
      return { state: "ok", strength: s.strength, category: s.category, why: s.why, domain: host };
    }
  }
  return {
    state: "ok", strength: "weak", category: "Unrecognised source", domain: host,
    why: "A validator can still read this page, but it isn’t a recognised authoritative source. A tracking page, marketplace order, or on-chain link is far stronger.",
  };
}
