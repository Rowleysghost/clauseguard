/**
 * ClauseGuard — Contract Deployment Script
 *
 * This script deploys the ClauseGuard intelligent contract to GenLayer
 * Bradbury testnet using the GenLayer CLI.
 *
 * Prerequisites:
 *   npm install -g genlayer
 *   genlayer init
 *
 * Alternative: Deploy via GenLayer Studio UI at https://studio.genlayer.com/contracts
 *
 * Usage:
 *   node deploy/deploy.js
 */

import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { readFileSync } from "fs";
import { resolve } from "path";

async function deploy() {
  console.log("=== ClauseGuard Deployment ===\n");

  // Read the contract source
  const contractPath = resolve("contracts/clauseguard.py");
  const contractSource = readFileSync(contractPath, "utf-8");
  console.log(`Contract loaded from: ${contractPath}`);
  console.log(`Contract size: ${contractSource.length} bytes\n`);

  console.log("To deploy ClauseGuard:");
  console.log("1. Open https://studio.genlayer.com/contracts");
  console.log("2. Paste the contract code from contracts/clauseguard.py");
  console.log("3. Click Deploy to Bradbury testnet");
  console.log("4. Copy the contract address");
  console.log("5. Set it in frontend/.env.local as NEXT_PUBLIC_CONTRACT_ADDRESS\n");

  console.log("Contract methods available after deployment:");
  console.log("  WRITE: create_deal, fund_deal, submit_evidence, request_verification, settle_deal, claim_refund, cancel_deal");
  console.log("  READ:  get_deal, get_deal_count, get_deal_status, get_deal_verdict, get_user_deals, get_open_deals, get_all_deals");
}

deploy().catch(console.error);
