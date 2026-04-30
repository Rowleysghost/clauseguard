# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json


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

    def __init__(self):
        self.deal_count = u256(0)

    # ──────────────────────────────────────────────
    # WRITE METHODS
    # ──────────────────────────────────────────────

    @gl.public.write
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

        min_src = max(1, int(min_sources_required))

        deal = {
            "id": str(deal_id),
            "seller": str(gl.message.sender),
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
        }

        self.deals[deal_id] = json.dumps(deal)
        self._add_user_deal(gl.message.sender, deal_id)

        return deal_id

    @gl.public.write
    def fund_deal(self, deal_id: u256):
        """
        Buyer funds the deal, locking value in escrow.
        The buyer is set to msg.sender upon funding.
        """
        deal = self._get_deal(deal_id)

        if deal["status"] != "open":
            gl.rollback("Deal is not open for funding")

        if str(gl.message.sender) == deal["seller"]:
            gl.rollback("Seller cannot fund their own deal")

        deal["buyer"] = str(gl.message.sender)
        deal["status"] = "funded"
        deal["funded_amount"] = str(gl.message.value)

        self.deals[deal_id] = json.dumps(deal)
        self._add_user_deal(gl.message.sender, deal_id)

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
            gl.rollback("Deal must be funded before evidence can be submitted")

        sender = str(gl.message.sender)
        if sender != deal["seller"] and sender != deal["buyer"]:
            gl.rollback("Only deal parties can submit evidence")

        evidence_list = json.loads(deal["evidence"])
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
            gl.rollback("Evidence must be submitted before verification")

        sender = str(gl.message.sender)
        if sender != deal["seller"] and sender != deal["buyer"]:
            gl.rollback("Only deal parties can request verification")

        # Collect all URLs to check
        evidence_list = json.loads(deal["evidence"])
        evidence_urls = [e["url"] for e in evidence_list]
        verification_urls = [u.strip() for u in deal["verification_urls"].split(",") if u.strip()]
        all_urls = list(set(evidence_urls + verification_urls))

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
                        "content": page_content[:3000]
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

            web_evidence_summary = ""
            for we in web_evidence:
                web_evidence_summary += f"\n--- Content from {we['url']} ---\n{we['content']}\n"

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
    "reasoning": "A clear 2-3 sentence explanation of your assessment",
    "unmet_conditions": ["list of any conditions not yet satisfied, or empty array"]
}}

Be rigorous. Only return conditions_met: true if ALL terms are clearly satisfied
by the evidence. If any condition is ambiguous or unverified, return false."""

            result = gl.nondet.exec_prompt(prompt)

            # Parse and normalize for consensus
            try:
                parsed = json.loads(result)
                normalized = {
                    "conditions_met": bool(parsed.get("conditions_met", False)),
                    "confidence": str(parsed.get("confidence", "low")),
                    "reasoning": str(parsed.get("reasoning", "")),
                    "unmet_conditions": list(parsed.get("unmet_conditions", []))
                }
                return json.dumps(normalized, sort_keys=True)
            except (json.JSONDecodeError, KeyError):
                return json.dumps({
                    "conditions_met": False,
                    "confidence": "low",
                    "reasoning": "Failed to parse verification result",
                    "unmet_conditions": ["verification_error"]
                }, sort_keys=True)

        # Execute with equivalence principle for validator consensus
        verdict_json = gl.eq_principle.strict_eq(verify_conditions)
        verdict = json.loads(verdict_json)

        # Update deal based on verdict
        deal["verdict"] = "approved" if verdict["conditions_met"] else "rejected"
        deal["verdict_details"] = json.dumps(verdict)

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
            gl.rollback("Counter-terms can only be proposed for open or funded deals")

        sender = str(gl.message.sender)
        if sender == deal["seller"]:
            gl.rollback("Seller cannot propose counter-terms to their own deal")

        if deal["status"] == "funded" and sender != deal["buyer"]:
            gl.rollback("Only the buyer can propose counter-terms for a funded deal")

        if not new_terms.strip():
            gl.rollback("Counter-terms cannot be empty")

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
            gl.rollback("No pending counter-terms to accept")

        sender = str(gl.message.sender)
        if sender != deal["seller"]:
            gl.rollback("Only the seller can accept counter-terms")

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
            gl.rollback("No pending counter-terms to reject")

        sender = str(gl.message.sender)
        if sender != deal["seller"]:
            gl.rollback("Only the seller can reject counter-terms")

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
            gl.rollback("Deadline can only be checked for funded deals")

        sender = str(gl.message.sender)
        if sender != deal["seller"] and sender != deal["buyer"]:
            gl.rollback("Only deal parties can check the deadline")

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
    "reasoning": "1-2 sentence explanation referencing the current date and deadline"
}}"""

            result = gl.nondet.exec_prompt(prompt)
            try:
                parsed = json.loads(result)
                return json.dumps({
                    "deadline_passed": bool(parsed.get("deadline_passed", False)),
                    "reasoning": str(parsed.get("reasoning", ""))
                }, sort_keys=True)
            except (json.JSONDecodeError, KeyError):
                return json.dumps({
                    "deadline_passed": False,
                    "reasoning": "Failed to parse deadline check result"
                }, sort_keys=True)

        result_json = gl.eq_principle.strict_eq(check)
        result = json.loads(result_json)

        if result["deadline_passed"]:
            deal["status"] = "rejected"
            deal["verdict"] = "rejected"
            deal["verdict_details"] = json.dumps({
                "conditions_met": False,
                "confidence": "high",
                "reasoning": "Deadline expired. " + result.get("reasoning", ""),
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
            gl.rollback("Deal must be verified before settlement")

        # In production: transfer escrowed funds to seller
        # gl.transfer(Address(deal["seller"]), u256(int(deal["funded_amount"])))

        deal["status"] = "settled"
        self.deals[deal_id] = json.dumps(deal)

    @gl.public.write
    def claim_refund(self, deal_id: u256):
        """
        Buyer claims refund for a rejected deal.
        """
        deal = self._get_deal(deal_id)

        if deal["status"] != "rejected":
            gl.rollback("Deal must be rejected to claim refund")

        sender = str(gl.message.sender)
        if sender != deal["buyer"]:
            gl.rollback("Only buyer can claim refund")

        # In production: transfer escrowed funds back to buyer
        # gl.transfer(gl.message.sender, u256(int(deal["funded_amount"])))

        deal["status"] = "refunded"
        self.deals[deal_id] = json.dumps(deal)

    @gl.public.write
    def cancel_deal(self, deal_id: u256):
        """
        Seller cancels an unfunded deal.
        """
        deal = self._get_deal(deal_id)

        if deal["status"] != "open":
            gl.rollback("Can only cancel open (unfunded) deals")

        sender = str(gl.message.sender)
        if sender != deal["seller"]:
            gl.rollback("Only seller can cancel their deal")

        deal["status"] = "cancelled"
        self.deals[deal_id] = json.dumps(deal)

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
            return self.user_deals[user_address]
        except KeyError:
            return "[]"

    @gl.public.view
    def get_open_deals(self) -> str:
        """Returns JSON array of all open deals (marketplace view)."""
        open_deals = []
        for i in range(1, int(self.deal_count) + 1):
            try:
                deal = json.loads(self.deals[u256(i)])
                if deal["status"] == "open":
                    open_deals.append(deal)
            except (KeyError, json.JSONDecodeError):
                continue
        return json.dumps(open_deals)

    @gl.public.view
    def get_all_deals(self) -> str:
        """Returns JSON array of all deals (for dashboard)."""
        all_deals = []
        for i in range(1, int(self.deal_count) + 1):
            try:
                deal = json.loads(self.deals[u256(i)])
                all_deals.append(deal)
            except (KeyError, json.JSONDecodeError):
                continue
        return json.dumps(all_deals)

    # ──────────────────────────────────────────────
    # INTERNAL HELPERS
    # ──────────────────────────────────────────────

    def _get_deal(self, deal_id: u256) -> dict:
        """Load and parse a deal from storage."""
        try:
            return json.loads(self.deals[deal_id])
        except KeyError:
            gl.rollback("Deal not found")

    def _add_user_deal(self, user: Address, deal_id: u256):
        """Track deal ID in user's deal history."""
        try:
            deals_list = json.loads(self.user_deals[user])
        except KeyError:
            deals_list = []
        deals_list.append(str(deal_id))
        self.user_deals[user] = json.dumps(deals_list)
