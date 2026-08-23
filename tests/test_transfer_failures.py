"""
Transfer failure.

Read this before reading the tests, because "transfer failure" means something
narrower on GenLayer than it does on the EVM.

`emit_transfer` is not a synchronous send. It queues a transfer message for
consensus to apply — `on='finalized'` by default. There is no return status to
check, and no way for the recipient to run code that makes the calling
transaction revert. So the classic EVM failure mode (a payee whose fallback
reverts, wedging the sender's transaction) does not exist here in the same
shape. What remains, and what these tests cover:

1. Anything that raises inside `_send` before the message is queued reverts the
   whole transaction. The `ValueError` on a non-positive amount is the only such
   path the stdlib itself has, but the harness can inject an arbitrary raise, and
   that pins the contract's ordering: nothing may be left half-applied.
2. The transfer is applied after the transaction commits. If consensus fails to
   apply it, the ledger entry is already gone and the wei strands in the
   contract. No contract-side check can prevent that, so it is tested as the
   documented residual, not as something the contract catches.
3. Finalizing a deal makes no transfer at all. That is the payoff of the pull
   model: a payee who cannot receive value can only stall their own withdrawal.

The one behaviour modelled here that was NOT verified against node source is
rejecting value sent to a non-payable method. The `payable` flag exists in the
contract schema for that purpose, so the harness enforces it, but treat the
assertion as a statement about intent rather than a measurement.
"""

import pytest

from support import BUYER, GEN, SELLER, STRANGER, assert_revert
from genlayer import Address, u256


# ── a raise inside the send reverts everything ──


def test_a_raising_send_reverts_the_whole_withdrawal(chain):
    deal_id = chain.create_deal(bond=3 * GEN)
    chain.cancel(deal_id)

    chain.rt.raise_on_emit_to.add(SELLER)
    contract_before = chain.contract_balance()
    seller_before = chain.balance(SELLER)

    assert_revert("transfer to", chain.withdraw, SELLER)

    # The credit survived, the counter survived, nothing moved. This is the
    # assertion that catches a `withdraw` which zeroes the ledger outside the
    # reverting path.
    assert chain.payout(SELLER) == 3 * GEN
    assert chain.accounting()["total_credited"] == 3 * GEN
    assert chain.contract_balance() == contract_before
    assert chain.balance(SELLER) == seller_before
    assert chain.rt.transfer_log == []


def test_clearing_the_failure_pays_out_exactly_once(chain):
    deal_id = chain.create_deal(bond=3 * GEN)
    chain.cancel(deal_id)

    chain.rt.raise_on_emit_to.add(SELLER)
    assert_revert("transfer to", chain.withdraw, SELLER)

    chain.rt.raise_on_emit_to.discard(SELLER)
    before = chain.balance(SELLER)
    chain.withdraw(SELLER)

    assert chain.balance(SELLER) == before + 3 * GEN
    assert_revert("Nothing to withdraw", chain.withdraw, SELLER)
    assert chain.balance(SELLER) == before + 3 * GEN
    assert len(chain.rt.transfer_log) == 1


def test_a_failing_payee_cannot_block_the_other_party(chain):
    """
    Seller's address can't receive. The buyer still gets paid, in full, on their
    own transaction. Under a push model inside `settle_deal` this would have
    been a wedged deal.
    """
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=2 * GEN)
    chain.rt.raise_on_emit_to.add(SELLER)

    chain.settle(deal_id)

    buyer_before = chain.balance(BUYER)
    chain.withdraw(BUYER)
    assert chain.balance(BUYER) == buyer_before + 2 * GEN

    # And the seller's money is still sitting there waiting, not lost.
    assert_revert("transfer to", chain.withdraw, SELLER)
    assert chain.payout(SELLER) == 7 * GEN


# ── finalization never sends ──


@pytest.mark.parametrize("broken", [SELLER, BUYER, STRANGER])
def test_settle_succeeds_regardless_of_whose_send_is_broken(chain, broken):
    deal_id = chain.deal_at_verified(price=5 * GEN, bond=2 * GEN)
    chain.rt.raise_on_emit_to.add(broken)

    chain.settle(deal_id)

    assert chain.status(deal_id) == "settled"
    assert chain.rt.transfer_log == []


@pytest.mark.parametrize("broken", [SELLER, BUYER, STRANGER])
def test_refund_succeeds_regardless_of_whose_send_is_broken(chain, broken):
    deal_id = chain.deal_at_rejected(price=5 * GEN, bond=2 * GEN)
    chain.rt.raise_on_emit_to.add(broken)

    chain.refund(deal_id)

    assert chain.status(deal_id) == "refunded"
    assert chain.rt.transfer_log == []


def test_cancel_succeeds_when_the_sellers_send_is_broken(chain):
    deal_id = chain.create_deal(bond=2 * GEN)
    chain.rt.raise_on_emit_to.add(SELLER)

    chain.cancel(deal_id)

    assert chain.status(deal_id) == "cancelled"
    assert chain.payout(SELLER) == 2 * GEN
    assert chain.rt.transfer_log == []


# ── the stdlib's own guard ──


def test_send_refuses_a_non_positive_amount(chain):
    """
    `_send` guards before `emit_transfer` does, so the revert carries a readable
    message instead of a raw ValueError. Unreachable through the public API —
    `withdraw` already refuses a zero credit — so it's exercised directly.
    """
    with pytest.raises(Exception) as excinfo:
        chain.rt.contract._send(SELLER, 0)
    assert "non-positive" in str(excinfo.value)

    with pytest.raises(Exception) as excinfo:
        chain.rt.contract._send(SELLER, -1)
    assert "non-positive" in str(excinfo.value)


def test_emit_transfer_keeps_value_keyword_only(chain):
    """
    Guards against a refactor that switches to the v0.3.0 signature, where
    `value` is positional. Getting this wrong is a TypeError at runtime on a
    method that only ever runs when somebody is trying to get paid.
    """
    import genlayer as gl_stub

    proxy = gl_stub.gl.get_contract_at(Address(SELLER))
    with pytest.raises(TypeError):
        proxy.emit_transfer(1)  # positional — must not be accepted


# ── value routing ──


def test_value_sent_to_a_non_payable_method_is_rejected(chain):
    deal_id = chain.create_deal(bond=1 * GEN)
    chain.fund_deal(deal_id, price=4 * GEN, bond=1 * GEN)
    chain.submit_evidence(deal_id)
    chain.script_verdict(True)
    chain.request_verification(deal_id)

    before = chain.contract_balance()
    with pytest.raises(Exception) as excinfo:
        chain.call("settle_deal", u256(deal_id), sender=SELLER, value=1 * GEN)
    assert "not payable" in str(excinfo.value)

    assert chain.contract_balance() == before
    assert chain.status(deal_id) == "verified"


def test_withdraw_is_not_payable(chain):
    deal_id = chain.create_deal(bond=2 * GEN)
    chain.cancel(deal_id)

    with pytest.raises(Exception) as excinfo:
        chain.call("withdraw", sender=SELLER, value=1)
    assert "not payable" in str(excinfo.value)

    assert chain.payout(SELLER) == 2 * GEN


def test_funding_value_paths_that_must_revert(chain):
    deal_id = chain.create_deal(bond=2 * GEN)

    assert_revert("Fund amount must be positive", chain.fund_deal, deal_id, value=0)
    assert_revert("must cover the collateral bond", chain.fund_deal, deal_id, value=2 * GEN)

    # Nothing was debited from the buyer on either attempt.
    assert chain.contract_balance() == 2 * GEN
    assert chain.status(deal_id) == "open"


def test_funding_more_than_the_buyer_holds_reverts(chain):
    deal_id = chain.create_deal(bond=0)
    too_much = chain.balance(BUYER) + 1

    assert_revert("insufficient balance", chain.fund_deal, deal_id, value=too_much)

    assert chain.status(deal_id) == "open"


# ── the residual: a transfer that fails after the transaction commits ──


@pytest.mark.no_invariant
def test_a_dropped_transfer_strands_wei_and_breaks_the_books(chain):
    """
    Documented residual, not a contract bug.

    `emit_transfer` hands the transfer to consensus and returns. The contract
    has already zeroed the ledger entry by then. If the transfer is never
    applied, the wei stays in the contract with no claim on it and
    `total_credited` no longer accounts for it — the invariant breaks, and no
    contract-side check could have prevented it.

    Marked `no_invariant` because this test deliberately produces the one state
    the rest of the suite exists to rule out. Recorded in SECURITY.md.
    """
    deal_id = chain.create_deal(bond=3 * GEN)
    chain.cancel(deal_id)

    chain.rt.drop_transfer_to.add(SELLER)
    seller_before = chain.balance(SELLER)

    chain.withdraw(SELLER)  # commits; the transfer is queued and then lost

    assert chain.balance(SELLER) == seller_before  # never arrived
    assert chain.payout(SELLER) == 0  # claim already gone
    assert chain.accounting()["total_credited"] == 0
    assert chain.contract_balance() == 3 * GEN  # stranded
    assert chain.rt.stranded == 3 * GEN

    # The invariant is now broken, which is the point being recorded.
    acct = chain.accounting()
    assert acct["expected_balance"] == 0
    assert chain.contract_balance() != acct["expected_balance"]
