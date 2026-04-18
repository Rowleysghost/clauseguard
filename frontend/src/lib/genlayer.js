"use client";

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

async function getClients(walletAddress, provider) {
  const { createClient } = await import("genlayer-js");
  const { studionet } = await import("genlayer-js/chains");
  const readClient = createClient({ chain: studionet });
  let writeClient = null;
  if (walletAddress && provider) {
    writeClient = createClient({ chain: studionet, account: walletAddress, provider });
    try { await writeClient.connect("studionet"); } catch {}
  }
  return { readClient, writeClient };
}

async function waitForTx(writeClient, hash) {
  const { TransactionStatus, ExecutionResult } = await import("genlayer-js/types");
  const receipt = await writeClient.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    fullTransaction: false,
    retries: 60,
    interval: 2000,
  });
  if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) throw new Error("Transaction failed on-chain");
  return receipt;
}

export async function fetchAllDeals() {
  const { readClient } = await getClients();
  const result = await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_all_deals", args: [], stateStatus: "accepted" });
  return JSON.parse(result || "[]");
}
export async function fetchOpenDeals() {
  const { readClient } = await getClients();
  const result = await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_open_deals", args: [], stateStatus: "accepted" });
  return JSON.parse(result || "[]");
}
export async function fetchDeal(dealId) {
  const { readClient } = await getClients();
  const result = await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_deal", args: [dealId], stateStatus: "accepted" });
  return JSON.parse(result);
}
export async function fetchUserDeals(userAddress) {
  const { readClient } = await getClients();
  const result = await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_user_deals", args: [userAddress], stateStatus: "accepted" });
  return JSON.parse(result || "[]");
}
export async function fetchDealCount() {
  const { readClient } = await getClients();
  return await readClient.readContract({ address: CONTRACT_ADDRESS, functionName: "get_deal_count", args: [], stateStatus: "accepted" });
}
export async function createDeal(walletAddress, provider, { terms, priceDescription, deadlineDescription, verificationUrls }) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "create_deal", args: [terms, priceDescription, deadlineDescription, verificationUrls.join(",")], value: 0n });
  return await waitForTx(writeClient, hash);
}
export async function fundDeal(walletAddress, provider, dealId, amountWei) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "fund_deal", args: [dealId], value: BigInt(amountWei) });
  return await waitForTx(writeClient, hash);
}
export async function submitEvidence(walletAddress, provider, dealId, evidenceType, evidenceUrl, description) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "submit_evidence", args: [dealId, evidenceType, evidenceUrl, description], value: 0n });
  return await waitForTx(writeClient, hash);
}
export async function requestVerification(walletAddress, provider, dealId) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "request_verification", args: [dealId], value: 0n });
  return await waitForTx(writeClient, hash);
}
export async function settleDeal(walletAddress, provider, dealId) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "settle_deal", args: [dealId], value: 0n });
  return await waitForTx(writeClient, hash);
}
export async function claimRefund(walletAddress, provider, dealId) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "claim_refund", args: [dealId], value: 0n });
  return await waitForTx(writeClient, hash);
}
export async function cancelDeal(walletAddress, provider, dealId) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "cancel_deal", args: [dealId], value: 0n });
  return await waitForTx(writeClient, hash);
}
