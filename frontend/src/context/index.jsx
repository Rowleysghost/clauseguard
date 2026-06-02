"use client";

import { createAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, cookieToInitialState } from "wagmi";
import { wagmiAdapter, projectId, networks, studionet } from "../config";

const queryClient = new QueryClient();

const metadata = {
  name: "ClauseGuard",
  description: "AI-powered P2P trade escrow on GenLayer studionet",
  url: "https://clauseguard-zeta.vercel.app",
  icons: ["https://clauseguard-zeta.vercel.app/favicon.ico"],
};

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  defaultNetwork: studionet,
  metadata,
  features: { analytics: false },
});

export default function ContextProvider({ children, cookies }) {
  const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig, cookies);
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
