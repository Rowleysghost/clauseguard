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
    fullTransaction: true, // need the leader receipt to read the GenVM result
    retries: 60,
    interval: 2000,
  });
  // A GenLayer tx can reach ACCEPTED while its contract call reverted: the
  // GenVM result lives both at the top level (txExecutionResultName, which can
  // lag) and inside the leader receipt (populated at ACCEPTED — this is what
  // the explorer's "GENVM RESULT" column reads). Check both so a reverted call
  // never reports success, and surface the on-chain error message.
  const leader =
    receipt?.consensusData?.leader_receipt ?? receipt?.consensus_data?.leader_receipt;
  const leaderReceipt = Array.isArray(leader) ? leader[0] : leader;
  const leaderResult = leaderReceipt?.execution_result;
  const errored =
    receipt?.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR ||
    leaderResult === "FINISHED_WITH_ERROR" ||
    leaderResult === "ERROR";
  if (errored) {
    const stderr = leaderReceipt?.genvm_result?.stderr || "";
    const tail = stderr ? `: ${stderr.trim().split("\n").pop().trim()}` : "";
    throw new Error(`Transaction reverted on-chain${tail}`);
  }
  return receipt;
}

// Page size must stay <= MAX_PAGE_SIZE in contracts/clauseguard.py.
const PAGE_SIZE = 50;
const MAX_PAGES = 40; // safety stop — 2000 deals is plenty for the UI

async function fetchPaginated(functionName) {
  const { readClient } = await getClients();
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName,
      args: [page * PAGE_SIZE, PAGE_SIZE],
      stateStatus: "accepted",
    });
    const batch = JSON.parse(result || "[]");
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

export async function fetchAllDeals() {
  return await fetchPaginated("get_all_deals");
}
export async function fetchOpenDeals() {
  return await fetchPaginated("get_open_deals");
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
export async function createDeal(walletAddress, provider, { terms, priceDescription, deadlineDescription, verificationUrls, minSourcesRequired = 1, collateralWei = "0", milestonesJson = "" }) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  // Any value attached at create becomes the seller's good-faith bond, which
  // the buyer must match when funding.
  const hash = await writeClient.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "create_deal",
    args: [terms, priceDescription, deadlineDescription, verificationUrls.join(","), minSourcesRequired, milestonesJson],
    value: BigInt(collateralWei || "0"),
  });
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
export async function proposeCounterTerms(walletAddress, provider, dealId, newTerms) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "propose_counter_terms", args: [dealId, newTerms], value: 0n });
  return await waitForTx(writeClient, hash);
}
export async function acceptCounterTerms(walletAddress, provider, dealId) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "accept_counter_terms", args: [dealId], value: 0n });
  return await waitForTx(writeClient, hash);
}
export async function rejectCounterTerms(walletAddress, provider, dealId) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "reject_counter_terms", args: [dealId], value: 0n });
  return await waitForTx(writeClient, hash);
}
export async function submitMilestoneEvidence(walletAddress, provider, dealId, milestoneIndex, evidenceType, evidenceUrl, description) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "submit_milestone_evidence", args: [dealId, milestoneIndex, evidenceType, evidenceUrl, description], value: 0n });
  return await waitForTx(writeClient, hash);
}
export async function requestMilestoneVerification(walletAddress, provider, dealId, milestoneIndex) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "request_milestone_verification", args: [dealId, milestoneIndex], value: 0n });
  return await waitForTx(writeClient, hash);
}
export async function settleMilestone(walletAddress, provider, dealId, milestoneIndex) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "settle_milestone", args: [dealId, milestoneIndex], value: 0n });
  return await waitForTx(writeClient, hash);
}
export async function checkDeadline(walletAddress, provider, dealId) {
  const { writeClient } = await getClients(walletAddress, provider);
  if (!writeClient) throw new Error("Wallet not connected");
  const hash = await writeClient.writeContract({ address: CONTRACT_ADDRESS, functionName: "check_deadline", args: [dealId], value: 0n });
  return await waitForTx(writeClient, hash);
}
