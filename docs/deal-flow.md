# ClauseGuard Deal Flow — Technical Reference

## Complete Transaction Lifecycle

### Phase 1: Deal Creation

The seller calls `create_deal()` with four parameters:

- **terms** — Natural language description of the deal. This is the "contract" that AI validators will interpret. Should be specific about deliverables, quality standards, quantities, timelines, and acceptance criteria.
- **price_description** — Human-readable price (e.g., "4,500 USDT"). Stored as metadata for display.
- **deadline_description** — Human-readable deadline (e.g., "Delivery by April 20, 2026").
- **verification_urls** — Comma-separated URLs that validators should check. These are sites where deal conditions can be independently verified (tracking pages, inspection portals, regulatory databases, etc.).

The contract assigns an incremented deal ID and stores the deal with status `open`.

### Phase 2: Funding

A buyer calls `fund_deal(deal_id)` with a token value attached to the transaction. The contract records the buyer's address and the funded amount, then moves the deal to `funded` status. The seller cannot fund their own deal.

### Phase 3: Evidence Submission

Either party can call `submit_evidence()` one or more times. Each evidence entry includes a type classification, a URL, and a plain English description of what it proves. The contract stores all evidence entries and moves the deal to `evidence_submitted`.

### Phase 4: AI Verification

This is the core intelligent contract logic. When either party calls `request_verification()`:

1. The contract collects all evidence URLs and verification URLs
2. Inside an equivalence principle block, each validator:
   - Fetches every URL via `gl.nondet.web.render()`
   - Constructs a comprehensive prompt with deal terms + all web content
   - Calls `gl.nondet.exec_prompt()` for LLM assessment
   - Parses the response into a structured verdict
3. `gl.eq_principle.strict_eq()` ensures validators reach consensus
4. The verdict determines the next status: `verified`, `rejected`, or `disputed`

### Phase 5: Settlement

If verified, anyone can call `settle_deal()` to release escrowed funds to the seller. If rejected, the buyer can call `claim_refund()` to recover their deposit. Disputed deals escalate through GenLayer's built-in appeal mechanism.

## Milestone Deals (Phased Releases)

A seller can attach a milestone schedule at `create_deal` time: a JSON array of
2–10 `{"description", "share_bps"}` objects whose basis-point shares sum to
exactly 10000. Deals created with an empty `milestones` string behave exactly as
described above.

**Funding.** The buyer funds the full amount once, as usual. At that moment the
contract freezes each milestone's wei amount as `funded_amount * share_bps // 10000`,
with the last milestone taking whatever remains after integer division — the
amounts always sum to exactly the escrowed value.

**Sequential releases.** Milestones advance strictly in order. For the first
non-released milestone, either party can:

1. `submit_milestone_evidence(deal_id, k, ...)` — evidence is tagged with the
   milestone index and stored in the same capped evidence list.
2. `request_milestone_verification(deal_id, k)` — the validators run the same
   crawl-and-judge pipeline, but the LLM prompt names the single milestone
   condition under review (full deal terms remain as context). Approved →
   milestone `verified`; rejected at low confidence → milestone and deal
   `disputed` (re-verifiable up to 3 times per milestone); rejected otherwise →
   milestone and deal `rejected`.
3. `settle_milestone(deal_id, k)` — releases that milestone's share to the
   seller. The deal becomes `partially_settled`, or `settled` when the last
   milestone releases (both good-faith bonds return in full).

**Rejection mid-stream.** Released milestones stay with the seller. On
`claim_refund`, the buyer receives the unreleased remainder plus their own bond,
and the seller's bond is slashed pro-rata to the undelivered share: the at-risk
slice splits 50/50 between buyer and protocol, the rest returns to the seller.

*Worked example:* price 2000 wei, milestones 50%/50%, seller bond 1001 wei.
Milestone 1 verifies and releases (seller receives 1000). Milestone 2 is
rejected. The buyer refunds 1000 (the unreleased half). The at-risk bond slice is
`1001 * 5000 // 10000 = 500`: 250 to the buyer, 250 retained by the protocol,
and the remaining 501 returns to the seller.

## Example: Coffee Bean Trade

**Deal terms:** "Ship 200 units of organic coffee beans (Grade A Arabica) via DHL Express to Berlin warehouse. Buyer confirms receipt and quality inspection within 5 business days. Beans must match sample spec: moisture below 12%, zero defects."

**Evidence submitted:**
1. Seller submits DHL tracking URL showing delivery status
2. Seller submits certificate of analysis from roaster
3. Buyer submits warehouse receipt confirming delivery signature

**Verification:** Validators fetch the DHL tracking page, read the certificate of analysis content, and check the warehouse receipt. The LLM assesses whether all conditions (Grade A Arabica, DHL Express, Berlin delivery, moisture specs) are confirmed by the evidence.
