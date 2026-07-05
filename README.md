# ClauseGuard

AI-powered P2P trade escrow protocol built on [GenLayer](https://www.genlayer.com/) Bradbury Testnet. Deal terms are written in plain English, funds lock in escrow, and GenLayer's AI validators autonomously verify whether conditions are met by fetching web evidence and reasoning about the terms.

## Why ClauseGuard

Every existing escrow protocol on any blockchain relies on binary oracle feeds or a centralized arbitrator. ClauseGuard is the first escrow that can *read and understand* deal terms and evidence, because GenLayer validators can reason about subjective conditions via LLMs and verify them against live web data.

Traditional smart contract escrow requires rigid boolean logic: "if X address calls release(), funds move." ClauseGuard replaces that with natural language: "Release payment when the shipment clears customs and buyer confirms quality." The intelligent contract does the rest.

## How It Works

```
Seller creates deal         Buyer funds escrow         Either party submits
with plain English    --->  locking tokens into   ---> evidence (URLs to
terms and price             the contract               tracking, reports, etc.)

         |                        |                           |
         v                        v                           v

AI validators fetch        Validators reason about     Consensus via Optimistic
web evidence from          whether evidence satisfies  Democracy: majority vote
submitted URLs             the natural-language terms  determines the outcome

         |
         v

Funds auto-release to seller (conditions met)
   or refund to buyer (conditions not met)
   or escalate to larger validator pool (disputed)
```

### GenLayer Capabilities Used

- **`gl.nondet.web.render()`** — Validators crawl tracking pages, delivery confirmations, and inspection reports
- **`gl.nondet.exec_prompt()`** — LLM reasons about whether evidence satisfies the deal terms
- **`gl.eq_principle.strict_eq()`** — Validators reach consensus on the subjective assessment
- **Optimistic Democracy appeals** — Disputed verdicts escalate to larger validator pools automatically

## Project Structure

```
clauseguard/
├── contracts/
│   └── clauseguard.py            # Intelligent contract (deploy via GenLayer Studio)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── CreateDealForm.jsx # Deal creation with natural language terms
│   │   │   ├── DealCard.jsx       # Deal card for marketplace grid
│   │   │   ├── DealDetail.jsx     # Full deal view with actions
│   │   │   ├── EvidencePanel.jsx  # Evidence submission and display
│   │   │   ├── StatusBadge.jsx    # Status indicator component
│   │   │   ├── StatusTimeline.jsx # Visual deal progress tracker
│   │   │   └── VerdictPanel.jsx   # AI verdict display
│   │   ├── lib/
│   │   │   ├── constants.js       # Shared config and enums
│   │   │   └── genlayer-integration.js  # GenLayer JS SDK bridge
│   │   └── frontend.jsx           # Main app (self-contained demo version)
│   ├── .env.example
│   └── package.json
├── deploy/
│   └── deploy.js                  # Deployment helper script
└── docs/
    └── deal-flow.md               # Detailed deal lifecycle documentation
```

## Quick Start

### 1. Deploy the Contract

Open [GenLayer Studio](https://studio.genlayer.com/contracts), paste the contents of `contracts/clauseguard.py`, and deploy to Bradbury testnet. Copy the contract address.

### 2. Set Up the Frontend

```bash
cd frontend
cp .env.example .env.local
# Edit .env.local and set your contract address
npm install
npm run dev
```

### 3. Connect and Trade

Open `http://localhost:3000`, connect your wallet, and create your first deal.

## Contract API

### Write Methods

| Method | Description |
|--------|-------------|
| `create_deal(terms, price_description, deadline_description, verification_urls, min_sources_required, milestones)` | Seller creates a deal with natural language terms; `milestones` is `""` for a classic deal or a JSON milestone schedule |
| `fund_deal(deal_id)` | Buyer deposits funds into escrow |
| `submit_evidence(deal_id, evidence_type, evidence_url, description)` | Either party submits proof (classic deals) |
| `request_verification(deal_id)` | Triggers AI verification by validators (classic deals) |
| `settle_deal(deal_id)` | Releases funds to seller after verification (classic deals) |
| `submit_milestone_evidence(deal_id, milestone_index, evidence_type, evidence_url, description)` | Either party submits proof for the current milestone |
| `request_milestone_verification(deal_id, milestone_index)` | Triggers AI verification of one milestone's condition |
| `settle_milestone(deal_id, milestone_index)` | Releases one verified milestone's share to the seller |
| `claim_refund(deal_id)` | Buyer reclaims funds from a rejected deal (milestone deals refund the unreleased remainder) |
| `cancel_deal(deal_id)` | Seller cancels an unfunded deal |

### Read Methods

| Method | Description |
|--------|-------------|
| `get_deal(deal_id)` | Full deal data as JSON |
| `get_open_deals()` | All open deals (marketplace view) |
| `get_all_deals()` | All deals (dashboard view) |
| `get_deal_status(deal_id)` | Current status string |
| `get_deal_verdict(deal_id)` | AI verification verdict details |
| `get_user_deals(user_address)` | Deal IDs for a specific user |
| `get_deal_count()` | Total deals created |

## Deal Lifecycle

```
open  -->  funded  -->  evidence_submitted  -->  verified  -->  settled
  |                                                  |
  v                                                  v
cancelled                                    rejected --> refunded
                                                |
                                                v
                                            disputed (escalates)
```

Milestone deals skip `evidence_submitted`/`verified` at the deal level and instead
move through `funded --> partially_settled --> settled` as each milestone releases:

```
open --> funded --> partially_settled --> ... --> settled
             \            \
              \            v
               +----> rejected --> refunded   (unreleased remainder to buyer)
               |          ^
               v          |
             disputed ----+  (re-verify the contested milestone)
```

### Milestone deals

A seller can attach an optional milestone schedule at creation: 2–10 phases, each
with its own plain-English condition and a share of the price in basis points
(shares must total exactly 10000). The buyer still funds the full amount once; wei
amounts are frozen at fund time with the last milestone absorbing rounding dust.
Milestones are verified and released **strictly in order** — evidence, verification,
and release always target the first non-released milestone. If a milestone is
rejected, released funds stay with the seller and the buyer refunds the remainder;
any seller bond is slashed pro-rata to the undelivered share (split 50/50
buyer/protocol), with the delivered share's portion returned to the seller.

### Status Definitions

- **open** — Deal listed, waiting for buyer to fund
- **funded** — Buyer has deposited, escrow is active
- **evidence_submitted** — One or both parties have submitted proof
- **verified** — AI validators confirm conditions are met
- **partially_settled** — Milestone deal with at least one phase released, more to go
- **settled** — Funds released to seller, deal complete
- **rejected** — AI validators determine conditions are not met
- **refunded** — Buyer has reclaimed funds from a rejected deal
- **disputed** — Low-confidence verdict, escalated to larger validator pool
- **cancelled** — Seller withdrew an unfunded deal

## Evidence Types

When submitting evidence, use one of these categories:

- `delivery_proof` — Shipping confirmations, delivery receipts
- `quality_report` — Inspection results, lab analyses, certifications
- `tracking` — Live tracking page URLs
- `receipt` — Purchase receipts, invoices
- `other` — Any other supporting evidence

## AI Verification Deep Dive

When `request_verification()` is called, each GenLayer validator independently:

1. Fetches all submitted evidence URLs using `gl.nondet.web.render()`
2. Fetches all verification URLs specified when the deal was created
3. Constructs a prompt with the deal terms + all fetched web content
4. Asks the LLM to assess whether every condition in the terms is satisfied
5. Returns a structured verdict with `conditions_met`, `confidence`, `reasoning`, and `unmet_conditions`

Validators then vote via Optimistic Democracy. If the majority agrees, the verdict stands. If contested, it escalates through appeal rounds with progressively larger validator pools.

The LLM prompt is designed to be rigorous: it only returns `conditions_met: true` if ALL terms are clearly satisfied by the evidence. Ambiguous or unverified conditions result in rejection.

## Growth Roadmap

- ~~Multi-milestone deals with partial fund releases~~ ✓ shipped
- Reputation scoring based on completed deal history
- Invoice factoring module for business-to-business finance
- Escrow templates for common trade types (freelance, commodity, digital goods)
- DAO governance for protocol parameter tuning
- Cross-chain settlement bridges

## Built With

- [GenLayer](https://www.genlayer.com/) — AI-native blockchain with Intelligent Contracts
- [GenLayer JS SDK](https://github.com/genlayerlabs/genlayer-js) — Frontend contract interaction
- [GenVM](https://docs.genlayer.com/) — Python execution environment for Intelligent Contracts
- React / Next.js — Frontend framework

## License

MIT
