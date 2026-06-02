import { headers } from "next/headers";
import ContextProvider from "../context";

export const metadata = {
  title: "ClauseGuard",
  description: "AI-powered P2P trade escrow on GenLayer studionet",
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
