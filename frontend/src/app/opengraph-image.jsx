import { ImageResponse } from "next/og";

export const alt = "ClauseGuard: escrow, witnessed by machines";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#F2EDE3";
const INK = "#1C1A15";
const SEAL = "#C8401F";
const FADED = "#6B655A";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%", width: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", background: PAPER, padding: "60px 76px 48px",
          fontFamily: "Georgia, serif", position: "relative",
        }}
      >
        {/* red margin line */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 52, width: 3, background: "rgba(200,64,31,0.35)", display: "flex" }} />
        {/* top: filing strip + double rule */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: FADED, fontSize: 18, letterSpacing: 4, fontFamily: "monospace" }}>
            <div style={{ display: "flex" }}>FORM CG-1 · DEED OF ESCROW</div>
            <div style={{ display: "flex" }}>RECORDED ON GENLAYER</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
            <div style={{ height: 5, background: INK, display: "flex" }} />
            <div style={{ height: 2, background: INK, marginTop: 3, display: "flex" }} />
          </div>
        </div>
        {/* middle: headline + stamp */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
            <div style={{ display: "flex", color: INK, fontSize: 92, fontWeight: 700, letterSpacing: -3, lineHeight: 1.02 }}>Escrow,</div>
            <div style={{ display: "flex", fontSize: 92, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05, color: SEAL, fontStyle: "italic" }}>
              witnessed
            </div>
            <div style={{ display: "flex", color: INK, fontSize: 92, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05 }}>by machines.</div>
            <div style={{ display: "flex", marginTop: 24, color: FADED, fontSize: 26, maxWidth: 700, lineHeight: 1.45 }}>
              Plain-English deals, funds locked on-chain, released by a tribunal of AI validators.
            </div>
          </div>
          {/* seal + stamp */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "flex", width: 220, height: 220, borderRadius: 9999, border: `5px solid ${SEAL}`, alignItems: "center", justifyContent: "center" }}>
              <div style={{ display: "flex", width: 168, height: 168, borderRadius: 9999, border: `2px solid ${SEAL}`, alignItems: "center", justifyContent: "center", color: SEAL, fontSize: 88, fontWeight: 700 }}>
                C¶
              </div>
            </div>
            <div style={{ display: "flex", marginTop: 30, transform: "rotate(-8deg)", border: `6px solid ${SEAL}`, color: SEAL, padding: "10px 22px", fontSize: 28, fontWeight: 700, letterSpacing: 4, fontFamily: "monospace" }}>
              AI-ARBITRATED
            </div>
          </div>
        </div>
        {/* bottom: signature line */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `2px solid ${INK}`, paddingTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", color: INK, fontSize: 26, fontWeight: 700 }}>ClauseGuard — The Machine Notary</div>
          <div style={{ display: "flex", color: FADED, fontSize: 20, fontFamily: "monospace", letterSpacing: 2 }}>STUDIONET · TESTNET</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
