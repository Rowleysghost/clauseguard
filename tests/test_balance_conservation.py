"""
Balance conservation.

Every test here checks two things: that the right party got the right number of
wei, and that no wei was created or destroyed on the way. The second half is
enforced for free by the autouse fixture in conftest, which asserts

    contract balance == total_locked + total_credited + protocol_retained

after each test, along with a global supply check. The explicit assertions
below pin the amounts.
"""

import json

from support import BUYER, GEN, SELLER, STRANGER, assert_revert


def test_funding_locks_price_plus_bond(chain):
    deal_id = chain.create_deal(bond=2 * GEN)
    assert chain.accounting()["total_locked"] == 2 * GEN

    chain.fund_deal(deal_id, price=5 * GEN, bond=2 * GEN)

    # Seller's 2 + buyer's 7 (5 price, 2 matched bond).
    assert chain.accounting()["total_locked"] == 9 * GEN
    assert chain.contract_balance() == 9 * GEN

    deal = chain.deal(deal_id)
    assert deal["funded_amount"] == str(5 * GEN)
    assert deal["buyer_collateral"] == str(2 * GEN)
    assert deal["collateral_amount"] == str(2 * GEN)


def test_settle_credits_price_and_both_bonds(chain):
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=2 * GEN)

    chain.settle(deal_id)

    assert chain.status(deal_id) == "settled"
    # Seller: price plus their own bond back. Buyer: their bond back, nothing else.
    assert chain.payout(SELLER) == 7 * GEN
    assert chain.payout(BUYER) == 2 * GEN

    acct = chain.accounting()
    assert acct["total_locked"] == 0
    assert acct["total_credited"] == 9 * GEN
    assert acct["protocol_retained"] == 0


def test_settle_zero_bond_credits_only_price(chain):
    deal_id = chain.deal_at_verified(price=3 * GEN, bond=0)

    chain.settle(deal_id)

    assert chain.payout(SELLER) == 3 * GEN
    assert chain.payout(BUYER) == 0
    assert chain.accounting()["protocol_retained"] == 0


def test_refund_splits_seller_bond_in_half(chain):
    deal_id = chain.deal_at_rejected(price=5 * GEN, bond=4 * GEN)

    chain.refund(deal_id)

    assert chain.status(deal_id) == "refunded"
    # Price back, own bond back, plus half the seller's bond.
    assert chain.payout(BUYER) == 5 * GEN + 4 * GEN + 2 * GEN
    assert chain.payout(SELLER) == 0

    acct = chain.accounting()
    assert acct["total_locked"] == 0
    assert acct["protocol_retained"] == 2 * GEN

    settlement = chain.deal(deal_id)
    detail = json.loads(settlement["settlement"])
    assert detail["seller_collateral_to_buyer"] == str(2 * GEN)
    assert detail["seller_collateral_to_protocol"] == str(2 * GEN)


def test_refund_odd_wei_rounds_to_the_protocol(chain):
    """A 3-wei bond splits 1 to the buyer, 2 stranded. Documented behaviour."""
    deal_id = chain.create_deal(bond=3)
    chain.fund_deal(deal_id, value=4)  # 3 matched bond + 1 wei of price
    chain.submit_evidence(deal_id)
    chain.script_verdict(False, confidence="high")
    chain.request_verification(deal_id)

    chain.refund(deal_id)

    # price 1 + own bond 3 + floor(3/2) = 5
    assert chain.payout(BUYER) == 5
    assert chain.accounting()["protocol_retained"] == 2
    assert chain.contract_balance() == 7


def test_refund_zero_bond_returns_only_the_price(chain):
    deal_id = chain.deal_at_rejected(price=6 * GEN, bond=0)

    chain.refund(deal_id)

    assert chain.payout(BUYER) == 6 * GEN
    assert chain.accounting()["protocol_retained"] == 0


def test_cancel_returns_the_bond_and_nothing_more(chain):
    deal_id = chain.create_deal(bond=2 * GEN)

    chain.cancel(deal_id)

    assert chain.status(deal_id) == "cancelled"
    assert chain.payout(SELLER) == 2 * GEN
    acct = chain.accounting()
    assert acct["total_locked"] == 0
    assert acct["total_credited"] == 2 * GEN
    assert acct["protocol_retained"] == 0


def test_cancel_without_a_bond_credits_nobody(chain):
    deal_id = chain.create_deal(bond=0)

    chain.cancel(deal_id)

    assert chain.status(deal_id) == "cancelled"
    assert chain.payout(SELLER) == 0
    assert chain.accounting()["total_credited"] == 0
    # And there is nothing to withdraw, so the seller can't fish for wei.
    assert_revert("Nothing to withdraw", chain.withdraw, SELLER)


def test_withdraw_moves_exactly_the_credited_amount(chain):
    deal_id = chain.create_deal(bond=2 * GEN)
    chain.cancel(deal_id)

    before_seller = chain.balance(SELLER)
    before_contract = chain.contract_balance()

    chain.withdraw(SELLER)

    assert chain.balance(SELLER) == before_seller + 2 * GEN
    assert chain.contract_balance() == before_contract - 2 * GEN
    assert chain.payout(SELLER) == 0
    assert chain.accounting()["total_credited"] == 0


def test_settle_then_both_parties_withdraw(chain):
    # Captured before the deal exists — the bond leaves the seller's wallet
    # inside deal_at_verified, so a later snapshot would already be net of it.
    seller_before = chain.balance(SELLER)
    buyer_before = chain.balance(BUYER)

    deal_id = chain.deal_at_verified(price=5 * GEN, bond=2 * GEN)

    chain.settle(deal_id)
    chain.withdraw(SELLER)
    chain.withdraw(BUYER)

    # Seller is up the price; buyer is down the price. Bonds net out to zero
    # for both, because a cooperative settlement returns them intact.
    assert chain.balance(SELLER) == seller_before + 5 * GEN
    assert chain.balance(BUYER) == buyer_before - 5 * GEN
    assert chain.contract_balance() == 0
    assert chain.accounting() == {
        "total_locked": 0,
        "total_credited": 0,
        "protocol_retained": 0,
        "expected_balance": 0,
    }


def test_refund_then_withdraw_leaves_only_the_slashed_half(chain):
    seller_before = chain.balance(SELLER)
    buyer_before = chain.balance(BUYER)

    deal_id = chain.deal_at_rejected(price=5 * GEN, bond=4 * GEN)

    chain.refund(deal_id)
    chain.withdraw(BUYER)

    # Buyer nets +2 (half the seller's bond); seller is down their whole bond.
    assert chain.balance(BUYER) == buyer_before + 2 * GEN
    assert chain.balance(SELLER) == seller_before - 4 * GEN
    # What stays behind is exactly the burned half, and nobody can pull it.
    assert chain.contract_balance() == 2 * GEN
    assert chain.accounting()["protocol_retained"] == 2 * GEN
    for who in (SELLER, BUYER, STRANGER):
        assert_revert("Nothing to withdraw", chain.withdraw, who)


def test_mixed_sequence_conserves_every_wei(chain):
    """
    Three deals, three different outcomes, interleaved. Total wei across every
    account plus the contract must be identical at the end.
    """
    supply_before = chain.rt.total_supply()

    settled = chain.deal_at_verified(price=5 * GEN, bond=1 * GEN)
    rejected = chain.deal_at_rejected(price=3 * GEN, bond=2 * GEN)
    cancelled = chain.create_deal(bond=1 * GEN)

    chain.settle(settled)
    chain.refund(rejected)
    chain.cancel(cancelled)
    chain.check_invariant()

    chain.withdraw(SELLER)
    chain.withdraw(BUYER)

    assert chain.rt.total_supply() == supply_before
    # The only wei left in the contract is the slashed half of deal 2's bond.
    assert chain.contract_balance() == 1 * GEN
    assert chain.accounting() == {
        "total_locked": 0,
        "total_credited": 0,
        "protocol_retained": 1 * GEN,
        "expected_balance": 1 * GEN,
    }


def test_live_deals_keep_their_funds_locked(chain):
    """A funded, un-finalized deal is not withdrawable by anyone."""
    deal_id = chain.create_deal(bond=1 * GEN)
    chain.fund_deal(deal_id, price=4 * GEN, bond=1 * GEN)

    for who in (SELLER, BUYER, STRANGER):
        assert_revert("Nothing to withdraw", chain.withdraw, who)

    assert chain.accounting()["total_locked"] == 6 * GEN
    assert chain.contract_balance() == 6 * GEN
    assert chain.status(deal_id) == "funded"


def test_deadline_expiry_routes_through_the_same_refund_accounting(chain):
    """`check_deadline` marks a deal rejected; the money path is claim_refund."""
    deal_id = chain.create_deal(bond=2 * GEN)
    chain.fund_deal(deal_id, price=5 * GEN, bond=2 * GEN)
    chain.script_deadline(True)
    chain.check_deadline(deal_id, sender=SELLER)

    assert chain.status(deal_id) == "rejected"
    chain.refund(deal_id)

    assert chain.payout(BUYER) == 5 * GEN + 2 * GEN + 1 * GEN
    assert chain.accounting()["protocol_retained"] == 1 * GEN
