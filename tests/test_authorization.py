"""
Authorization.

Who may call what, and — now that finalizing actually moves money — whether a
rejected call leaves the books untouched. The autouse invariant fixture covers
the second half; the assertions here cover the first.

Note what the pull model changes about these guards. A finalizer no longer
sends value to whoever called it, so a stranger calling `settle_deal` couldn't
have stolen anything even without the check. The checks stay because the deal's
*status* is still worth protecting, and predictable behaviour beats clever
behaviour in an escrow.
"""

from support import (
    BUYER,
    GEN,
    SECOND_BUYER,
    SELLER,
    STRANGER,
    assert_revert,
)


# ── funding ──


def test_seller_cannot_fund_their_own_deal(chain):
    deal_id = chain.create_deal(bond=1 * GEN)

    assert_revert(
        "Seller cannot fund their own deal",
        chain.fund_deal,
        deal_id,
        sender=SELLER,
        value=5 * GEN,
    )

    assert chain.status(deal_id) == "open"
    # The rejected value never left the seller's account.
    assert chain.accounting()["total_locked"] == 1 * GEN


def test_a_funded_deal_cannot_be_funded_again(chain):
    deal_id = chain.create_deal(bond=1 * GEN)
    chain.fund_deal(deal_id, price=4 * GEN, bond=1 * GEN)

    assert_revert(
        "not open for funding",
        chain.fund_deal,
        deal_id,
        sender=SECOND_BUYER,
        value=5 * GEN,
    )

    assert chain.deal(deal_id)["buyer"] == str(BUYER)
    assert chain.accounting()["total_locked"] == 6 * GEN


def test_funding_below_the_bond_reverts(chain):
    deal_id = chain.create_deal(bond=2 * GEN)

    # Exactly the bond leaves zero price, which is not a deal.
    assert_revert(
        "must cover the collateral bond",
        chain.fund_deal,
        deal_id,
        sender=BUYER,
        value=2 * GEN,
    )
    assert_revert(
        "must cover the collateral bond",
        chain.fund_deal,
        deal_id,
        sender=BUYER,
        value=1 * GEN,
    )

    assert chain.status(deal_id) == "open"


def test_zero_value_funding_reverts(chain):
    deal_id = chain.create_deal(bond=0)

    assert_revert("Fund amount must be positive", chain.fund_deal, deal_id, value=0)

    assert chain.status(deal_id) == "open"
    assert chain.contract_balance() == 0


# ── settlement ──


def test_stranger_cannot_settle(chain):
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=1 * GEN)

    assert_revert("Only deal parties can settle", chain.settle, deal_id, sender=STRANGER)

    assert chain.status(deal_id) == "verified"
    assert chain.payout(SELLER) == 0
    assert chain.accounting()["total_locked"] == 7 * GEN


def test_either_party_may_settle(chain):
    """Both are allowed, and it makes no difference who does it."""
    first = chain.deal_at_verified(price=5 * GEN, bond=1 * GEN)
    chain.settle(first, sender=SELLER)
    seller_by_seller = chain.payout(SELLER)

    second = chain.deal_at_verified(price=5 * GEN, bond=1 * GEN)
    chain.settle(second, sender=BUYER)

    assert chain.payout(SELLER) == seller_by_seller * 2


def test_settle_requires_verified_status(chain):
    deal_id = chain.create_deal(bond=1 * GEN)
    chain.fund_deal(deal_id, price=4 * GEN, bond=1 * GEN)

    assert_revert("must be verified", chain.settle, deal_id)

    chain.submit_evidence(deal_id)
    assert_revert("must be verified", chain.settle, deal_id)


# ── refund ──


def test_only_the_buyer_can_claim_a_refund(chain):
    deal_id = chain.deal_at_rejected(price=5 * GEN, bond=2 * GEN)

    assert_revert("Only buyer can claim refund", chain.refund, deal_id, sender=SELLER)
    assert_revert("Only buyer can claim refund", chain.refund, deal_id, sender=STRANGER)

    assert chain.status(deal_id) == "rejected"
    assert chain.payout(BUYER) == 0
    assert chain.accounting()["protocol_retained"] == 0


def test_refund_requires_rejected_status(chain):
    verified = chain.deal_at_verified(price=5 * GEN, bond=1 * GEN)

    assert_revert("must be rejected", chain.refund, verified)

    assert chain.status(verified) == "verified"


# ── cancellation ──


def test_only_the_seller_can_cancel(chain):
    deal_id = chain.create_deal(bond=2 * GEN)

    assert_revert("Only seller can cancel", chain.cancel, deal_id, sender=BUYER)
    assert_revert("Only seller can cancel", chain.cancel, deal_id, sender=STRANGER)

    assert chain.status(deal_id) == "open"
    assert chain.accounting()["total_locked"] == 2 * GEN


def test_a_funded_deal_cannot_be_cancelled(chain):
    """Otherwise the seller could walk off with the buyer's escrow locked."""
    deal_id = chain.create_deal(bond=1 * GEN)
    chain.fund_deal(deal_id, price=4 * GEN, bond=1 * GEN)

    assert_revert("Can only cancel open", chain.cancel, deal_id)

    assert chain.status(deal_id) == "funded"
    assert chain.accounting()["total_locked"] == 6 * GEN


# ── withdrawal ──


def test_withdraw_with_no_credit_reverts(chain):
    assert_revert("Nothing to withdraw", chain.withdraw, STRANGER)


def test_a_stranger_withdrawing_leaves_other_ledger_entries_alone(chain):
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=2 * GEN)
    chain.settle(deal_id)

    assert_revert("Nothing to withdraw", chain.withdraw, STRANGER)

    assert chain.payout(SELLER) == 7 * GEN
    assert chain.payout(BUYER) == 2 * GEN
    assert chain.accounting()["total_credited"] == 9 * GEN


def test_each_party_can_only_pull_their_own_credit(chain):
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=2 * GEN)
    chain.settle(deal_id)

    buyer_before = chain.balance(BUYER)
    chain.withdraw(SELLER)

    # The seller's withdrawal touched nothing of the buyer's.
    assert chain.balance(BUYER) == buyer_before
    assert chain.payout(BUYER) == 2 * GEN


# ── evidence and verification ──


def test_non_party_cannot_submit_evidence(chain):
    deal_id = chain.create_deal()
    chain.fund_deal(deal_id, price=5 * GEN)

    assert_revert(
        "Only deal parties can submit evidence",
        chain.submit_evidence,
        deal_id,
        sender=STRANGER,
    )

    assert chain.deal(deal_id)["evidence"] == "[]"


def test_non_party_cannot_request_verification(chain):
    deal_id = chain.create_deal()
    chain.fund_deal(deal_id, price=5 * GEN)
    chain.submit_evidence(deal_id)
    chain.script_verdict(True)

    assert_revert(
        "Only deal parties can request verification",
        chain.request_verification,
        deal_id,
        sender=STRANGER,
    )

    assert chain.status(deal_id) == "evidence_submitted"


def test_non_party_cannot_check_the_deadline(chain):
    deal_id = chain.create_deal()
    chain.fund_deal(deal_id, price=5 * GEN)
    chain.script_deadline(True)

    assert_revert(
        "Only deal parties can check the deadline",
        chain.check_deadline,
        deal_id,
        sender=STRANGER,
    )

    assert chain.status(deal_id) == "funded"


# ── counter-terms (existing guards, kept green) ──


def test_only_the_seller_can_accept_counter_terms(chain):
    deal_id = chain.create_deal()
    chain.propose_counter_terms(deal_id, "Deliver 20 widgets instead.", sender=BUYER)

    assert_revert(
        "Only the seller can accept",
        chain.accept_counter_terms,
        deal_id,
        sender=BUYER,
    )
    assert_revert(
        "Only the seller can accept",
        chain.accept_counter_terms,
        deal_id,
        sender=STRANGER,
    )


def test_counter_terms_hijack_is_still_blocked(chain):
    """
    Reproducer for N1 in SECURITY.md: a third party pre-stages hostile terms on
    an open deal, someone else funds it, and the seller tries to bind the
    buyer's escrow to terms the buyer never proposed.
    """
    deal_id = chain.create_deal()
    chain.propose_counter_terms(deal_id, "Seller owes nothing at all.", sender=STRANGER)

    chain.fund_deal(deal_id, price=5 * GEN, sender=BUYER)

    # Funding wiped the pending proposal, so there is nothing to accept.
    assert chain.deal(deal_id)["pending_terms"] == ""
    assert_revert("No pending counter-terms", chain.accept_counter_terms, deal_id)

    # And a fresh hostile proposal on a funded deal is refused outright.
    assert_revert(
        "Only the buyer can propose counter-terms for a funded deal",
        chain.propose_counter_terms,
        deal_id,
        "Seller owes nothing at all.",
        sender=STRANGER,
    )

    assert chain.deal(deal_id)["terms"].startswith("Deliver 10 widgets")


def test_seller_cannot_propose_counter_terms_to_their_own_deal(chain):
    deal_id = chain.create_deal()

    assert_revert(
        "Seller cannot propose counter-terms",
        chain.propose_counter_terms,
        deal_id,
        "Actually, pay me double.",
        sender=SELLER,
    )
