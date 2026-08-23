"""
Double finalization.

A finalizer writes its terminal status before it touches the ledger, so the
second call hits the status guard and reverts. That ordering is the fix for N4
in SECURITY.md, and these tests are what keeps it from regressing: if anyone
moves the `deal["status"] = ...` line below the `_credit` calls, several of
these go red.

`withdraw` is guarded differently — by zeroing the ledger entry before it emits
the transfer — so it gets its own cases here.
"""

from support import BUYER, GEN, SELLER, STRANGER, assert_revert


def test_settle_twice_reverts_and_pays_once(chain):
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=2 * GEN)
    chain.settle(deal_id)

    credited = chain.accounting()["total_credited"]
    assert_revert("must be verified", chain.settle, deal_id)

    assert chain.payout(SELLER) == 7 * GEN
    assert chain.payout(BUYER) == 2 * GEN
    assert chain.accounting()["total_credited"] == credited


def test_refund_twice_reverts_and_pays_once(chain):
    deal_id = chain.deal_at_rejected(price=5 * GEN, bond=4 * GEN)
    chain.refund(deal_id)

    credited = chain.accounting()["total_credited"]
    retained = chain.accounting()["protocol_retained"]

    assert_revert("must be rejected", chain.refund, deal_id)

    assert chain.payout(BUYER) == credited
    assert chain.accounting()["protocol_retained"] == retained


def test_cancel_twice_reverts_and_returns_the_bond_once(chain):
    deal_id = chain.create_deal(bond=2 * GEN)
    chain.cancel(deal_id)

    assert_revert("Can only cancel open", chain.cancel, deal_id)

    assert chain.payout(SELLER) == 2 * GEN
    assert chain.accounting()["total_credited"] == 2 * GEN


def test_settle_after_refund_reverts(chain):
    deal_id = chain.deal_at_rejected(price=5 * GEN, bond=2 * GEN)
    chain.refund(deal_id)

    assert_revert("must be verified", chain.settle, deal_id)

    assert chain.payout(SELLER) == 0
    assert chain.status(deal_id) == "refunded"


def test_refund_after_settle_reverts(chain):
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=2 * GEN)
    chain.settle(deal_id)

    assert_revert("must be rejected", chain.refund, deal_id)

    assert chain.payout(BUYER) == 2 * GEN  # bond only, not the price
    assert chain.status(deal_id) == "settled"


def test_cancel_after_settle_reverts(chain):
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=2 * GEN)
    chain.settle(deal_id)

    assert_revert("Can only cancel open", chain.cancel, deal_id)

    assert chain.payout(SELLER) == 7 * GEN


def test_settle_then_withdraw_then_settle_again(chain):
    """
    The nastiest ordering: the money is already out of the contract when the
    replay lands. The status guard has to hold on its own.
    """
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=2 * GEN)
    chain.settle(deal_id)
    chain.withdraw(SELLER)
    chain.withdraw(BUYER)

    assert chain.contract_balance() == 0
    assert_revert("must be verified", chain.settle, deal_id)

    assert chain.contract_balance() == 0
    assert chain.payout(SELLER) == 0
    assert chain.accounting()["total_credited"] == 0


def test_withdraw_twice_pays_once(chain):
    deal_id = chain.create_deal(bond=3 * GEN)
    chain.cancel(deal_id)

    before = chain.balance(SELLER)
    chain.withdraw(SELLER)
    assert chain.balance(SELLER) == before + 3 * GEN

    assert_revert("Nothing to withdraw", chain.withdraw, SELLER)

    assert chain.balance(SELLER) == before + 3 * GEN
    assert chain.contract_balance() == 0


def test_withdraw_is_zeroed_before_the_transfer_is_emitted(chain):
    """
    Ledger entry gone, counter decremented, then the transfer. A re-entrant
    caller finds nothing. Checked here by the state left behind, since the
    stub can't actually re-enter.
    """
    deal_id = chain.create_deal(bond=3 * GEN)
    chain.cancel(deal_id)

    chain.withdraw(SELLER)

    assert chain.payout(SELLER) == 0
    assert chain.accounting()["total_credited"] == 0
    # Exactly one transfer was queued, for the full credited amount.
    assert chain.rt.transfer_log == [(SELLER, 3 * GEN, "finalized")]


def test_two_deals_settle_independently(chain):
    """
    Finalizing one deal must not finalize or unlock another. Guards are keyed
    on the deal, not on global state.
    """
    first = chain.deal_at_verified(price=5 * GEN, bond=1 * GEN)
    second = chain.deal_at_verified(price=2 * GEN, bond=1 * GEN)

    chain.settle(first)

    assert chain.status(second) == "verified"
    # Only the first deal's wei moved to the ledger; the second is still locked.
    assert chain.accounting()["total_locked"] == 2 * GEN + 2 * GEN
    assert chain.payout(SELLER) == 6 * GEN

    chain.settle(second)
    assert chain.accounting()["total_locked"] == 0
    assert chain.payout(SELLER) == 6 * GEN + 3 * GEN


def test_verification_cannot_reopen_a_settled_deal(chain):
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=1 * GEN)
    chain.settle(deal_id)

    chain.script_verdict(False, confidence="high")
    assert_revert(
        "Evidence must be submitted before verification",
        chain.request_verification,
        deal_id,
    )

    assert chain.status(deal_id) == "settled"
    assert chain.payout(BUYER) == 1 * GEN


def test_evidence_cannot_be_added_after_settlement(chain):
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=1 * GEN)
    chain.settle(deal_id)

    assert_revert(
        "must be funded before evidence",
        chain.submit_evidence,
        deal_id,
        sender=SELLER,
    )


def test_a_stranger_cannot_replay_a_finalizer_after_the_fact(chain):
    deal_id = chain.deal_at_rejected(price=5 * GEN, bond=2 * GEN)
    chain.refund(deal_id)
    chain.withdraw(BUYER)

    for who in (SELLER, BUYER, STRANGER):
        assert_revert("must be rejected", chain.refund, deal_id, sender=who)
        assert_revert("must be verified", chain.settle, deal_id, sender=who)
        assert_revert("Can only cancel open", chain.cancel, deal_id, sender=who)

    # Only the burned half is left, exactly as after the first refund.
    assert chain.contract_balance() == 1 * GEN
    assert chain.accounting()["protocol_retained"] == 1 * GEN
