"""
Mutual resolution — the escape route for N8.

Before `propose_resolution` existed, three low-confidence verdicts put a deal in
`disputed` with no finalizer that would accept that status, and no verification
attempts left to change it. The escrowed wei was locked forever. A `funded` deal
whose relative deadline the LLM won't call expired had the same problem.

These tests pin three things:

1. It takes TWO matching signatures. One signature, or two that disagree, moves
   nothing — a unilateral exit from `funded` would let a buyer claw funds back
   after the seller shipped.
2. Every outcome conserves every wei, and none of them slash. A mutual
   agreement is not an adjudicated breach, so both bonds go home whole.
3. `resolved` is terminal. No other finalizer will touch the deal, and a replay
   hits the status guard.

The autouse invariant fixture checks the books after each of these, so the
conservation assertions here are the specific amounts, not the balance itself.
"""

import pytest

from support import BUYER, GEN, SELLER, STRANGER, assert_revert


# ──────────────────────────────────────────────
# The three outcomes
# ──────────────────────────────────────────────


def test_mutual_release_credits_the_price_to_the_seller(chain):
    deal_id = chain.deal_at_disputed(price=5 * GEN, bond=2 * GEN)

    chain.propose_resolution(deal_id, "release", sender=SELLER)
    chain.propose_resolution(deal_id, "release", sender=BUYER)

    assert chain.status(deal_id) == "resolved"
    # Seller: the price plus their own bond back. Buyer: their bond back.
    assert chain.payout(SELLER) == 7 * GEN
    assert chain.payout(BUYER) == 2 * GEN
    assert chain.accounting()["total_locked"] == 0
    assert chain.accounting()["protocol_retained"] == 0


def test_mutual_refund_returns_the_seller_bond_unslashed(chain):
    """
    The incentive that makes this route work.

    Through `claim_refund` a rejected seller loses half their bond. Signing a
    mutual refund costs them nothing, so cooperating always beats stalling in
    `disputed` — which is the behaviour N8 needs.
    """
    deal_id = chain.deal_at_disputed(price=5 * GEN, bond=4 * GEN)

    chain.propose_resolution(deal_id, "refund", sender=BUYER)
    chain.propose_resolution(deal_id, "refund", sender=SELLER)

    assert chain.status(deal_id) == "resolved"
    assert chain.payout(BUYER) == 9 * GEN      # price + own bond
    assert chain.payout(SELLER) == 4 * GEN     # own bond, whole
    assert chain.accounting()["protocol_retained"] == 0


def test_mutual_split_halves_the_price(chain):
    deal_id = chain.deal_at_disputed(price=6 * GEN, bond=1 * GEN)

    chain.propose_resolution(deal_id, "split", sender=SELLER)
    chain.propose_resolution(deal_id, "split", sender=BUYER)

    assert chain.status(deal_id) == "resolved"
    assert chain.payout(SELLER) == 4 * GEN     # 3 price + 1 bond
    assert chain.payout(BUYER) == 4 * GEN      # 3 price + 1 bond


def test_split_rounds_the_odd_wei_to_the_buyer(chain):
    """7 wei can't be halved. The buyer put it in escrow, so they get the crumb."""
    deal_id = chain.deal_at_funded(price=7)

    chain.propose_resolution(deal_id, "split", sender=SELLER)
    chain.propose_resolution(deal_id, "split", sender=BUYER)

    assert chain.payout(SELLER) == 3
    assert chain.payout(BUYER) == 4
    assert chain.payout(SELLER) + chain.payout(BUYER) == 7


@pytest.mark.parametrize("outcome", ["release", "refund", "split"])
def test_every_outcome_conserves_every_wei(chain, outcome):
    price, bond = 5 * GEN, 3 * GEN
    deal_id = chain.deal_at_disputed(price=price, bond=bond)

    locked_before = chain.accounting()["total_locked"]
    assert locked_before == price + 2 * bond

    chain.propose_resolution(deal_id, outcome, sender=SELLER)
    chain.propose_resolution(deal_id, outcome, sender=BUYER)

    acct = chain.accounting()
    assert acct["total_locked"] == 0
    # Nothing is slashed and nothing is stranded: everything that left `locked`
    # landed on the payout ledger.
    assert acct["protocol_retained"] == 0
    assert acct["total_credited"] == locked_before
    assert chain.payout(SELLER) + chain.payout(BUYER) == locked_before


# ──────────────────────────────────────────────
# It takes two
# ──────────────────────────────────────────────


def test_one_signature_alone_moves_nothing(chain):
    deal_id = chain.deal_at_disputed(price=5 * GEN, bond=GEN)
    locked = chain.accounting()["total_locked"]

    chain.propose_resolution(deal_id, "release", sender=SELLER)

    assert chain.status(deal_id) == "disputed"
    assert chain.accounting()["total_locked"] == locked
    assert chain.payout(SELLER) == 0
    assert chain.payout(BUYER) == 0
    # The ballot is recorded, though.
    assert chain.deal(deal_id)["resolution_seller"] == "release"
    assert chain.deal(deal_id)["resolution_buyer"] == ""


def test_disagreeing_signatures_move_nothing(chain):
    deal_id = chain.deal_at_disputed(price=5 * GEN)

    chain.propose_resolution(deal_id, "release", sender=SELLER)
    chain.propose_resolution(deal_id, "refund", sender=BUYER)

    assert chain.status(deal_id) == "disputed"
    assert chain.payout(SELLER) == 0
    assert chain.payout(BUYER) == 0


def test_changing_your_mind_to_match_executes(chain):
    """Re-signing replaces your ballot; the match is checked after every write."""
    deal_id = chain.deal_at_disputed(price=4 * GEN)

    chain.propose_resolution(deal_id, "release", sender=SELLER)
    chain.propose_resolution(deal_id, "refund", sender=BUYER)
    assert chain.status(deal_id) == "disputed"

    chain.propose_resolution(deal_id, "refund", sender=SELLER)

    assert chain.status(deal_id) == "resolved"
    assert chain.payout(BUYER) == 4 * GEN


def test_a_buyer_cannot_resolve_a_funded_deal_alone(chain):
    """
    The reason this is two-signature and not a unilateral buyer exit: the seller
    may already have shipped, with evidence still to come.
    """
    deal_id = chain.deal_at_funded(price=5 * GEN)

    chain.propose_resolution(deal_id, "refund", sender=BUYER)

    assert chain.status(deal_id) == "funded"
    assert chain.payout(BUYER) == 0
    assert chain.accounting()["total_locked"] == 5 * GEN


# ──────────────────────────────────────────────
# Authorization and inputs
# ──────────────────────────────────────────────


def test_non_party_cannot_propose_a_resolution(chain):
    deal_id = chain.deal_at_disputed(price=5 * GEN)

    assert_revert(
        "only deal parties",
        chain.propose_resolution, deal_id, "release", sender=STRANGER,
    )
    assert chain.deal(deal_id)["resolution_seller"] == ""
    assert chain.deal(deal_id)["resolution_buyer"] == ""


def test_unknown_outcome_reverts(chain):
    deal_id = chain.deal_at_disputed(price=5 * GEN)

    for bad in ("", "settle", "burn", "RELEASE_ALL", "release refund"):
        assert_revert(
            "unknown resolution outcome",
            chain.propose_resolution, deal_id, bad, sender=SELLER,
        )
    assert chain.deal(deal_id)["resolution_seller"] == ""


def test_outcome_is_case_and_whitespace_tolerant(chain):
    """Frontends send what the user clicked; normalise rather than revert."""
    deal_id = chain.deal_at_disputed(price=4 * GEN)

    chain.propose_resolution(deal_id, "  Refund  ", sender=SELLER)
    assert chain.deal(deal_id)["resolution_seller"] == "refund"

    chain.propose_resolution(deal_id, "REFUND", sender=BUYER)
    assert chain.status(deal_id) == "resolved"
    assert chain.payout(BUYER) == 4 * GEN


# ──────────────────────────────────────────────
# Which statuses are resolvable
# ──────────────────────────────────────────────


def test_cannot_resolve_an_open_deal(chain):
    """`cancel_deal` covers this, and there is no buyer to sign anyway."""
    deal_id = chain.create_deal(bond=GEN)

    assert_revert(
        "not in a resolvable state",
        chain.propose_resolution, deal_id, "refund", sender=SELLER,
    )


def test_cannot_resolve_a_verified_deal(chain):
    """`verified` has a finalizer. Letting a buyer re-open it invites pressure."""
    deal_id = chain.deal_at_verified(price=5 * GEN)

    assert_revert(
        "not in a resolvable state",
        chain.propose_resolution, deal_id, "refund", sender=BUYER,
    )


def test_cannot_resolve_a_rejected_deal(chain):
    deal_id = chain.deal_at_rejected(price=5 * GEN)

    assert_revert(
        "not in a resolvable state",
        chain.propose_resolution, deal_id, "release", sender=SELLER,
    )


def test_evidence_submitted_is_resolvable(chain):
    """Parties can unwind without burning a verification attempt."""
    deal_id = chain.create_deal()
    chain.fund_deal(deal_id, price=5 * GEN)
    chain.submit_evidence(deal_id)
    assert chain.status(deal_id) == "evidence_submitted"

    chain.propose_resolution(deal_id, "split", sender=SELLER)
    chain.propose_resolution(deal_id, "split", sender=BUYER)

    assert chain.status(deal_id) == "resolved"


# ──────────────────────────────────────────────
# N8 itself
# ──────────────────────────────────────────────


def test_resolution_unstrands_a_deal_with_no_attempts_left(chain):
    """
    The N8 reproducer end to end.

    Three low-confidence verdicts, the fourth request refused, no finalizer that
    accepts `disputed`. Pre-fix the 5 GEN sat in the contract permanently.
    """
    deal_id = chain.deal_at_disputed(price=5 * GEN, bond=2 * GEN, exhaust=True)

    # Every other route out is closed.
    assert_revert("maximum verification attempts", chain.request_verification, deal_id)
    assert_revert("must be verified", chain.settle, deal_id)
    assert_revert("must be rejected", chain.refund, deal_id)
    assert_revert("only cancel open", chain.cancel, deal_id)
    assert chain.accounting()["total_locked"] == 9 * GEN

    # The escape route.
    chain.propose_resolution(deal_id, "split", sender=BUYER)
    chain.propose_resolution(deal_id, "split", sender=SELLER)

    assert chain.status(deal_id) == "resolved"
    assert chain.accounting()["total_locked"] == 0
    assert chain.payout(SELLER) + chain.payout(BUYER) == 9 * GEN


def test_resolution_rescues_a_funded_deal_nobody_can_progress(chain):
    """
    N8's second half: no evidence was ever submitted, so verification can't be
    requested, and a relative deadline gives the LLM nothing to expire against.
    """
    deal_id = chain.deal_at_funded(price=5 * GEN)

    assert_revert("evidence must be submitted", chain.request_verification, deal_id)
    chain.script_deadline(False, reasoning="relative deadline, no anchor")
    chain.check_deadline(deal_id)
    assert chain.status(deal_id) == "funded"

    chain.propose_resolution(deal_id, "refund", sender=SELLER)
    chain.propose_resolution(deal_id, "refund", sender=BUYER)

    assert chain.status(deal_id) == "resolved"
    assert chain.payout(BUYER) == 5 * GEN


# ──────────────────────────────────────────────
# `resolved` is terminal
# ──────────────────────────────────────────────


def test_resolving_twice_reverts_and_pays_once(chain):
    deal_id = chain.deal_at_disputed(price=5 * GEN, bond=GEN)

    chain.propose_resolution(deal_id, "release", sender=SELLER)
    chain.propose_resolution(deal_id, "release", sender=BUYER)
    credited = chain.accounting()["total_credited"]

    assert_revert(
        "not in a resolvable state",
        chain.propose_resolution, deal_id, "release", sender=BUYER,
    )
    assert chain.accounting()["total_credited"] == credited


def test_no_other_finalizer_touches_a_resolved_deal(chain):
    deal_id = chain.deal_at_disputed(price=5 * GEN, bond=GEN)
    chain.propose_resolution(deal_id, "split", sender=SELLER)
    chain.propose_resolution(deal_id, "split", sender=BUYER)
    credited = chain.accounting()["total_credited"]

    assert_revert("must be verified", chain.settle, deal_id)
    assert_revert("must be rejected", chain.refund, deal_id)
    assert_revert("only cancel open", chain.cancel, deal_id)
    assert_revert("evidence must be submitted", chain.request_verification, deal_id)
    assert_revert("deadline can only be checked", chain.check_deadline, deal_id)

    assert chain.accounting()["total_credited"] == credited
    assert chain.accounting()["total_locked"] == 0


def test_both_parties_can_withdraw_after_a_mutual_resolution(chain):
    deal_id = chain.deal_at_disputed(price=6 * GEN, bond=2 * GEN)
    chain.propose_resolution(deal_id, "split", sender=SELLER)
    chain.propose_resolution(deal_id, "split", sender=BUYER)

    seller_before = chain.balance(SELLER)
    buyer_before = chain.balance(BUYER)

    chain.withdraw(SELLER)
    chain.withdraw(BUYER)

    assert chain.balance(SELLER) == seller_before + 5 * GEN   # 3 price + 2 bond
    assert chain.balance(BUYER) == buyer_before + 5 * GEN
    assert chain.contract_balance() == 0
    assert chain.accounting()["total_credited"] == 0


def test_settlement_record_names_the_agreed_outcome(chain):
    import json

    deal_id = chain.deal_at_disputed(price=6 * GEN, bond=GEN)
    chain.propose_resolution(deal_id, "split", sender=SELLER)
    chain.propose_resolution(deal_id, "split", sender=BUYER)

    settlement = json.loads(chain.deal(deal_id)["settlement"])
    assert settlement["resolution"] == "split"
    assert settlement["via"] == "mutual_agreement"
    assert settlement["seller_collateral"] == "returned"
    assert settlement["price_to_seller"] == str(3 * GEN)
    assert settlement["price_to_buyer"] == str(3 * GEN)
