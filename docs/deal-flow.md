# ClauseGuard Deal Flow — Technical Reference

## Complete Transaction Lifecycle

### Phase 1: Deal Creation

The seller calls `create_deal()` with five parameters:

- **terms** — Natural language description of the deal. This is the "contract" that AI validators will interpret. Should be specific about deliverables, quality standards, quantities, timelines, and acceptance criteria.
- **price_description** — Human-readable price (e.g., "4,500 USDT"). Stored as metadata for display.
- **deadline_description** — Human-readable deadline (e.g., "Delivery by April 20, 2026").
- **verification_urls** — Comma-separated URLs that validators should check. These are sites where deal conditions can be independently verified (tracking pages, inspection portals, regulatory databases, etc.).
- **min_sources_required** — How many distinct, independent sources must confirm the conditions. The prompt tells the validators to count domains and return `conditions_met: false` with `insufficient_independent_sources` among the unmet conditions if the count falls short. Floored at 1, so passing 0 behaves like passing 1.

The call is payable. Any value the seller attaches becomes their good-faith bond
(`collateral_amount`), which the buyer has to match at funding. Attach nothing and
the deal simply runs without a bond on either side.

The contract assigns an incremented deal ID and stores the deal with status `open`.

### Phase 2: Funding

A buyer calls `fund_deal(deal_id)` with a token value attached to the transaction. If the seller posted a good-faith bond at creation, the buyer must match it on top of the price: the contract splits the attached value into `funded_amount` (the escrow price) and `buyer_collateral` (the matched bond). The contract records the buyer's address and both figures, then moves the deal to `funded`. A seller can't fund their own deal, and the contract rejects zero-value funding.

### Phase 3: Evidence Submission

Either party can call `submit_evidence()` one or more times. Each evidence entry includes a type classification, a URL, and a plain English description of what it proves. The contract stores all evidence entries and moves the deal to `evidence_submitted`.

### Phase 4: AI Verification

This is the core intelligent contract logic. When either party calls `request_verification()`:

1. The contract collects all evidence URLs and verification URLs
2. Inside an equivalence principle block, each validator:
   - Fetches every URL via `gl.nondet.web.render()`
   - Constructs a prompt carrying the deal terms plus the fetched content of every page
   - Calls `gl.nondet.exec_prompt()` for LLM assessment
   - Normalizes the response onto a closed vocabulary: a bool, a three-value
     confidence enum, one reason code, and a sorted list of unmet-condition codes
3. `gl.eq_principle.strict_eq()` compares that value byte for byte across
   validators. Nothing free-text goes into it. The model's own wording differs
   from run to run, so prose in the payload means consensus can never be reached
   (N11 in `SECURITY.md`)
4. The verdict determines the next status: `verified`, `rejected`, or `disputed`
5. After consensus, ordinary contract code looks the agreed code up in
   `REASON_TEXT` and writes the readable sentence into `verdict_details`. The
   sentence the UI shows is written by the contract, not by the model

### Phase 5: Finalization

One of the deal's parties calls a finalizer. Which one depends on the verdict:

| Verdict | Method | Who may call | What gets credited |
|---|---|---|---|
| `verified` | `settle_deal()` | seller or buyer | seller: price + own bond · buyer: own bond |
| `rejected` | `claim_refund()` | buyer only | buyer: price + own bond + half the seller's bond · the other half is stranded |
| still `open` | `cancel_deal()` | seller only | seller: own bond |
| `disputed`, or stuck in `funded` / `evidence_submitted` | `propose_resolution()` | seller **and** buyer, matching | per the agreed outcome, both bonds returned whole |

None of these send anything. They write the deal's terminal status, then move wei
from the locked bucket onto a `payouts` ledger.

### Phase 5b: Mutual resolution

The first three finalizers each key off a verdict. A deal that never gets one has
no way out: three low-confidence verdicts leave it `disputed` with its
verification attempts spent, and a `funded` deal with no evidence and a relative
deadline the LLM won't call expired sits there indefinitely. That was N8 in
`SECURITY.md`, and `propose_resolution(deal_id, outcome)` is the fix.

Each party signs one of three outcomes. The deal executes the moment both
signatures match, landing in a new terminal status `resolved`:

| Outcome | Seller gets | Buyer gets |
|---|---|---|
| `release` | price + own bond | own bond |
| `refund` | own bond | price + own bond |
| `split` | half the price + own bond | half the price + own bond (odd wei) |

One signature only records a ballot (visible in `get_deal` as
`resolution_seller` / `resolution_buyer`) and moves nothing. Re-signing replaces
your previous choice, so a party can change their mind to break a stalemate.
Two matching signatures are always required: a unilateral exit from `funded`
would let a buyer reclaim funds after the seller had already shipped.

No bond is slashed here, unlike `claim_refund`. A mutual agreement isn't an
adjudicated breach, and returning both bonds whole is what makes cooperating
cheaper for a seller than stalling in `disputed`.

Two parties who sign conflicting outcomes forever are still stuck. Breaking that
needs a clock or an arbiter, and the GenVM offers a deterministic method neither.

### Phase 6: Withdrawal

Each party calls `withdraw()` to collect whatever `payouts` says they're owed.
This is the only method in the contract that emits a transfer. It zeroes the
ledger entry first, then emits.

Splitting finalization from payment costs an extra transaction and buys one
thing: a payee whose address can't receive value can only stall their own
withdrawal. Push the money inside `settle_deal()` instead and a single broken
recipient wedges the counterparty's settlement along with their own.

`get_payout(address)` shows what's waiting. `get_accounting()` shows the three
counters (locked, credited, protocol-retained) whose sum must equal the
contract's balance.

Consensus applies a transfer after the transaction commits, not during it.
There's no return status to check, which is why the contract's defense against
over-promising is the balance invariant rather than a failed-send retry.

## Example: Coffee Bean Trade

**Deal terms:** "Ship 200 units of organic coffee beans (Grade A Arabica) via DHL Express to Berlin warehouse. Buyer confirms receipt and quality inspection within 5 business days. Beans must match sample spec: moisture below 12%, zero defects."

**Evidence submitted:**
1. Seller submits DHL tracking URL showing delivery status
2. Seller submits certificate of analysis from roaster
3. Buyer submits warehouse receipt confirming delivery signature

**Verification:** Validators fetch the DHL tracking page, read the certificate of analysis content, and check the warehouse receipt. The LLM assesses whether all conditions (Grade A Arabica, DHL Express, Berlin delivery, moisture specs) are confirmed by the evidence.
