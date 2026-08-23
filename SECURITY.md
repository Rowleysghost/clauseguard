# ClauseGuard Security

This document replaces the prior `SECURITY_ANALYSIS.md` / `ATTACK_VECTORS.md` / `CODE_FIXES.md` / `REMEDIATION_GUIDE.md` / `SECURITY_EXECUTIVE_SUMMARY.md` / `QUICK_REFERENCE.md` / `SECURITY_ANALYSIS_INDEX.md` set, which had grown noisy and overlapping. Source of truth is the contract itself at `contracts/clauseguard.py`.

---

## Trust model

ClauseGuard is a P2P escrow on GenLayer. Two parties write plain-English terms; the buyer locks funds; a network of validators crawl evidence URLs, run an LLM over them under `gl.eq_principle.strict_eq`, and produce a deterministic-by-consensus verdict that releases or refunds.

We trust:
- The seller and buyer have read each other's terms before funding.
- The GenLayer validator set runs each validator's LLM honestly and reaches consensus.
- Third-party URL hosts (imgbb, etc.) serve the same content to every validator at verification time.

We do **not** trust:
- Either party not to be hostile.
- Either party not to control multiple wallets (sybil is out of scope at the contract layer — see N7).
- Any URL referenced in evidence or verification — it may be attacker-controlled.
- LLM output beyond what the equivalence principle confirms.

Threat actors: hostile seller, hostile buyer, hostile third-party (any non-party caller), hostile URL host.

---

## Loop analysis

Every loop in the contract walks data a caller can grow. Pre-fix every loop was unbounded; the patches below cap each one.

| # | Location | Iterates | Exploit if unbounded | Bound applied |
|---|---|---|---|---|
| L1 | `request_verification` web-crawl loop | `all_urls` (evidence + verification URLs) | Push N URLs → N expensive `gl.nondet.web.render` calls; griefs validator compute and lets a caller funnel crawls at chosen targets | `MAX_URLS_PER_VERIFICATION = 10`, hard-rollback if exceeded |
| L2 | `request_verification` evidence-summary loop | `evidence_list` | Spam `submit_evidence` → evidence section of LLM prompt explodes → prompt truncation, non-determinism, consensus failure | `MAX_EVIDENCE_ITEMS = 50` enforced at `submit_evidence` time |
| L3 | `request_verification` web-summary concat loop | `web_evidence` | Combined with L1 — N URLs × per-page cap = unbounded total; blows past LLM context window | `MAX_WEB_SUMMARY_LEN = 50_000`, early-break with truncation marker |
| L4 | `get_open_deals` | `range(1, deal_count+1)` | Every dashboard load is O(N) reads; `create_deal` is open so an attacker can grow `deal_count` cheaply | Paginated `get_open_deals(offset, limit)`, capped at `MAX_PAGE_SIZE = 100` |
| L5 | `get_all_deals` | same | Same as L4, returns *all* statuses | Paginated `get_all_deals(offset, limit)` |
| L6 | `submit_evidence` parse+append | `evidence_list` | Each call re-parses & re-serializes; without a cap, list grows to MB and griefs every subsequent call on the same deal | `MAX_EVIDENCE_ITEMS = 50` + per-field length caps |
| L7 | `_add_user_deal` (implicit list growth) | `user_deals[user]` | A spammy user blows up their *own* `user_deals` JSON until reads/writes are unaffordable | `MAX_DEALS_PER_USER = 500`; silently no-op beyond that |

Constants live at the top of `contracts/clauseguard.py`. Tune as the protocol matures.

---

## Findings

Status legend: ✅ Fixed in this patch · 🟡 Mitigated (partial / by convention) · ⚠ Acknowledged (out of scope at the contract layer or intentionally off on studionet).

| # | Severity | Finding | Status | Reference |
|---|---|---|---|---|
| F1 | 🔴 Critical | Fund transfers commented out — no method could move value out of the contract | ✅ Fixed | Pull-payment model added. `settle_deal` / `claim_refund` / `cancel_deal` credit a `payouts` ledger; the new `withdraw()` is the only method that sends. See "Money" below |
| F2 | 🔴 Critical | `settle_deal` had no caller restriction (any wallet could settle a verified deal) | ✅ Fixed | `settle_deal` now rejects callers that aren't seller or buyer |
| **N1** | 🔴 **Critical (NEW)** | **Counter-terms hijack** — non-party stages `pending_terms` on an `open` deal; seller calls `accept_counter_terms` after a buyer funds; buyer's locked funds bind to terms a third party wrote | ✅ Fixed | `propose_counter_terms` rejects competing non-party proposals on open deals; `fund_deal` clears stale pending_terms; `accept_counter_terms` requires `pending_terms_from == buyer` once funded; also rejects acceptance outside `open`/`funded` states |
| F3 | 🟠 High | Malicious evidence URLs | 🟡 Mitigated | URL length capped + count capped; full domain whitelist still out of scope |
| F4 | 🟠 High | Web crawler spoofing (host serves different content to crawler) | ⚠ Acknowledged | Not solvable in-contract; relies on `gl.eq_principle.strict_eq` consensus catching divergence |
| F5 | 🟠 High | LLM prompt injection via `terms` / `description` / evidence URL | 🟡 Mitigated | Field lengths capped; prompt-injection via free-text remains possible. Future work: JSON-escape user fields into the prompt template |
| F6 | 🟠 High | Verification-URL injection (seller pre-plants URLs) | 🟡 Mitigated | URL count + length capped at `create_deal` |
| **N2** | 🟠 **High (NEW)** | **Verification-loop lockout** — buyer keeps calling `request_verification` on a disputed deal, low-confidence verdicts always loop back to `disputed`, seller never settles | ✅ Fixed | `verification_attempts` counter + `MAX_VERIFICATION_ATTEMPTS = 3` rollback |
| **N8** | 🟠 **High (NEW)** | **Terminal `disputed` locks funds permanently** — after 3 low-confidence verdicts a deal sits in `disputed`, and no finalizer accepts that status. Same for a `funded` deal whose relative deadline the LLM won't call expired. Harmless when escrow was notional; now it strands real wei | ✅ Fixed | `propose_resolution(deal_id, outcome)`. Both parties sign one of `release` / `refund` / `split`; the deal executes to a new terminal `resolved` status the moment the two signatures match. Nothing is slashed. The timeout-split alternative is not implementable — the GenVM gives a deterministic method no clock. See "Mutual resolution" below |
| **N11** | 🟠 **High (NEW)** | **`strict_eq` byte-compares LLM prose** — `verify_conditions` put `reasoning`, a 2–3 sentence free-text model explanation, inside the payload `gl.eq_principle.strict_eq` compares byte for byte across validators. `conditions_met` (bool) and `confidence` (3-value enum) survive that comparison; differently-worded prose from a non-zero-temperature model does not, so consensus fails and no verdict is ever recorded | ✅ Fixed | Prose is out of the compared value entirely. Both nondet blocks now return closed vocabularies — a bool, a 3-value confidence enum, and reason codes drawn from fixed tuples — with anything off-vocabulary coerced back on by `_pick` / `_pick_codes`. The readable sentence is composed *after* consensus from the agreed code via the `REASON_TEXT` lookup, which every validator performs identically. See "What crosses the equivalence principle" below |
| F7 | 🟡 Medium | No rate limiting | 🟡 Mitigated | N2's attempt cap and per-deal evidence cap make `request_verification` flooding much harder. Per-sender global rate limiting remains future work |
| F8 | 🟡 Medium | Missing input validation (empty terms, oversized fields) | ✅ Fixed | Empty/length checks in `create_deal`, `submit_evidence`, `propose_counter_terms` |
| F9 | 🟡 Medium | No deadline enforcement | 🟡 Mitigated | `check_deadline` exists and routes to `rejected` when LLM confirms expiry; relative deadlines without a `funded_at` remain weak — see N5 |
| F10 | 🟡 Medium | Multi-source bypass — LLM counts "independent sources" without domain validation | ⚠ Acknowledged | LLM-level only; needs domain/IP grouping work outside contract |
| **N3** | 🟡 **Medium (NEW)** | **Zero-value fund acceptance** — buyer funds with 0 wei, claims the buyer slot, locks the deal | ✅ Fixed | `fund_deal` rolls back if `gl.message.value <= 0` |
| **N4** | 🟡 **Medium (NEW)** | Latent reentrancy / double-settle once transfers are real — no idempotency flag, no checks-effects-interactions enforcement | ✅ Fixed | Finalizers write the terminal status before touching the ledger, so a replay hits the status guard. Finalization makes no external call at all; `withdraw()` zeroes the ledger entry before emitting the transfer. Covered by `tests/test_double_finalization.py` |
| **N5** | 🟡 **Medium (NEW)** | `create_deal` accepted unbounded strings (1 MB `terms` made every deal read expensive) | ✅ Fixed | `MAX_TERMS_LEN` / `MAX_PRICE_LEN` / `MAX_DEADLINE_LEN` applied |
| **N9** | 🟡 **Medium (NEW)** | **`gl.rollback` does not exist** in any version of the py-genlayer stdlib. All 45 guards called it, so every one raised `AttributeError` instead of reverting with its message. The transaction still failed, so no guard was bypassable — but no guard ever produced a readable reason, and the same mistake produced the dead `gl.transfer(...)` lines | ✅ Fixed | Every site now goes through one `_fail()` helper raising `gl.vm.UserError`, which the GenVM runner converts to a rollback carrying the message. Message strings unchanged. Validators compare them for strict equality, so treat them as consensus-relevant |
| **N10** | 🟡 **Medium (NEW)** | **Transfers are applied after the transaction commits.** `emit_transfer` queues a message for consensus (`on='finalized'`); it is not a synchronous send. `withdraw()` has already zeroed the ledger entry by then, so a transfer consensus fails to apply leaves that wei in the contract with no claim on it | ⚠ Acknowledged | Not preventable contract-side: there is no return status to check and no in-transaction failure to catch. The balance invariant is the defense against over-promising. Written up as `tests/test_transfer_failures.py::test_a_dropped_transfer_strands_wei_and_breaks_the_books`, which models the drop and asserts the broken books. That test passes |
| F11 | 🟢 Low | No timestamps (`created_at` never populated) | ⚠ Acknowledged | Cosmetic — frontend can derive ordering from deal id |
| F12 | 🟢 Low | No event logging | ⚠ Acknowledged | Future work — `gl.emit` for audit trail |
| F13 | 🟢 Low | No dispute escalation UI | ⚠ Acknowledged | N2's cap converts infinite disputes into a hard stop; escalation path is off-chain |
| F14 | 🟢 Low | `funded_amount` tamper if a later method rewrites the field | 🟡 Mitigated | No method writes `funded_amount` after `fund_deal`; revisit if new methods touch the deal dict |
| **N6** | 🟢 **Low (NEW)** | Per-user deal-history list grew unbounded | ✅ Fixed | `MAX_DEALS_PER_USER = 500` cap in `_add_user_deal` |
| **N7** | 🟢 **Low (NEW)** | Self-dealing across two wallets — seller funds their own deal from a second wallet | ⚠ Acknowledged | Not preventable on-chain (sybil resistance is out of scope). Users should assume any single counterparty may control multiple addresses |

---

## Money

Three counters back every wei the contract holds:

| Field | Meaning |
|---|---|
| `total_locked` | held against deals that haven't reached a terminal state |
| `total_credited` | owed to a party, sitting in `payouts`, not yet withdrawn |
| `protocol_retained` | slashed halves of seller bonds. No method pays this out |

The invariant:

```
contract balance == total_locked + total_credited + protocol_retained
```

`get_accounting()` returns the three counters and their sum; `get_contract_balance()`
returns the chain-side balance, so the invariant is auditable from outside without
trusting the contract's own arithmetic. The mocked test suite asserts it after
every test via an autouse fixture, so a test about authorization also proves
nothing leaked.

All 104 tests pass. `tests/mutation_check.py` is what makes that worth
anything: it breaks the contract 25 different ways on a scratch copy and
checks the suite notices. It does, all 25 times. Double-credit the seller in
`settle_deal` and the conservation tests go red; stop `_credit` from bumping
`total_credited` and 18 tests plus 21 invariant errors fire. What none of this
proves is that the stub in `tests/stubs/genlayer.py` behaves like the real
GenVM. Everything below the invariant rests on that assumption, and only a
Studio run tests it.

**Push vs pull.** Finalizers never send. They credit `payouts` and each party
calls `withdraw()` for their own money. This costs an extra transaction per
payout and buys one thing worth more than the convenience: a payee whose address
can't receive value can only stall their own withdrawal. Under a push model
inside `settle_deal`, one broken recipient would wedge the counterparty's
settlement too. `tests/test_transfer_failures.py` pins that property.

**The slash sink.** On rejection the seller's bond splits 50/50: half credited
to the buyer, half added to `protocol_retained`. Odd wei rounds to the protocol
side. There is no owner role, no treasury address, and no method that reduces
`protocol_retained`. Nothing can reach that wei again. The split caps
the buyer's upside so a rejection can't be farmed for profit. The ratio and the
choice to strand rather than redistribute are still worth a design review.

**Mutual resolution.** `propose_resolution` is the escape hatch for a deal the
AI can't finish: `disputed` after three low-confidence verdicts, or `funded` /
`evidence_submitted` with no evidence and a relative deadline the LLM won't call
expired. Each party signs `release`, `refund`, or `split`; matching signatures
execute immediately to a terminal `resolved` status.

Four of those choices are deliberate:

- **Two signatures, always.** One ballot is recorded and moves nothing. A
  unilateral exit from `funded` would let a buyer claw funds back after the
  seller shipped but before evidence landed.
- **No slashing.** Both bonds go home whole. A mutual agreement isn't an
  adjudicated breach, and it makes cooperation strictly cheaper for a seller
  than stalling: sign `refund` and keep the bond, or sit in `disputed` until
  someone reaches `claim_refund` and lose half of it.
- **`split` exists** so a partial-delivery dispute has a landing spot. With only
  release and refund on the table, each side holds out for the whole pot. Odd
  wei goes to the buyer, whose escrow it was.
- **Re-signing overwrites.** A party's ballot is their latest one, not their
  first, so someone can concede and unstick a stalemate without a new method.

What this does **not** fix: two parties who sign different outcomes forever. That
deadlock still strands the wei, and no contract-side rule can break it without
either a clock or a third-party arbiter. The honest scope of the fix is "parties
who both want out can get out", not "funds can never be stuck".

**What crosses the equivalence principle.** `gl.eq_principle.strict_eq` compares
the value a nondet block returns byte for byte across the validator set. The old
`verify_conditions` returned the model's own explanation inside that value, so
two validators reaching the identical judgment about the identical evidence
would still disagree on the bytes, consensus would fail, and the contract would
record no verdict at all. That was N11.

Everything in the compared payload is now drawn from a closed set:

| Field | Domain |
|---|---|
| `conditions_met` | `bool` |
| `confidence` | `CONFIDENCE_LEVELS`: `high` / `medium` / `low` |
| `reason_code` | `VERDICT_REASON_CODES`, 8 codes |
| `unmet_conditions` | subset of `UNMET_CONDITION_CODES`, deduplicated and **sorted** |

`_pick` coerces a model-supplied string onto its vocabulary; anything invented
collapses to the default. `_pick_codes` filters a list down to known codes and
sorts it, because two validators can agree on the same set of unmet conditions
and still emit them in a different order, which a byte comparison reads as
disagreement. `check_deadline` gets the same treatment against
`DEADLINE_REASON_CODES`. The readable sentence is looked up from `REASON_TEXT`
*after* consensus, in ordinary deterministic contract code, and written to
`verdict_details`. The UI keeps its prose; the validators never compare it.

**Coercion has a direction, and it's a safety property.** An unreadable
confidence lands on `low`, which routes to `disputed`: nothing moves and the
parties can re-verify or resolve. Before the fix `confidence` was passed
through as `str(...)`, so `"Medium"` silently failed the `== "low"` test and the
deal went to `rejected`, refunding the buyer and burning half the seller's bond
on the strength of a word the contract did not understand.
`test_an_invented_confidence_level_disputes_rather_than_rejects` pins it.

**"Compare a hash of the prose" does not work**, though an earlier draft of this
document suggested it. Hashing divergent prose diverges identically. Nor can the
leader's reasoning "ride as non-consensus metadata": the block's return value
*is* the compared value, so there is no channel out of a `strict_eq` block that
validators don't inspect.

`tests/test_verdict_consensus.py` (15 tests) reads the compared string directly,
because the stub logs every value handed to `strict_eq`. That's the closest a
single-validator harness gets to proving consensus is attainable: it can't run a
validator set, but it can prove the compared value holds nothing that varies
between one model run and the next. The reproducer runs two deals with the same
judgment and different wording and asserts the two compared strings are equal.

Still unproven the same way everything else here is: the stub is a model of the
GenVM, not the GenVM.

---

## What's intentionally still loose

- **The contract file is ahead of the deployed bytecode.** `contracts/clauseguard.py`
  now has `payouts`, the three counters, `withdraw()`, payable
  `create_deal` / `fund_deal`, `propose_resolution` with its two ballot fields and
  the terminal `resolved` status, and the reason-code vocabularies. The contract
  live at
  `0xE71C283aaA3A5f1cC3E12d126Fd13e8059F4b54F` has none of it. GenLayer contracts
  are immutable, so this needs a fresh deploy (see the redeploy checklist in
  `CLAUDE.md`) before any of it is reachable from the frontend. The frontend now
  carries the matching UI: a `resolved` stamp, the settlement-by-consent signing
  panel, and a "collect funds" banner driven by `get_payout`. All of it
  degrades to nothing against a contract that lacks those methods, because the
  reads are wrapped and the affordances are keyed off status values the old
  contract never writes.
- **No domain whitelist** for evidence or verification URLs. Length and count caps are the current defense; if a domain whitelist is ever introduced, it likely belongs at the frontend `create_deal` / `submit_evidence` step, not in the contract, because trust is per-deal.
- **Sybil resistance** is out of scope for the contract. Anyone evaluating a counterparty should treat reputation as off-chain context.

---

## Re-deploy checklist

1. Push the patched `contracts/clauseguard.py` to https://studio.genlayer.com and deploy a new contract.
2. Copy the new address into:
   - Vercel dashboard → clauseguard project → `NEXT_PUBLIC_CONTRACT_ADDRESS`
   - Local `frontend/.env.local` for dev
3. Trigger a Vercel redeploy (or push an empty commit to `main`).
4. In the live UI, run the happy path: create → fund (2nd wallet) → submit evidence → request verification → settle. Confirm no regressions.
5. Spot-check the new bounds:
   - 51st `submit_evidence` on one deal → reverts
   - `create_deal` with terms > 4000 chars → reverts
   - Third-party `propose_counter_terms` on an open deal that already has a pending proposal → reverts
   - 4th `request_verification` on a disputed deal → reverts
   - N1 reproducer (non-party proposal → buyer funds → seller accepts) → reverts at step 4
   - N8 reproducer: drive a deal to `disputed`, confirm `settle_deal` / `claim_refund` /
     `cancel_deal` all revert, then have both parties call `propose_resolution(id, "split")`
     → status `resolved`, both payouts collectable via `withdraw()`
   - One-sided `propose_resolution` → deal stays put; `get_deal` shows the recorded ballot
   - N11 check, and the only one the mocked suite can't make: run
     `request_verification` on a real multi-validator deal and confirm a verdict
     lands at all. Pre-fix the expected symptom was consensus failure with no
     verdict written. Then read `verdict_details` — `reason_code` must be one of
     `VERDICT_REASON_CODES` and `reasoning` must match `REASON_TEXT[reason_code]`
     word for word. Any other sentence there means prose is reaching the payload
     again
6. Open https://explorer-studio.genlayer.com/address/&lt;new&gt;, call `get_deal_count`, confirm 0.
