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
| L8 | `create_deal` milestone parse loop | `milestones` JSON array | Megabyte milestone blob parsed and stored; every later read of the deal pays for it | `MAX_MILESTONES_BLOB_LEN` raw-blob cap *before* `json.loads`, then 2..`MAX_MILESTONES = 10` entries with per-description length caps |
| L9 | `fund_deal` amount-freeze loop | milestone list | — (list already capped at create) | Bounded by `MAX_MILESTONES` |
| L10 | `request_milestone_verification` evidence filter + crawl | `evidence_list`, `all_urls` | Same surfaces as L1/L2 | `MAX_EVIDENCE_ITEMS = 50` and `MAX_URLS_PER_VERIFICATION = 10`, unchanged |
| L11 | `settle_milestone` / `claim_refund` released-sum loops | milestone list | — | Bounded by `MAX_MILESTONES` |

Constants live at the top of `contracts/clauseguard.py`. Tune as the protocol matures.

---

## Findings

Status legend: ✅ Fixed in this patch · 🟡 Mitigated (partial / by convention) · ⚠ Acknowledged (out of scope at the contract layer or intentionally off on studionet).

| # | Severity | Finding | Status | Reference |
|---|---|---|---|---|
| F1 | 🔴 Critical | Fund transfers commented out — `gl.transfer` is dormant on studionet | ⚠ Acknowledged | `settle_deal`, `claim_refund` — intentional for studionet build; re-enable before mainnet |
| F2 | 🔴 Critical | `settle_deal` had no caller restriction (any wallet could settle a verified deal) | ✅ Fixed | `settle_deal` now rejects callers that aren't seller or buyer |
| **N1** | 🔴 **Critical (NEW)** | **Counter-terms hijack** — non-party stages `pending_terms` on an `open` deal; seller calls `accept_counter_terms` after a buyer funds; buyer's locked funds bind to terms a third party wrote | ✅ Fixed | `propose_counter_terms` rejects competing non-party proposals on open deals; `fund_deal` clears stale pending_terms; `accept_counter_terms` requires `pending_terms_from == buyer` once funded; also rejects acceptance outside `open`/`funded` states |
| F3 | 🟠 High | Malicious evidence URLs | 🟡 Mitigated | URL length capped + count capped; full domain whitelist still out of scope |
| F4 | 🟠 High | Web crawler spoofing (host serves different content to crawler) | ⚠ Acknowledged | Not solvable in-contract; relies on `gl.eq_principle.strict_eq` consensus catching divergence |
| F5 | 🟠 High | LLM prompt injection via `terms` / `description` / evidence URL | 🟡 Mitigated | Field lengths capped; prompt-injection via free-text remains possible. Future work: JSON-escape user fields into the prompt template |
| F6 | 🟠 High | Verification-URL injection (seller pre-plants URLs) | 🟡 Mitigated | URL count + length capped at `create_deal` |
| **N2** | 🟠 **High (NEW)** | **Verification-loop lockout** — buyer keeps calling `request_verification` on a disputed deal, low-confidence verdicts always loop back to `disputed`, seller never settles | ✅ Fixed | `verification_attempts` counter + `MAX_VERIFICATION_ATTEMPTS = 3` rollback |
| F7 | 🟡 Medium | No rate limiting | 🟡 Mitigated | N2's attempt cap and per-deal evidence cap make `request_verification` flooding much harder. Per-sender global rate limiting remains future work |
| F8 | 🟡 Medium | Missing input validation (empty terms, oversized fields) | ✅ Fixed | Empty/length checks in `create_deal`, `submit_evidence`, `propose_counter_terms` |
| F9 | 🟡 Medium | No deadline enforcement | 🟡 Mitigated | `check_deadline` exists and routes to `rejected` when LLM confirms expiry; relative deadlines without a `funded_at` remain weak — see N5 |
| F10 | 🟡 Medium | Multi-source bypass — LLM counts "independent sources" without domain validation | ⚠ Acknowledged | LLM-level only; needs domain/IP grouping work outside contract |
| **N3** | 🟡 **Medium (NEW)** | **Zero-value fund acceptance** — buyer funds with 0 wei, claims the buyer slot, locks the deal | ✅ Fixed | `fund_deal` rolls back if `gl.message.value <= 0` |
| **N4** | 🟡 **Medium (NEW)** | Latent reentrancy / double-settle when `gl.transfer` is re-enabled — no idempotency flag, no checks-effects-interactions enforcement | ⚠ Acknowledged | Status-machine guard (`status == "verified"`) is the current barrier. When re-enabling transfers, write `status = "settled"` *before* `gl.transfer`, and add a `settled_at` flag |
| **N5** | 🟡 **Medium (NEW)** | `create_deal` accepted unbounded strings (1 MB `terms` made every deal read expensive) | ✅ Fixed | `MAX_TERMS_LEN` / `MAX_PRICE_LEN` / `MAX_DEADLINE_LEN` applied |
| F11 | 🟢 Low | No timestamps (`created_at` never populated) | ⚠ Acknowledged | Cosmetic — frontend can derive ordering from deal id |
| F12 | 🟢 Low | No event logging | ⚠ Acknowledged | Future work — `gl.emit` for audit trail |
| F13 | 🟢 Low | No dispute escalation UI | ⚠ Acknowledged | N2's cap converts infinite disputes into a hard stop; escalation path is off-chain |
| F14 | 🟢 Low | `funded_amount` tamper if a later method rewrites the field | 🟡 Mitigated | No method writes `funded_amount` after `fund_deal`; revisit if new methods touch the deal dict |
| **N6** | 🟢 **Low (NEW)** | Per-user deal-history list grew unbounded | ✅ Fixed | `MAX_DEALS_PER_USER = 500` cap in `_add_user_deal` |
| **N7** | 🟢 **Low (NEW)** | Self-dealing across two wallets — seller funds their own deal from a second wallet | ⚠ Acknowledged | Not preventable on-chain (sybil resistance is out of scope). Users should assume any single counterparty may control multiple addresses |
| **N8** | 🟡 **Medium (milestones)** | Milestone share manipulation — shares that under/over-sum, zero shares, or rounding dust stranding wei | ✅ Fixed | `create_deal` demands `sum(share_bps) == 10000` exactly and every share > 0; at `fund_deal` the last milestone absorbs the integer-division remainder so amounts sum to exactly `funded_amount` |
| **N9** | 🟠 **High (milestones)** | Classic-path corruption — `submit_evidence` / `request_verification` / `settle_deal` on a milestone deal would drive its status into classic states and bypass per-milestone gating | ✅ Fixed | All three roll back on milestone deals; the milestone variants roll back on classic deals |
| **N10** | 🟡 **Medium (milestones)** | Counter-terms drift — milestone deals sit in `funded` through evidence and verification, so an amendment there would shift the LLM's judgment mid-stream | ✅ Fixed | `propose_counter_terms` / `accept_counter_terms` allow milestone deals only in `open` |
| **N11** | 🟠 **High (milestones)** | Out-of-order or double release — releasing milestone k before 0..k-1, re-releasing a released milestone, or releasing after rejection to drain the refundable remainder | ✅ Fixed | `_require_current_milestone` enforces strict ordering; only `verified` milestones release (first release flips to `released`); `settle_milestone` rolls back unless deal status is `funded`/`partially_settled` |

---

## What's intentionally still loose

- **`gl.transfer` is commented out** in `settle_deal`, `claim_refund`, `settle_milestone`, and `cancel_deal`. Studionet does not process real value transfers in this build; escrow (including per-milestone releases) is tracked in contract state only. Re-enable before any non-studionet deployment, and add the N4 / F2 hardening at the same time.
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
6. Milestone spot-checks:
   - Happy path: create with a 2-milestone schedule → fund → milestone-1 evidence → verify → release (deal shows `partially_settled`) → milestone-2 evidence → verify → release (deal `settled`)
   - `create_deal` with shares summing to 9999 → reverts
   - `request_milestone_verification(deal, 1)` before milestone 0 released → reverts
   - Second `settle_milestone` on the same milestone → reverts
   - `submit_evidence` (classic) on a milestone deal → reverts
   - `propose_counter_terms` on a funded milestone deal → reverts
   - Reject milestone 2 after milestone 1 released, then `claim_refund` → settlement JSON shows the split (released amount to seller, remainder to buyer, pro-rata bond slash)
7. Open https://explorer-studio.genlayer.com/address/&lt;new&gt;, call `get_deal_count`, confirm 0.
8. Local state-machine regression at any time: `python3 tests/test_milestones.py` (no GenVM needed).
