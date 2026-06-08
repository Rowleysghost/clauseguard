import { ImageResponse } from "next/og";

export const alt = "ClauseGuard — escrow that reads English";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%", width: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", background: "#050510", padding: "72px 80px",
          fontFamily: "sans-serif", position: "relative",
        }}
      >
        {/* gradient glow */}
        <div style={{ position: "absolute", top: -160, right: -120, width: 620, height: 620, borderRadius: 9999, background: "radial-gradient(circle at center, rgba(227,125,247,0.55), rgba(17,15,255,0))", display: "flex" }} />
        {/* top: wordmark */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ width: 46, height: 46, borderRadius: 13, background: "linear-gradient(135deg, #E37DF7, #110FFF)", display: "flex" }} />
          <div style={{ marginLeft: 18, color: "#ffffff", fontSize: 30, fontWeight: 700, letterSpacing: -1 }}>clauseguard</div>
        </div>
        {/* middle: headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", color: "#ffffff", fontSize: 88, fontWeight: 800, letterSpacing: -3, lineHeight: 1.02 }}>Escrow that</div>
          <div
            style={{
              display: "flex", fontSize: 88, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05,
              color: "transparent", backgroundImage: "linear-gradient(110deg, #E37DF7, #9B6AF6, #110FFF)",
              backgroundClip: "text", WebkitBackgroundClip: "text",
            }}
          >
            reads English.
          </div>
          <div style={{ display: "flex", marginTop: 26, color: "#b3b3d4", fontSize: 30, maxWidth: 860, lineHeight: 1.4 }}>
            Plain-English deals, funds locked on-chain, released by a network of AI validators.
          </div>
        </div>
        {/* bottom: footer */}
        <div style={{ display: "flex", alignItems: "center", color: "#6d6e96", fontSize: 24, fontWeight: 600 }}>
          <div style={{ display: "flex" }}>Built on GenLayer</div>
          <div style={{ display: "flex", margin: "0 14px" }}>·</div>
          <div style={{ display: "flex" }}>AI escrow on studionet</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
