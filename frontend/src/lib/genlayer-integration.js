// ═══════════════════════════════════════════════════════════════
// ClauseGuard — GenLayer JS SDK Integration
// ═══════════════════════════════════════════════════════════════
//
// This module connects the React frontend to the deployed
// ClauseGuard intelligent contract on GenLayer Bradbury Testnet.
//
// Setup:
//   npm install genlayer-js
//
// Usage:
//   import { clauseGuard } from './genlayer-integration';
//   const deals = await clauseGuard.getOpenDeals();
//   await clauseGuard.createDeal({ terms: "...", ... });
// ═══════════════════════════════════════════════════════════════

import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus, ExecutionResult } from "genlayer-js/types";

// ── Configuration ──
// Set these after deploying the contract via GenLayer Studio
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "YOUR_CONTRACT_ADDRESS_HERE";

// ── Clients ──
// Read client: no wallet needed, for querying contract state
const readClient = createClient({
  chain: testnetBradbury,
});

// Write client: requires wallet (MetaMask or similar)
let writeClient = null;

/**
 * Initialize the write client with a wallet provider.
 * Call this after the user connects their wallet.
 */
export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("No wallet provider found. Please install MetaMask or a compatible wallet.");
  }

  // Request account access
  const accounts = await window.ethereum.request({
    method: "eth_requestAccounts",
  });

  const userAddress = accounts[0];

  writeClient = createClient({
    chain: testnetBradbury,
    account: userAddress,
    provider: window.ethereum,
  });

  // Switch wallet to Bradbury testnet
  await writeClient.connect("testnetBradbury");

  return userAddress;
}

/**
 * Wait for a transaction to finalize and check execution result.
 */
async function waitForTx(hash) {
  const receipt = await writeClient.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    fullTransaction: false,
  });

  if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error(`Transaction failed: ${receipt.txExecutionResultName}`);
  }

  return receipt;
}

// ═══════════════════════════════════════════════════════════════
// Contract Interaction Methods
// ═══════════════════════════════════════════════════════════════

export const clauseGuard = {
  // ── READ METHODS (no wallet required) ──

  /**
   * Get all open deals (marketplace view).
   * @returns {Array} Array of deal objects
   */
  async getOpenDeals() {
    const result = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_open_deals",
      args: [],
      stateStatus: "accepted",
    });
    return JSON.parse(result);
  },

  /**
   * Get all deals (admin/dashboard view).
   * @returns {Array} Array of all deal objects
   */
  async getAllDeals() {
    const result = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_all_deals",
      args: [],
      stateStatus: "accepted",
    });
    return JSON.parse(result);
  },

  /**
   * Get a specific deal by ID.
   * @param {number} dealId
   * @returns {Object} Deal object
   */
  async getDeal(dealId) {
    const result = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_deal",
      args: [dealId],
      stateStatus: "accepted",
    });
    return JSON.parse(result);
  },

  /**
   * Get the total number of deals.
   * @returns {number}
   */
  async getDealCount() {
    return await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_deal_count",
      args: [],
      stateStatus: "accepted",
    });
  },

  /**
   * Get deal IDs for a specific user.
   * @param {string} userAddress
   * @returns {Array<string>}
   */
  async getUserDeals(userAddress) {
    const result = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_user_deals",
      args: [userAddress],
      stateStatus: "accepted",
    });
    return JSON.parse(result);
  },

  /**
   * Get just the status of a deal.
   * @param {number} dealId
   * @returns {string}
   */
  async getDealStatus(dealId) {
    return await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_deal_status",
      args: [dealId],
      stateStatus: "accepted",
    });
  },

  /**
   * Get the AI verdict details for a deal.
   * @param {number} dealId
   * @returns {Object|null}
   */
  async getDealVerdict(dealId) {
    const result = await readClient.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_deal_verdict",
      args: [dealId],
      stateStatus: "accepted",
    });
    return result ? JSON.parse(result) : null;
  },

  // ── WRITE METHODS (wallet required) ──

  /**
   * Create a new deal.
   * @param {Object} params
   * @param {string} params.terms - Natural language deal terms
   * @param {string} params.priceDescription - Human-readable price
   * @param {string} params.deadlineDescription - Human-readable deadline
   * @param {string} params.verificationUrls - Comma-separated URLs
   * @returns {Object} Transaction receipt
   */
  async createDeal({ terms, priceDescription, deadlineDescription, verificationUrls }) {
    if (!writeClient) throw new Error("Wallet not connected");

    const hash = await writeClient.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "create_deal",
      args: [terms, priceDescription, deadlineDescription, verificationUrls],
      value: 0n,
    });

    return await waitForTx(hash);
  },

  /**
   * Fund a deal (buyer locks funds in escrow).
   * @param {number} dealId
   * @param {bigint} amount - Amount to deposit in wei
   * @returns {Object} Transaction receipt
   */
  async fundDeal(dealId, amount) {
    if (!writeClient) throw new Error("Wallet not connected");

    const hash = await writeClient.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "fund_deal",
      args: [dealId],
      value: amount,
    });

    return await waitForTx(hash);
  },

  /**
   * Submit evidence for a deal.
   * @param {number} dealId
   * @param {string} evidenceType - "delivery_proof"|"quality_report"|"tracking"|"receipt"|"other"
   * @param {string} evidenceUrl - URL pointing to the evidence
   * @param {string} description - What this evidence proves
   * @returns {Object} Transaction receipt
   */
  async submitEvidence(dealId, evidenceType, evidenceUrl, description) {
    if (!writeClient) throw new Error("Wallet not connected");

    const hash = await writeClient.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "submit_evidence",
      args: [dealId, evidenceType, evidenceUrl, description],
      value: 0n,
    });

    return await waitForTx(hash);
  },

  /**
   * Request AI verification of deal conditions.
   * This triggers the core intelligent contract logic:
   * validators fetch evidence, reason about terms, and vote.
   *
   * NOTE: This transaction may take longer than usual because
   * validators need to fetch web content and run LLM inference.
   *
   * @param {number} dealId
   * @returns {Object} Transaction receipt with verdict
   */
  async requestVerification(dealId) {
    if (!writeClient) throw new Error("Wallet not connected");

    const hash = await writeClient.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "request_verification",
      args: [dealId],
      value: 0n,
    });

    // Longer timeout for AI verification
    return await waitForTx(hash);
  },

  /**
   * Settle a verified deal (release funds to seller).
   * @param {number} dealId
   * @returns {Object} Transaction receipt
   */
  async settleDeal(dealId) {
    if (!writeClient) throw new Error("Wallet not connected");

    const hash = await writeClient.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "settle_deal",
      args: [dealId],
      value: 0n,
    });

    return await waitForTx(hash);
  },

  /**
   * Claim refund for a rejected deal (buyer only).
   * @param {number} dealId
   * @returns {Object} Transaction receipt
   */
  async claimRefund(dealId) {
    if (!writeClient) throw new Error("Wallet not connected");

    const hash = await writeClient.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "claim_refund",
      args: [dealId],
      value: 0n,
    });

    return await waitForTx(hash);
  },

  /**
   * Cancel an unfunded deal (seller only).
   * @param {number} dealId
   * @returns {Object} Transaction receipt
   */
  async cancelDeal(dealId) {
    if (!writeClient) throw new Error("Wallet not connected");

    const hash = await writeClient.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "cancel_deal",
      args: [dealId],
      value: 0n,
    });

    return await waitForTx(hash);
  },
};

export default clauseGuard;
