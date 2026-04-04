export const STATUS_CONFIG = {
  open: { label: "Open", color: "#3b82f6", bg: "#eff6ff" },
  funded: { label: "Funded", color: "#8b5cf6", bg: "#f5f3ff" },
  evidence_submitted: { label: "Evidence Submitted", color: "#f59e0b", bg: "#fffbeb" },
  verified: { label: "Verified", color: "#10b981", bg: "#ecfdf5" },
  settled: { label: "Settled", color: "#059669", bg: "#d1fae5" },
  rejected: { label: "Rejected", color: "#ef4444", bg: "#fef2f2" },
  refunded: { label: "Refunded", color: "#6b7280", bg: "#f3f4f6" },
  disputed: { label: "Disputed", color: "#dc2626", bg: "#fef2f2" },
  cancelled: { label: "Cancelled", color: "#9ca3af", bg: "#f9fafb" },
};

export const EVIDENCE_TYPES = [
  { value: "delivery_proof", label: "Delivery Proof" },
  { value: "quality_report", label: "Quality Report" },
  { value: "tracking", label: "Shipping Tracker" },
  { value: "receipt", label: "Receipt / Invoice" },
  { value: "other", label: "Other" },
];

export const STATUS_FLOW = ["open", "funded", "evidence_submitted", "verified", "settled"];
