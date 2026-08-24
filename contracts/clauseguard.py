# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json


# ── Bounds ─────────────────────────────────────────────
# Every loop in this contract is gated by one of these limits. Keep them
# conservative — they are the only thing standing between a hostile caller
# and an LLM-prompt or storage explosion.
MAX_EVIDENCE_ITEMS = 50
MAX_URLS_PER_VERIFICATION = 10
MAX_VERIFICATION_URLS_AT_CREATE = 5
MAX_TERMS_LEN = 4000
MAX_PRICE_LEN = 200
MAX_DEADLINE_LEN = 200
MAX_DESCRIPTION_LEN = 500
MAX_URL_LEN = 500
MAX_PAGE_CONTENT_LEN = 3000
MAX_WEB_SUMMARY_LEN = 50_000
MAX_VERIFICATION_ATTEMPTS = 3
MAX_DEALS_PER_USER = 500
MAX_PAGE_SIZE = 100


# ── Mutual resolution ──────────────────────────────────
# Statuses that hold wei but have no finalizer of their own. `disputed` is
# where a deal lands after MAX_VERIFICATION_ATTEMPTS low-confidence verdicts;
# `funded` and `evidence_submitted` are where a deal sits when nobody submits
# evidence and the LLM won't call a relative deadline expired. Without an
# escape route the escrowed wei stays locked forever (N8).
RESOLVABLE_STATUSES = ("funded", "evidence_submitted", "disputed")
# Both parties must sign the SAME outcome for it to execute. `split` exists so
# a partial-delivery dispute has a landing spot both sides can converge on —
# with only release/refund on offer, each party holds out for the whole pot and
# the deal stays stuck.
RESOLUTION_OUTCOMES = ("release", "refund", "split")


# ── Verdict vocabulary ─────────────────────────────────
# Whatever a nondet block returns is the value `gl.eq_principle.strict_eq`
# compares byte for byte across the validator set. Free-text prose cannot
# survive that comparison: two validators reaching the same judgment word their
# explanation differently, the bytes differ, consensus fails, and no verdict is
# ever recorded. So the model picks from closed sets, the contract coerces
# anything off-vocabulary back onto them, and the human-readable sentence is
# composed afterwards from the agreed code — a dict lookup every validator
# performs identically. That is the whole of N11.
CONFIDENCE_LEVELS = ("high", "medium", "low")

VERDICT_REASON_CODES = (
    "all_conditions_confirmed",
    "evidence_insufficient",
    "evidence_contradicted",
    "insufficient_independent_sources",
    "evidence_unfetchable",
    "terms_ambiguous",
    "deadline_passed",
    "verification_error",
)

# Codes the model may list as still outstanding: the same vocabulary minus the
# one code that means nothing is outstanding.
UNMET_CONDITION_CODES = (
    "evidence_insufficient",
    "evidence_contradicted",
    "insufficient_independent_sources",
    "evidence_unfetchable",
    "terms_ambiguous",
    "deadline_passed",
    "verification_error",
)

DEADLINE_REASON_CODES = (
    "deadline_passed",
    "deadline_not_reached",
    "deadline_indeterminate",
    "time_source_unavailable",
    "verification_error",
)

# The prose, written into `verdict_details` after consensus. Never compared.
REASON_TEXT = {
    "all_conditions_confirmed": "Every condition in the terms is confirmed by the submitted evidence.",
    "evidence_insufficient": "The evidence does not cover every condition in the terms.",
    "evidence_contradicted": "The web content contradicts a claim made in the submitted evidence.",
    "insufficient_independent_sources": "Fewer independent sources confirmed the conditions than this deal requires.",
    "evidence_unfetchable": "One or more evidence URLs could not be retrieved for review.",
    "terms_ambiguous": "The terms are too ambiguous to judge against the evidence provided.",
    "deadline_passed": "The deal deadline expired before the conditions were met.",
    "verification_error": "The verification result could not be read.",
    "deadline_not_reached": "The deadline has not passed as of the time source consulted.",
    "deadline_indeterminate": "The deadline is relative and no absolute date could be derived from it.",
    "time_source_unavailable": "The live time source could not be reached.",
}


def _fail(message: str):
    """
    Abort the current call and revert every state change made by it.

    The py-genlayer stdlib has no `gl.rollback`. A user-facing revert is
    `gl.vm.UserError`, which the runner catches at the entry point and turns
    into a rollback carrying `message`. Validators compare that message for
    strict equality, so keep the strings short and deterministic.
    """
    raise gl.vm.UserError(message)


def _pick(value, allowed: tuple, default: str) -> str:
    """
    Coerce a model-supplied string onto a closed vocabulary.

    Anything the model invents — different casing, a synonym, a whole sentence —
    collapses to `default`, so the compared value can only ever be one of
    `allowed`. Without this one validator's "Medium" and another's "medium" are
    a consensus failure, and an unrecognised confidence would route the deal to
    `rejected` (which slashes half the seller's bond) rather than `disputed`.
    """
    candidate = str(value).strip().lower()
    if candidate in allowed:
        return candidate
    return default


def _pick_codes(values, allowed: tuple) -> list:
    """
    Filter a model-supplied list down to known codes, deduplicated and sorted.

    Sorted because two validators can agree on the same set of unmet conditions
    and still emit them in a different order, which a byte comparison reads as
    disagreement.
    """
    if not isinstance(values, list):
        return []
    picked = []
    for value in values:
        code = str(value).strip().lower()
        if code in allowed and code not in picked:
            picked.append(code)
    picked.sort()
    return picked


class ClauseGuard(gl.Contract):
    """
    ClauseGuard: AI-Powered P2P Trade Escrow with Natural Language Terms

    Parties agree on deal terms written in plain English. Funds are locked
    in escrow. GenLayer validators autonomously verify whether conditions
    are met by fetching web evidence and reasoning about the terms.
    """

    deal_count: u256
    # Deal storage: deal_id -> JSON-encoded deal object
    deals: TreeMap[u256, str]
    # User deal history: address -> JSON array of deal IDs
    user_deals: TreeMap[Address, str]

    # ── Money ──────────────────────────────────────────────
    # Wei owed to a party but not yet withdrawn. Finalizing a deal credits
    # this ledger; it never sends. Each party pulls their own money with
    # withdraw(), so a payee who cannot receive can only stall themselves.
    payouts: TreeMap[Address, u256]
    # Wei held against deals that have not reached a terminal state yet.
    total_locked: u256
    # Sum of every outstanding entry in `payouts`.
    total_credited: u256
    # Slashed halves of seller bonds. No method pays this out — the wei is
    # deliberately stranded, which is what "burned" means here.
    protocol_retained: u256

    def __init__(self):
        self.deal_count = u256(0)
        self.total_locked = u256(0)
        self.total_credited = u256(0)
        self.protocol_retained = u256(0)

    # ──────────────────────────────────────────────
    # WRITE METHODS
    # ──────────────────────────────────────────────

    @gl.public.write.payable
    def create_deal(
        self,
        terms: str,
        price_description: str,
        deadline_description: str,
        verification_urls: str,
        min_sources_required: u256,
    ) -> u256:
        """
        Seller creates a new deal with natural language terms.

        Args:
            terms: Plain English description of the deal conditions
            price_description: Price in human-readable form (stored as metadata)
            deadline_description: Deadline in human-readable form
            verification_urls: Comma-separated URLs for evidence verification
            min_sources_required: Minimum number of distinct sources that must
                                  confirm the conditions (1 = standard, 2-3 = multi-sig)

        Returns:
            The new deal ID
        """
        self.deal_count += u256(1)
        deal_id = self.deal_count

        if not terms.strip():
            _fail("Terms cannot be empty")
        if len(terms) > MAX_TERMS_LEN:
            _fail("Terms too long")
        if not price_description.strip():
            _fail("Price description cannot be empty")
        if len(price_description) > MAX_PRICE_LEN:
            _fail("Price description too long")
        if not deadline_description.strip():
            _fail("Deadline description cannot be empty")
        if len(deadline_description) > MAX_DEADLINE_LEN:
            _fail("Deadline description too long")

        # Cap the raw string before splitting — otherwise a megabyte of commas
        # would expand into a huge list before the count check below.
        if len(verification_urls) > MAX_VERIFICATION_URLS_AT_CREATE * (MAX_URL_LEN + 1):
            _fail("Verification URLs blob too large")

        # Validate verification_urls — comma-separated, capped count and length.
        url_list = [u.strip() for u in verification_urls.split(",") if u.strip()]
        if len(url_list) > MAX_VERIFICATION_URLS_AT_CREATE:
            _fail("Too many verification URLs")
        for u in url_list:
            if len(u) > MAX_URL_LEN:
                _fail("Verification URL too long")

        min_src = max(1, int(min_sources_required))

        # ── Good-faith collateral ──
        # Any value the seller attaches at creation becomes the required bond.
        # The buyer must match it when funding. Bonds are returned in full when
        # the deal settles successfully. If the deal is rejected (conditions
        # unmet) or the deadline expires, the seller's bond is split 50/50: half
        # compensates the buyer, half is retained by the protocol (burned). The
        # split deliberately caps the buyer's upside so a rejection can't be
        # gamed for profit. collateral_amount = 0 means no bond (classic
        # behaviour).
        collateral_amount = int(gl.message.value)

        deal = {
            "id": str(deal_id),
            "seller": str(gl.message.sender_address),
            "buyer": "",
            "terms": terms,
            "price_description": price_description,
            "deadline_description": deadline_description,
            "verification_urls": verification_urls,
            "status": "open",
            "evidence": "[]",
            "verdict": "",
            "verdict_details": "",
            "created_at": "",
            "funded_amount": "0",
            "min_sources_required": str(min_src),
            "pending_terms": "",
            "pending_terms_from": "",
            "verification_attempts": "0",
            "collateral_amount": str(collateral_amount),
            "buyer_collateral": "0",
            "settlement": "",
            # Mutual-resolution ballots. Each party's last signed outcome;
            # empty until they sign one. See propose_resolution.
            "resolution_seller": "",
            "resolution_buyer": "",
        }

        self.deals[deal_id] = json.dumps(deal)
        self._add_user_deal(gl.message.sender_address, deal_id)
        # The bond is now held against a live deal.
        self._lock(collateral_amount)

        return deal_id

    @gl.public.write.payable
    def fund_deal(self, deal_id: u256):
        """
        Buyer funds the deal, locking value in escrow.
        The buyer is set to msg.sender upon funding.
        """
        deal = self._get_deal(deal_id)

        if deal["status"] != "open":
            _fail("Deal is not open for funding")

        if str(gl.message.sender_address) == deal["seller"]:
            _fail("Seller cannot fund their own deal")

        # Reject zero-value funding — a 0-wei buyer would block the buyer slot
        # without locking value, griefing the seller.
        value = int(gl.message.value)
        if value <= 0:
            _fail("Fund amount must be positive")

        # If the seller posted a collateral bond, the buyer must match it on
        # top of the escrow price. The bond portion is tracked separately so
        # it can be returned or slashed at settlement; the remainder is the
        # price held in escrow.
        collateral = int(deal.get("collateral_amount", "0"))
        if collateral > 0:
            if value <= collateral:
                _fail("Fund amount must cover the collateral bond plus a positive price")
            deal["buyer_collateral"] = str(collateral)
            deal["funded_amount"] = str(value - collateral)
        else:
            deal["buyer_collateral"] = "0"
            deal["funded_amount"] = str(value)

        deal["buyer"] = str(gl.message.sender_address)
        deal["status"] = "funded"

        # Funding invalidates any pending counter-terms proposed before a buyer
        # existed — otherwise an attacker could pre-stage hostile terms.
        deal["pending_terms"] = ""
        deal["pending_terms_from"] = ""

        self.deals[deal_id] = json.dumps(deal)
        self._add_user_deal(gl.message.sender_address, deal_id)
        # Everything the buyer attached — price plus the matched bond — is now
        # held against a live deal.
        self._lock(value)

    @gl.public.write
    def submit_evidence(self, deal_id: u256, evidence_type: str, evidence_url: str, description: str):
        """
        Either party submits evidence for verification.

        Args:
            deal_id: The deal to submit evidence for
            evidence_type: "delivery_proof", "quality_report", "tracking", "receipt", "other"
            evidence_url: URL pointing to the evidence
            description: Plain English description of what this evidence shows
        """
        deal = self._get_deal(deal_id)

        if deal["status"] not in ("funded", "evidence_submitted", "disputed"):
            _fail("Deal must be funded before evidence can be submitted")

        sender = str(gl.message.sender_address)
        if sender != deal["seller"] and sender != deal["buyer"]:
            _fail("Only deal parties can submit evidence")

        if not evidence_type.strip() or not evidence_url.strip() or not description.strip():
            _fail("Evidence fields cannot be empty")
        if len(evidence_type) > MAX_DESCRIPTION_LEN:
            _fail("Evidence type too long")
        if len(evidence_url) > MAX_URL_LEN:
            _fail("Evidence URL too long")
        if len(description) > MAX_DESCRIPTION_LEN:
            _fail("Description too long")

        evidence_list = json.loads(deal["evidence"])
        if len(evidence_list) >= MAX_EVIDENCE_ITEMS:
            _fail("Maximum evidence items reached for this deal")
        evidence_list.append({
            "submitted_by": sender,
            "type": evidence_type,
            "url": evidence_url,
            "description": description,
        })

        deal["evidence"] = json.dumps(evidence_list)
        if deal["status"] != "disputed":
            deal["status"] = "evidence_submitted"
        self.deals[deal_id] = json.dumps(deal)

    @gl.public.write
    def request_verification(self, deal_id: u256):
        """
        Either party requests AI verification of the deal conditions.
        Can also be called from 'disputed' status to re-request verification.

        This is the core intelligent contract method. Validators will:
        1. Fetch all evidence URLs and verification URLs
        2. Use LLM reasoning to assess whether the deal terms are satisfied
        3. Reach consensus via Optimistic Democracy

        If validators agree conditions are met -> funds release to seller.
        If not met -> funds become refundable to buyer.
        If contested -> escalates via GenLayer's appeal mechanism.
        """
        deal = self._get_deal(deal_id)

        if deal["status"] not in ("evidence_submitted", "disputed"):
            _fail("Evidence must be submitted before verification")

        sender = str(gl.message.sender_address)
        if sender != deal["seller"] and sender != deal["buyer"]:
            _fail("Only deal parties can request verification")

        # Cap re-verification attempts so a disputed deal cannot loop forever.
        attempts = int(deal.get("verification_attempts", "0")) + 1
        if attempts > MAX_VERIFICATION_ATTEMPTS:
            _fail("Maximum verification attempts reached — escalate dispute off-chain")
        deal["verification_attempts"] = str(attempts)

        # Collect all URLs to check
        evidence_list = json.loads(deal["evidence"])
        evidence_urls = [e["url"] for e in evidence_list]
        verification_urls = [u.strip() for u in deal["verification_urls"].split(",") if u.strip()]
        all_urls = list(set(evidence_urls + verification_urls))
        # Cap total URL count — each entry triggers a web crawl during
        # gl.eq_principle.strict_eq and is the dominant compute cost.
        if len(all_urls) > MAX_URLS_PER_VERIFICATION:
            _fail("Too many URLs for one verification — reduce evidence count")

        min_sources = int(deal.get("min_sources_required", "1"))
        is_redispatch = deal["status"] == "disputed"

        # ── AI VERIFICATION via Equivalence Principle ──
        def verify_conditions():
            # Step 1: Fetch web evidence from all provided URLs
            web_evidence = []
            for url in all_urls:
                try:
                    page_content = gl.nondet.web.render(url, mode="text")
                    web_evidence.append({
                        "url": url,
                        "content": page_content[:MAX_PAGE_CONTENT_LEN]
                    })
                except Exception:
                    web_evidence.append({
                        "url": url,
                        "content": "[Could not fetch this URL]"
                    })

            # Step 2: Build evidence summary
            evidence_descriptions = []
            for e in evidence_list:
                evidence_descriptions.append(
                    f"- Type: {e['type']}, URL: {e['url']}, "
                    f"Description: {e['description']}, "
                    f"Submitted by: {'Seller' if e['submitted_by'] == deal['seller'] else 'Buyer'}"
                )

            evidence_summary = "\n".join(evidence_descriptions)

            # Cap total web summary length so a few large pages can't blow
            # past the LLM context window. Per-page is already capped above;
            # this guards the total across all crawled URLs.
            web_evidence_summary = ""
            for we in web_evidence:
                chunk = f"\n--- Content from {we['url']} ---\n{we['content']}\n"
                if len(web_evidence_summary) + len(chunk) > MAX_WEB_SUMMARY_LEN:
                    web_evidence_summary += "\n[Web evidence truncated — total size exceeded]\n"
                    break
                web_evidence_summary += chunk

            multi_source_note = ""
            if min_sources > 1:
                multi_source_note = f"\n\nMULTI-SOURCE REQUIREMENT: This deal requires confirmation from at least {min_sources} distinct and independent verification sources. Count the number of independent sources (different domains/platforms) that clearly confirm the conditions. If fewer than {min_sources} independent sources confirm the conditions, return conditions_met: false and note 'insufficient_independent_sources' in unmet_conditions."

            redispatch_note = ""
            if is_redispatch:
                redispatch_note = "\n\nNOTE: This is a re-verification request following a previous disputed verdict. Apply the same rigorous standard."

            # Step 3: Ask the LLM to assess whether conditions are met
            prompt = f"""You are an impartial escrow judge for a P2P trade deal on the ClauseGuard protocol.

DEAL TERMS (agreed upon by both parties):
\"\"\"{deal['terms']}\"\"\"

PRICE: {deal['price_description']}
DEADLINE: {deal['deadline_description']}

SUBMITTED EVIDENCE:
{evidence_summary}

WEB CONTENT FROM EVIDENCE AND VERIFICATION URLS:
{web_evidence_summary}

YOUR TASK:
Carefully analyze whether the deal terms have been FULLY satisfied based on the
evidence provided. Consider:
1. Does the evidence directly address each condition in the deal terms?
2. Is the web content consistent with the claims made in the evidence?
3. Are there any conditions that remain unverified or contradicted?{multi_source_note}{redispatch_note}

You MUST respond with ONLY a valid JSON object in this exact format:
{{
    "conditions_met": true or false,
    "confidence": "high" or "medium" or "low",
    "reason_code": "one code from the list below",
    "unmet_conditions": ["zero or more codes from the list below, excluding all_conditions_confirmed"]
}}

REASON CODES — use these exact strings and no others:
- all_conditions_confirmed: every condition is satisfied by the evidence
- evidence_insufficient: the evidence does not cover every condition
- evidence_contradicted: the web content contradicts the submitted evidence
- insufficient_independent_sources: fewer independent sources than this deal requires
- evidence_unfetchable: an evidence URL could not be retrieved
- terms_ambiguous: the terms cannot be judged as written
- deadline_passed: the deadline expired before the conditions were met
- verification_error: you cannot produce a judgment from what you were given

Do not write any prose. Every validator in the network runs this judgment
independently and the answers are compared byte for byte, so a free-text
explanation differs between validators and the comparison fails. Codes only.

Be rigorous. Only return conditions_met: true if ALL terms are clearly satisfied
by the evidence. If any condition is ambiguous or unverified, return false."""

            result = gl.nondet.exec_prompt(prompt)

            # Every field below is drawn from a closed set, so two validators
            # that reach the same judgment produce identical bytes no matter how
            # differently their models phrase things. Any prose the model wrote
            # anyway is dropped here rather than compared (N11).
            try:
                parsed = json.loads(result)
                conditions_met = bool(parsed.get("conditions_met", False))
                # A missing or invented code falls back to the one implied by
                # the judgment itself, which is always in the vocabulary.
                fallback = (
                    "all_conditions_confirmed" if conditions_met
                    else "evidence_insufficient"
                )
                normalized = {
                    "conditions_met": conditions_met,
                    "confidence": _pick(
                        parsed.get("confidence", "low"), CONFIDENCE_LEVELS, "low"
                    ),
                    "reason_code": _pick(
                        parsed.get("reason_code", ""), VERDICT_REASON_CODES, fallback
                    ),
                    "unmet_conditions": _pick_codes(
                        parsed.get("unmet_conditions", []), UNMET_CONDITION_CODES
                    ),
                }
                return json.dumps(normalized, sort_keys=True)
            except (json.JSONDecodeError, KeyError):
                return json.dumps({
                    "conditions_met": False,
                    "confidence": "low",
                    "reason_code": "verification_error",
                    "unmet_conditions": ["verification_error"]
                }, sort_keys=True)

        # Execute with equivalence principle for validator consensus
        verdict_json = gl.eq_principle.strict_eq(verify_conditions)
        verdict = json.loads(verdict_json)

        # Update deal based on verdict. The readable sentence is composed here,
        # outside the equivalence principle, from the code the validators agreed
        # on — the same lookup on every validator, so the state write stays
        # deterministic without any prose having crossed the comparison.
        reason_code = verdict["reason_code"]
        deal["verdict"] = "approved" if verdict["conditions_met"] else "rejected"
        deal["verdict_details"] = json.dumps({
            "conditions_met": verdict["conditions_met"],
            "confidence": verdict["confidence"],
            "reason_code": reason_code,
            "reasoning": REASON_TEXT.get(reason_code, ""),
            "unmet_conditions": verdict["unmet_conditions"],
        })

        if verdict["conditions_met"]:
            deal["status"] = "verified"
        else:
            if verdict["confidence"] == "low":
                deal["status"] = "disputed"
            else:
                deal["status"] = "rejected"

        self.deals[deal_id] = json.dumps(deal)

    @gl.public.write
    def propose_counter_terms(self, deal_id: u256, new_terms: str):
        """
        A potential buyer (or the existing buyer) proposes amended deal terms.
        The seller can then accept (updating the terms) or reject.

        Args:
            deal_id: The deal to amend
            new_terms: The proposed replacement terms
        """
        deal = self._get_deal(deal_id)

        if deal["status"] not in ("open", "funded"):
            _fail("Counter-terms can only be proposed for open or funded deals")

        sender = str(gl.message.sender_address)
        if sender == deal["seller"]:
            _fail("Seller cannot propose counter-terms to their own deal")

        if deal["status"] == "funded" and sender != deal["buyer"]:
            _fail("Only the buyer can propose counter-terms for a funded deal")

        if not new_terms.strip():
            _fail("Counter-terms cannot be empty")
        if len(new_terms) > MAX_TERMS_LEN:
            _fail("Counter-terms too long")

        # On an open deal, only one pending proposal at a time. The first
        # would-be buyer claims the slot; otherwise a hostile non-party could
        # repeatedly overwrite a real buyer's offer (and pre-stage terms a
        # later seller could accept after a different buyer funds — the
        # counter-terms hijack).
        if deal["status"] == "open":
            existing_from = deal.get("pending_terms_from", "")
            if existing_from and existing_from != sender:
                _fail("Another party has a pending counter-terms proposal")

        deal["pending_terms"] = new_terms.strip()
        deal["pending_terms_from"] = sender
        self.deals[deal_id] = json.dumps(deal)

    @gl.public.write
    def accept_counter_terms(self, deal_id: u256):
        """
        Seller accepts the pending counter-terms, updating the deal's terms.
        """
        deal = self._get_deal(deal_id)

        if not deal.get("pending_terms", ""):
            _fail("No pending counter-terms to accept")

        sender = str(gl.message.sender_address)
        if sender != deal["seller"]:
            _fail("Only the seller can accept counter-terms")

        # Counter-terms can only be accepted while the deal is still in a
        # negotiable state. Without this the seller could accept stale
        # proposals after evidence/verification, rewriting terms retroactively.
        if deal["status"] not in ("open", "funded"):
            _fail("Counter-terms can only be accepted for open or funded deals")

        # If a buyer has funded, the proposal must come from that buyer —
        # otherwise the seller could bind the buyer's locked funds to terms
        # proposed by a third party (the counter-terms hijack).
        if deal["status"] == "funded" and deal.get("pending_terms_from", "") != deal["buyer"]:
            _fail("Pending counter-terms were not proposed by the current buyer")

        deal["terms"] = deal["pending_terms"]
        deal["pending_terms"] = ""
        deal["pending_terms_from"] = ""
        self.deals[deal_id] = json.dumps(deal)

    @gl.public.write
    def reject_counter_terms(self, deal_id: u256):
        """
        Seller rejects the pending counter-terms. Terms revert to the original.
        """
        deal = self._get_deal(deal_id)

        if not deal.get("pending_terms", ""):
            _fail("No pending counter-terms to reject")

        sender = str(gl.message.sender_address)
        if sender != deal["seller"]:
            _fail("Only the seller can reject counter-terms")

        deal["pending_terms"] = ""
        deal["pending_terms_from"] = ""
        self.deals[deal_id] = json.dumps(deal)

    @gl.public.write
    def check_deadline(self, deal_id: u256):
        """
        AI-powered deadline check. Fetches the current UTC time from a live
        source and determines whether the deal's deadline has passed.
        If expired, the deal is moved to 'rejected' so the buyer can claim a refund.

        Only callable by deal parties, only for funded/evidence_submitted deals.
        """
        deal = self._get_deal(deal_id)

        if deal["status"] not in ("funded", "evidence_submitted"):
            _fail("Deadline can only be checked for funded deals")

        sender = str(gl.message.sender_address)
        if sender != deal["seller"] and sender != deal["buyer"]:
            _fail("Only deal parties can check the deadline")

        deadline_desc = deal["deadline_description"]

        def check():
            current_time = ""
            try:
                time_data = gl.nondet.web.render(
                    "https://worldtimeapi.org/api/timezone/UTC", mode="text"
                )
                current_time = time_data[:600]
            except Exception:
                current_time = "[Could not fetch current time]"

            prompt = f"""You are checking whether a P2P escrow deal deadline has passed.

CURRENT UTC TIME DATA (fetched live from worldtimeapi.org):
{current_time}

DEAL DEADLINE DESCRIPTION: "{deadline_desc}"

Has this deadline passed as of the current time shown above?

Rules:
- Extract the exact current date from the time data above.
- If the deadline is relative (e.g. "7 days from funding") and you cannot determine
  an absolute date, respond with deadline_passed: false.
- If the time data could not be fetched, respond with deadline_passed: false.
- Only respond with deadline_passed: true if you are HIGHLY CONFIDENT the deadline
  has passed based on the fetched current time.

Respond with ONLY a valid JSON object:
{{
    "deadline_passed": true or false,
    "reason_code": one of "deadline_passed", "deadline_not_reached",
                   "deadline_indeterminate", "time_source_unavailable"
}}

Codes only, no prose. Every validator runs this check independently and the
answers are compared byte for byte, so a written explanation breaks consensus."""

            result = gl.nondet.exec_prompt(prompt)
            try:
                parsed = json.loads(result)
                passed = bool(parsed.get("deadline_passed", False))
                fallback = "deadline_passed" if passed else "deadline_indeterminate"
                return json.dumps({
                    "deadline_passed": passed,
                    "reason_code": _pick(
                        parsed.get("reason_code", ""), DEADLINE_REASON_CODES, fallback
                    )
                }, sort_keys=True)
            except (json.JSONDecodeError, KeyError):
                return json.dumps({
                    "deadline_passed": False,
                    "reason_code": "verification_error"
                }, sort_keys=True)

        result_json = gl.eq_principle.strict_eq(check)
        result = json.loads(result_json)

        if result["deadline_passed"]:
            deal["status"] = "rejected"
            deal["verdict"] = "rejected"
            deal["verdict_details"] = json.dumps({
                "conditions_met": False,
                "confidence": "high",
                "reason_code": "deadline_passed",
                "reasoning": REASON_TEXT["deadline_passed"],
                "unmet_conditions": ["deadline_passed"]
            })
            self.deals[deal_id] = json.dumps(deal)

    @gl.public.write
    def settle_deal(self, deal_id: u256):
        """
        Settle a verified deal — releases funds to the seller.
        Can only be called after successful AI verification.
        """
        deal = self._get_deal(deal_id)

        if deal["status"] != "verified":
            _fail("Deal must be verified before settlement")

        sender = str(gl.message.sender_address)
        if sender != deal["seller"] and sender != deal["buyer"]:
            _fail("Only deal parties can settle")

        # Cooperative outcome — conditions met. Price goes to the seller and
        # BOTH good-faith bonds are returned to their owners.
        price = int(deal["funded_amount"])
        seller_bond = int(deal.get("collateral_amount", "0"))
        buyer_bond = int(deal.get("buyer_collateral", "0"))
        to_seller = price + seller_bond
        to_buyer = buyer_bond

        # Terminal status is written before a single wei moves anywhere, so a
        # second settle_deal on the same id hits the status guard above.
        deal["status"] = "settled"
        deal["settlement"] = json.dumps({
            "price_to": "seller",
            "seller_collateral": "returned",
            "buyer_collateral": "returned",
            "credited_seller": str(to_seller),
            "credited_buyer": str(to_buyer),
        })
        self.deals[deal_id] = json.dumps(deal)

        # Move the escrowed wei out of `locked` and onto the payout ledger.
        # Nothing is sent here — both parties pull with withdraw().
        self._release(to_seller + to_buyer)
        self._credit(deal["seller"], to_seller)
        self._credit(deal["buyer"], to_buyer)

    @gl.public.write
    def claim_refund(self, deal_id: u256):
        """
        Buyer claims refund for a rejected deal.
        """
        deal = self._get_deal(deal_id)

        if deal["status"] != "rejected":
            _fail("Deal must be rejected to claim refund")

        sender = str(gl.message.sender_address)
        if sender != deal["buyer"]:
            _fail("Only buyer can claim refund")

        # Conditions were not met (or the deadline expired). The seller failed
        # to see the deal through, so the buyer is made whole on the escrow
        # price AND their own bond. The seller's bond is split 50/50: half is
        # paid to the buyer as compensation for the wasted deal, half is
        # retained by the protocol (burned). Capping the buyer's share removes
        # any incentive to angle for a rejection just to capture the bond.
        price = int(deal["funded_amount"])
        seller_bond = int(deal.get("collateral_amount", "0"))
        buyer_bond = int(deal.get("buyer_collateral", "0"))
        # Integer split — the buyer never gets more than half; any odd wei
        # rounds to the protocol side.
        seller_to_buyer = seller_bond // 2
        seller_to_protocol = seller_bond - seller_to_buyer
        to_buyer = price + buyer_bond + seller_to_buyer

        deal["status"] = "refunded"
        deal["settlement"] = json.dumps({
            "price_to": "buyer",
            "seller_collateral": "split_buyer_protocol" if seller_bond > 0 else "none",
            "seller_collateral_to_buyer": str(seller_to_buyer),
            "seller_collateral_to_protocol": str(seller_to_protocol),
            "buyer_collateral": "returned" if buyer_bond > 0 else "none",
            "credited_buyer": str(to_buyer),
        })
        self.deals[deal_id] = json.dumps(deal)

        # Everything locked against this deal leaves `locked`: the buyer's
        # share lands on the payout ledger, the slashed half is stranded.
        self._release(price + seller_bond + buyer_bond)
        self._credit(deal["buyer"], to_buyer)
        self._retain(seller_to_protocol)

    @gl.public.write
    def cancel_deal(self, deal_id: u256):
        """
        Seller cancels an unfunded deal.
        """
        deal = self._get_deal(deal_id)

        if deal["status"] != "open":
            _fail("Can only cancel open (unfunded) deals")

        sender = str(gl.message.sender_address)
        if sender != deal["seller"]:
            _fail("Only seller can cancel their deal")

        # No buyer was ever bound, so the seller's good-faith bond (if any) is
        # returned in full. An `open` deal holds nothing but that bond.
        seller_bond = int(deal.get("collateral_amount", "0"))

        deal["status"] = "cancelled"
        deal["settlement"] = json.dumps({
            "seller_collateral": "returned" if seller_bond > 0 else "none",
            "credited_seller": str(seller_bond),
        })
        self.deals[deal_id] = json.dumps(deal)

        self._release(seller_bond)
        self._credit(deal["seller"], seller_bond)

    @gl.public.write
    def propose_resolution(self, deal_id: u256, outcome: str):
        """
        Sign a mutually-agreed ending for a deal the AI can't finish.

        A deal in `disputed` (three low-confidence verdicts) or stuck in
        `funded` / `evidence_submitted` (no evidence, and a relative deadline
        the LLM won't call expired) has no finalizer, so its wei stays locked
        forever. This is the escape route: each party signs one of
        `release` / `refund` / `split`, and the deal executes the moment both
        signatures match. Either side may sign first, and re-signing replaces
        your previous choice.

        Nothing here can be done unilaterally. One signature only records a
        ballot; the counterparty's matching signature is what moves money. That
        is deliberate — a unilateral exit from `funded` would let a buyer pull
        their funds back after the seller had already shipped.

        Unlike `claim_refund`, no bond is slashed. A mutual agreement isn't an
        adjudicated breach, so both bonds go home intact. That also makes
        cooperating strictly cheaper for a seller than stalling: sign `refund`
        and keep your whole bond, or sit in `disputed` and reach a
        `claim_refund` that costs you half of it.

        Args:
            deal_id: The deal to resolve
            outcome: "release" (price to seller), "refund" (price to buyer),
                     or "split" (price halved, odd wei to the buyer)
        """
        deal = self._get_deal(deal_id)

        if deal["status"] not in RESOLVABLE_STATUSES:
            _fail("Deal is not in a resolvable state")

        sender = str(gl.message.sender_address)
        is_seller = sender == deal["seller"]
        is_buyer = sender == deal["buyer"]
        if not is_seller and not is_buyer:
            _fail("Only deal parties can propose a resolution")

        choice = outcome.strip().lower()
        if choice not in RESOLUTION_OUTCOMES:
            _fail("Unknown resolution outcome")

        if is_seller:
            deal["resolution_seller"] = choice
        else:
            deal["resolution_buyer"] = choice

        seller_choice = deal.get("resolution_seller", "")
        buyer_choice = deal.get("resolution_buyer", "")

        # One side has signed, or the two disagree. Record the ballot and stop —
        # the deal stays exactly where it was, holding exactly what it held.
        if not seller_choice or seller_choice != buyer_choice:
            self.deals[deal_id] = json.dumps(deal)
            return

        self._execute_resolution(deal_id, deal, seller_choice)

    @gl.public.write
    def withdraw(self):
        """
        Pull whatever the caller is owed. This is the only method in the
        contract that sends value out.

        Finalizing a deal never sends — it credits `payouts`. Parties collect
        here, on their own initiative, which means a payee whose address cannot
        receive value can only ever stall their own money. They cannot wedge a
        counterparty's settlement.
        """
        sender = gl.message.sender_address
        amount = int(self.payouts.get(sender, u256(0)))

        if amount <= 0:
            _fail("Nothing to withdraw")

        # Zero the ledger BEFORE emitting the transfer. A re-entrant call finds
        # an empty balance, and if anything downstream raises, the whole
        # transaction reverts together — including this zeroing.
        self.payouts[sender] = u256(0)
        self.total_credited = u256(int(self.total_credited) - amount)

        self._send(sender, amount)

    # ──────────────────────────────────────────────
    # VIEW METHODS
    # ──────────────────────────────────────────────

    @gl.public.view
    def get_deal(self, deal_id: u256) -> str:
        """Returns full deal data as JSON string."""
        return self.deals[deal_id]

    @gl.public.view
    def get_deal_count(self) -> u256:
        """Returns total number of deals created."""
        return self.deal_count

    @gl.public.view
    def get_deal_status(self, deal_id: u256) -> str:
        """Returns just the status of a deal."""
        deal = self._get_deal(deal_id)
        return deal["status"]

    @gl.public.view
    def get_deal_verdict(self, deal_id: u256) -> str:
        """Returns the AI verification verdict details."""
        deal = self._get_deal(deal_id)
        return deal.get("verdict_details", "")

    @gl.public.view
    def get_user_deals(self, user_address: Address) -> str:
        """Returns JSON array of deal IDs for a given user."""
        try:
            raw = self.user_deals[user_address]
        except KeyError:
            raw = ""
        return raw if raw else "[]"

    @gl.public.view
    def get_open_deals(self, offset: u256, limit: u256) -> str:
        """
        Returns a JSON array of up to `limit` open deals starting at deal
        id `offset + 1`. Paginated to avoid O(N) scans of the entire deals
        map; callers should loop until an empty/short page is returned.
        """
        return self._scan_deals(int(offset), int(limit), status_filter="open")

    @gl.public.view
    def get_all_deals(self, offset: u256, limit: u256) -> str:
        """
        Returns a JSON array of up to `limit` deals starting at id
        `offset + 1`. Paginated — see get_open_deals.
        """
        return self._scan_deals(int(offset), int(limit), status_filter=None)

    @gl.public.view
    def get_payout(self, user_address: Address) -> str:
        """
        Wei currently owed to `user_address` and not yet withdrawn, as a
        decimal string (same convention as every other number this contract
        returns).
        """
        return str(int(self.payouts.get(user_address, u256(0))))

    @gl.public.view
    def get_accounting(self) -> str:
        """
        The three money counters, as decimal strings.

        The contract's balance should always equal their sum:
        `locked + credited + protocol_retained`. Every wei is either held
        against a live deal, owed to somebody, or stranded. Deliberately does
        not read the chain balance — see get_contract_balance.
        """
        return json.dumps({
            "total_locked": str(int(self.total_locked)),
            "total_credited": str(int(self.total_credited)),
            "protocol_retained": str(int(self.protocol_retained)),
            "expected_balance": str(
                int(self.total_locked)
                + int(self.total_credited)
                + int(self.protocol_retained)
            ),
        })

    @gl.public.view
    def get_contract_balance(self) -> str:
        """
        The contract's actual native balance in wei, as a decimal string.

        Kept separate from get_accounting so that a runtime which won't hand
        out the self-balance in a read-only call can still serve the counters.
        Compare the two to audit the invariant from outside.
        """
        return str(int(self.balance))

    # ──────────────────────────────────────────────
    # INTERNAL HELPERS
    # ──────────────────────────────────────────────

    def _get_deal(self, deal_id: u256) -> dict:
        """Load and parse a deal from storage."""
        try:
            raw = self.deals[deal_id]
        except KeyError:
            raw = ""
        if not raw:
            _fail("Deal not found")
        return json.loads(raw)

    def _add_user_deal(self, user: Address, deal_id: u256):
        """Track deal ID in user's deal history (capped to prevent bloat)."""
        try:
            raw = self.user_deals[user]
        except KeyError:
            raw = ""
        deals_list = json.loads(raw) if raw else []
        # Cap per-user history so a spammy user can't blow up their own
        # user_deals JSON to the point where reads/writes are unaffordable.
        if len(deals_list) >= MAX_DEALS_PER_USER:
            return
        deals_list.append(str(deal_id))
        self.user_deals[user] = json.dumps(deals_list)

    def _scan_deals(self, offset: int, limit: int, status_filter):
        """
        Walk the deals map from `offset + 1` for up to `limit` ids,
        optionally filtering by status. Bounded read.
        """
        if limit <= 0:
            return "[]"
        if limit > MAX_PAGE_SIZE:
            limit = MAX_PAGE_SIZE
        if offset < 0:
            offset = 0

        start = offset + 1
        end = min(start + limit, int(self.deal_count) + 1)

        result = []
        for i in range(start, end):
            try:
                deal = json.loads(self.deals[u256(i)])
                if status_filter is None or deal.get("status") == status_filter:
                    result.append(deal)
            except (KeyError, json.JSONDecodeError):
                continue
        return json.dumps(result)

    def _execute_resolution(self, deal_id: u256, deal: dict, outcome: str):
        """
        Carry out an outcome both parties signed. Called only from
        `propose_resolution`, only once both ballots match.

        Splits the escrow price per the agreed outcome and returns both bonds
        to their owners. Nothing is slashed and nothing is retained: the wei
        released from `locked` is credited back out in full, so the balance
        invariant holds for every outcome without a rounding remainder.
        """
        price = int(deal["funded_amount"])
        seller_bond = int(deal.get("collateral_amount", "0"))
        buyer_bond = int(deal.get("buyer_collateral", "0"))

        if outcome == "release":
            price_to_seller = price
        elif outcome == "refund":
            price_to_seller = 0
        else:
            # Odd wei goes to the buyer — it's their money in escrow, so they
            # hold the residual claim on anything the halving can't divide.
            price_to_seller = price // 2

        # Derived by subtraction rather than computed independently, so the two
        # shares always add back to `price` exactly.
        price_to_buyer = price - price_to_seller
        to_seller = price_to_seller + seller_bond
        to_buyer = price_to_buyer + buyer_bond

        # Terminal status lands before any accounting moves, same as the other
        # finalizers: a replay hits the RESOLVABLE_STATUSES guard above.
        # `resolved` is its own status rather than a reused `settled`/`refunded`
        # so the audit trail keeps mutual endings distinct from AI-adjudicated
        # ones, and so no existing finalizer will touch the deal again.
        deal["status"] = "resolved"
        deal["settlement"] = json.dumps({
            "resolution": outcome,
            "via": "mutual_agreement",
            "seller_collateral": "returned" if seller_bond > 0 else "none",
            "buyer_collateral": "returned" if buyer_bond > 0 else "none",
            "price_to_seller": str(price_to_seller),
            "price_to_buyer": str(price_to_buyer),
            "credited_seller": str(to_seller),
            "credited_buyer": str(to_buyer),
        })
        self.deals[deal_id] = json.dumps(deal)

        self._release(price + seller_bond + buyer_bond)
        self._credit(deal["seller"], to_seller)
        self._credit(deal["buyer"], to_buyer)

    # ── Money helpers ──────────────────────────────────────    # These four maintain the invariant
    #     balance == total_locked + total_credited + protocol_retained
    # by only ever moving wei between the three buckets, never inventing it.
    # All arithmetic is done in plain Python `int` and converted back at the
    # storage boundary: `u256` is a NewType with no runtime checking, but the
    # storage layer raises OverflowError on a negative write, so the explicit
    # guards below are what turn a bug into a readable revert.

    def _lock(self, amount: int):
        """Record wei attached to a call as held against a live deal."""
        if amount < 0:
            _fail("Accounting error: negative lock")
        if amount == 0:
            return
        self.total_locked = u256(int(self.total_locked) + amount)

    def _release(self, amount: int):
        """
        Move wei out of the locked bucket as a deal reaches a terminal state.
        The caller is responsible for crediting or retaining the same total.

        The guard is unreachable if the accounting above it is correct, which
        is exactly why it's here: it turns an arithmetic mistake into a failed
        transaction rather than a silent underflow.
        """
        if amount < 0:
            _fail("Accounting error: negative release")
        if amount == 0:
            return
        if amount > int(self.total_locked):
            _fail("Accounting error: release exceeds locked funds")
        self.total_locked = u256(int(self.total_locked) - amount)

    def _credit(self, address_str: str, amount: int):
        """Put wei on the payout ledger for `address_str` to pull later."""
        if amount < 0:
            _fail("Accounting error: negative credit")
        if amount == 0:
            return
        if not address_str:
            _fail("Accounting error: credit to empty address")
        payee = Address(address_str)
        current = int(self.payouts.get(payee, u256(0)))
        self.payouts[payee] = u256(current + amount)
        self.total_credited = u256(int(self.total_credited) + amount)

    def _retain(self, amount: int):
        """
        Strand wei in the contract. Nothing pays this bucket out — no owner
        role, no treasury, no withdrawal path. That is the whole design: a
        slashed bond is destroyed, not redistributed.
        """
        if amount < 0:
            _fail("Accounting error: negative retention")
        if amount == 0:
            return
        self.protocol_retained = u256(int(self.protocol_retained) + amount)

    def _send(self, to: Address, amount: int):
        """
        The one place native value leaves this contract.

        `emit_transfer` queues a transfer message for consensus to apply, on
        finalization. It is not a synchronous send: there is no return status
        to check and no in-transaction failure to recover from, so a payee
        cannot make the calling transaction revert. What protects the contract
        from over-promising is the balance invariant, not a return code.
        """
        if amount <= 0:
            _fail("Refusing to send a non-positive amount")
        gl.get_contract_at(to).emit_transfer(value=u256(amount), on="finalized")
