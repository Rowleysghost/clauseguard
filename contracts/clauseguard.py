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
    ) -> u256:
        """
        Seller creates a new deal with natural language terms.

        Args:
            terms: Plain English description of the deal conditions
                   e.g. "Deliver 500 units of Product X via FedEx. Buyer
                   confirms receipt and quality within 7 days."
            price_description: Price in human-readable form (stored as metadata)
            deadline_description: Deadline in human-readable form
            verification_urls: Comma-separated URLs for evidence verification
                               e.g. tracking pages, inspection portals

        Returns:
            The new deal ID
        """
        self.deal_count += u256(1)
        deal_id = self.deal_count

        deal = {
            "id": str(deal_id),
            "seller": str(gl.message.sender),
            "buyer": "",
            "terms": terms,
            "price_description": price_description,
            "deadline_description": deadline_description,
            "verification_urls": verification_urls,
            "status": "open",           # open -> funded -> evidence_submitted -> verified -> settled / refunded / disputed
            "evidence": "[]",           # JSON array of evidence entries
            "verdict": "",              # AI verdict after verification
            "verdict_details": "",      # Detailed reasoning from validators
            "created_at": "",           # Would use block timestamp in production
            "funded_amount": "0",
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
            evidence_url: URL pointing to the evidence (tracking page, document, etc.)
            description: Plain English description of what this evidence shows
        """
        deal = self._get_deal(deal_id)

        if deal["status"] not in ("funded", "evidence_submitted"):
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
        deal["status"] = "evidence_submitted"
        self.deals[deal_id] = json.dumps(deal)

    @gl.public.write
    def request_verification(self, deal_id: u256):
        """
        Either party requests AI verification of the deal conditions.

        This is the core intelligent contract method. Validators will:
        1. Fetch all evidence URLs and verification URLs
        2. Use LLM reasoning to assess whether the deal terms are satisfied
        3. Reach consensus via Optimistic Democracy

        If validators agree conditions are met -> funds release to seller.
        If not met -> funds become refundable to buyer.
        If contested -> escalates via GenLayer's appeal mechanism.
        """
        deal = self._get_deal(deal_id)

        if deal["status"] != "evidence_submitted":
            gl.rollback("Evidence must be submitted before verification")

        sender = str(gl.message.sender)
        if sender != deal["seller"] and sender != deal["buyer"]:
            gl.rollback("Only deal parties can request verification")

        # Collect all URLs to check
        evidence_list = json.loads(deal["evidence"])
        evidence_urls = [e["url"] for e in evidence_list]
        verification_urls = [u.strip() for u in deal["verification_urls"].split(",") if u.strip()]
        all_urls = list(set(evidence_urls + verification_urls))

        # ── AI VERIFICATION via Equivalence Principle ──
        def verify_conditions():
            # Step 1: Fetch web evidence from all provided URLs
            web_evidence = []
            for url in all_urls:
                try:
                    page_content = gl.nondet.web.render(url, mode="text")
                    web_evidence.append({
                        "url": url,
                        "content": page_content[:3000]  # Limit content length
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
3. Are there any conditions that remain unverified or contradicted?

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
                # Normalize to ensure consistent structure for consensus
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
