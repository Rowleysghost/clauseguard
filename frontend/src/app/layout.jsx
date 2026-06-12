import { headers } from "next/headers";
import ContextProvider from "../context";

const SITE_URL = "https://clauseguard-zeta.vercel.app";
const TITLE = "ClauseGuard: escrow, witnessed by machines";
const DESCRIPTION =
  "AI-powered P2P trade escrow on GenLayer. Write deal terms in plain English, lock funds on-chain, and let a tribunal of AI validators release or refund autonomously.";

export const viewport = {
  themeColor: "#F2EDE3",
};

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · ClauseGuard" },
  description: DESCRIPTION,
  applicationName: "ClauseGuard",
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "ClauseGuard",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default async function RootLayout({ children }) {
  const cookies = (await headers()).get("cookie");
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>
        <ContextProvider cookies={cookies}>{children}</ContextProvider>
      </body>
    </html>
  );
}
