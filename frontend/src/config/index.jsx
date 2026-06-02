import { cookieStorage, createStorage } from "@wagmi/core";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { studionet } from "genlayer-js/chains";

export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID;
if (!projectId) throw new Error("NEXT_PUBLIC_PROJECT_ID is not defined");

export { studionet };
export const networks = [studionet];

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  networks,
  projectId,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
